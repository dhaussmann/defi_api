#!/bin/bash

# Sync paradex_funding_v3 (DB_WRITE) → unified_v3 (DB_UNIFIED)
# OPTIMIZED: Bulk-read all data in pages, generate SQL, write in large batches
# ~10-15 wrangler calls total instead of 200+

DB_SOURCE="defiapi-db-write"
DB_TARGET="defiapi-unified-funding"
READ_PAGE=10000
WRITE_BATCH=500

START_TIME=$(date +%s)
LOG_FILE="/tmp/paradex_sync_$(date +%Y%m%d_%H%M%S).log"
ALL_DATA="/tmp/paradex_sync_all_$$.json"
TEMP_SQL="/tmp/paradex_sync_insert_$$.sql"

log() {
  local MSG="[$(date '+%H:%M:%S')] $1"
  echo "$MSG"
  echo "$MSG" >> "$LOG_FILE"
}

echo "=================================================="
echo "Sync paradex_funding_v3 → unified_v3 (optimized)"
echo "=================================================="
echo "Started:  $(date '+%Y-%m-%d %H:%M:%S')"
echo "Source:   ${DB_SOURCE} (paradex_funding_v3)"
echo "Target:   ${DB_TARGET} (unified_v3)"
echo "Read:     ${READ_PAGE} records/page"
echo "Write:    ${WRITE_BATCH} records/batch"
echo "Log:      ${LOG_FILE}"
echo "=================================================="
echo ""

NOW_SEC=$(date -u +%s)
TOTAL_SYNCED=0
ERRORS=0

# ── Step 1: Test wrangler auth on both DBs ──
log "Step 1: Testing wrangler auth..."
AUTH1=$(npx wrangler d1 execute "$DB_SOURCE" --remote --command="SELECT 1 as test" 2>&1)
if echo "$AUTH1" | grep -qi "error\|failed"; then
  log "❌ Auth failed on ${DB_SOURCE}! Run: npx wrangler login"
  echo "$AUTH1" | tail -3
  exit 1
fi
log "  ✓ ${DB_SOURCE} OK"

AUTH2=$(npx wrangler d1 execute "$DB_TARGET" --remote --command="SELECT 1 as test" 2>&1)
if echo "$AUTH2" | grep -qi "error\|failed"; then
  log "❌ Auth failed on ${DB_TARGET}! Run: npx wrangler login"
  echo "$AUTH2" | tail -3
  exit 1
fi
log "  ✓ ${DB_TARGET} OK"
echo ""

# ── Step 2: Count records ──
log "Step 2: Counting records..."
SRC_RAW=$(npx wrangler d1 execute "$DB_SOURCE" --remote --json \
  --command="SELECT COUNT(*) as cnt FROM paradex_funding_v3 WHERE source = 'import' AND rate_raw IS NOT NULL AND funding_time IS NOT NULL AND ABS(rate_raw_percent) <= 10" 2>/dev/null)
SRC_COUNT=$(echo "$SRC_RAW" | jq -r '.[0].results[0].cnt // "?"' 2>/dev/null || echo "?")
log "  Source (paradex_funding_v3): ${SRC_COUNT} records"

UNI_RAW=$(npx wrangler d1 execute "$DB_TARGET" --remote --json \
  --command="SELECT COUNT(*) as cnt FROM unified_v3 WHERE exchange = 'paradex' AND source = 'import'" 2>/dev/null)
UNI_COUNT=$(echo "$UNI_RAW" | jq -r '.[0].results[0].cnt // "0"' 2>/dev/null || echo "0")
log "  Target (unified_v3):         ${UNI_COUNT} records (existing)"
echo ""

# ── Step 3: Bulk-read all data in pages ──
log "Step 3: Bulk-reading all data from source..."
> "$ALL_DATA"
READ_OFFSET=0
TOTAL_READ=0
PAGE_NUM=0

while true; do
  PAGE_NUM=$((PAGE_NUM + 1))
  PAGE_START=$(date +%s)
  
  PAGE_FILE="/tmp/paradex_sync_page_$$.json"
  npx wrangler d1 execute "$DB_SOURCE" --remote --json \
    --command="SELECT symbol, funding_time, base_asset, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source FROM paradex_funding_v3 WHERE source = 'import' AND rate_raw IS NOT NULL AND funding_time IS NOT NULL AND ABS(rate_raw_percent) <= 10 ORDER BY symbol, funding_time LIMIT ${READ_PAGE} OFFSET ${READ_OFFSET}" \
    > "$PAGE_FILE" 2>/dev/null
  
  PAGE_COUNT=$(jq -r '.[0].results | length' "$PAGE_FILE" 2>/dev/null || echo "0")
  PAGE_DUR=$(( $(date +%s) - PAGE_START ))
  
  if [ "$PAGE_COUNT" = "0" ] || [ -z "$PAGE_COUNT" ]; then
    log "  Page ${PAGE_NUM}: 0 records (${PAGE_DUR}s) — done reading"
    rm -f "$PAGE_FILE"
    break
  fi
  
  # Extract results and append to all_data (one JSON object per line)
  jq -c '.[0].results[]' "$PAGE_FILE" >> "$ALL_DATA"
  TOTAL_READ=$((TOTAL_READ + PAGE_COUNT))
  
  log "  Page ${PAGE_NUM}: ${PAGE_COUNT} records (${PAGE_DUR}s) | total read: ${TOTAL_READ}/${SRC_COUNT}"
  
  rm -f "$PAGE_FILE"
  READ_OFFSET=$((READ_OFFSET + READ_PAGE))
  
  if [ "$PAGE_COUNT" -lt "$READ_PAGE" ]; then
    log "  Last page reached (${PAGE_COUNT} < ${READ_PAGE})"
    break
  fi
done

log "  Total read: ${TOTAL_READ} records"
echo ""

if [ "$TOTAL_READ" = "0" ]; then
  log "❌ No data read from source!"
  exit 1
fi

# ── Step 4: Generate SQL and write in batches ──
log "Step 4: Generating SQL and writing to unified_v3..."
echo "──────────────────────────────────────────────────"
echo ""

TOTAL_LINES=$(wc -l < "$ALL_DATA" | tr -d ' ')
WRITE_OFFSET=0
BATCH_NUM=0
TOTAL_BATCHES=$(( (TOTAL_LINES + WRITE_BATCH - 1) / WRITE_BATCH ))

while [ "$WRITE_OFFSET" -lt "$TOTAL_LINES" ]; do
  BATCH_NUM=$((BATCH_NUM + 1))
  BATCH_START=$(date +%s)
  
  # Extract batch of lines and generate SQL
  > "$TEMP_SQL"
  sed -n "$((WRITE_OFFSET + 1)),$((WRITE_OFFSET + WRITE_BATCH))p" "$ALL_DATA" | \
    jq -r --arg now "$NOW_SEC" '
      (.symbol | split("-") | .[0] | ascii_upcase) as $normalized |
      "INSERT OR REPLACE INTO unified_v3 (exchange, original_symbol, normalized_symbol, funding_time, base_asset, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, synced_at, source) VALUES ('\''paradex'\'', '\''\(.symbol)'\'', '\''\($normalized)'\'', \(if .funding_time > 10000000000 then (.funding_time / 1000 | floor) else .funding_time end), '\''\(.base_asset)'\'', \(.rate_raw), \(.rate_raw_percent), \(.interval_hours), \(.rate_1h_percent), \(.rate_apr), \(if .collected_at > 10000000000 then (.collected_at / 1000 | floor) else .collected_at end), \($now), '\''\(.source)'\'');"
    ' >> "$TEMP_SQL" 2>/dev/null
  
  BATCH_LINES=$(wc -l < "$TEMP_SQL" | tr -d ' ')
  
  if [ "$BATCH_LINES" -gt 0 ]; then
    OUTPUT=$(npx wrangler d1 execute "$DB_TARGET" --remote --file="$TEMP_SQL" 2>&1)
    BATCH_DUR=$(( $(date +%s) - BATCH_START ))
    
    if echo "$OUTPUT" | grep -qi "error\|failed"; then
      ERRORS=$((ERRORS + 1))
      log "[Batch ${BATCH_NUM}/${TOTAL_BATCHES}] ⚠️  ERROR (${BATCH_LINES} rows, ${BATCH_DUR}s)"
      log "  $(echo "$OUTPUT" | grep -i 'error\|failed' | head -1)"
    else
      TOTAL_SYNCED=$((TOTAL_SYNCED + BATCH_LINES))
      
      PCT=$((BATCH_NUM * 100 / TOTAL_BATCHES))
      ELAPSED=$(($(date +%s) - START_TIME))
      ETA=$(( (ELAPSED * TOTAL_BATCHES / BATCH_NUM) - ELAPSED ))
      ETA_MIN=$((ETA / 60))
      ETA_SEC=$((ETA % 60))
      
      log "[Batch ${BATCH_NUM}/${TOTAL_BATCHES}] ✓ ${BATCH_LINES} rows (${BATCH_DUR}s) | ${PCT}% | ETA: ${ETA_MIN}m${ETA_SEC}s | total: ${TOTAL_SYNCED}"
    fi
  fi
  
  WRITE_OFFSET=$((WRITE_OFFSET + WRITE_BATCH))
  sleep 0.2
done

rm -f "$TEMP_SQL" "$ALL_DATA"

TOTAL_DURATION=$(( $(date +%s) - START_TIME ))
TOTAL_MIN=$((TOTAL_DURATION / 60))
TOTAL_SEC=$((TOTAL_DURATION % 60))

echo ""
echo "=================================================="
echo "Sync Complete!"
echo "=================================================="
echo "Duration:     ${TOTAL_MIN}m ${TOTAL_SEC}s"
echo "Read:         ${TOTAL_READ} records from source"
echo "Written:      ${TOTAL_SYNCED} records to unified_v3"
echo "Errors:       ${ERRORS} batches"
echo "Log:          ${LOG_FILE}"
echo ""
echo "Verify:"
echo "  npx wrangler d1 execute ${DB_TARGET} --remote --command=\"SELECT COUNT(*) as total, COUNT(DISTINCT normalized_symbol) as symbols FROM unified_v3 WHERE exchange = 'paradex' AND source = 'import'\""
echo "  npx wrangler d1 execute ${DB_TARGET} --remote --command=\"SELECT normalized_symbol, COUNT(*) as cnt, MIN(datetime(funding_time,'unixepoch')) as oldest, MAX(datetime(funding_time,'unixepoch')) as newest FROM unified_v3 WHERE exchange = 'paradex' AND source = 'import' GROUP BY normalized_symbol ORDER BY cnt DESC LIMIT 10\""
echo "=================================================="
