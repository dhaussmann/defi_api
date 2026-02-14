#!/bin/bash

# V3: Import Paradex Historical Funding Data
# 
# Strategy:
# - 1 API request per hour per token using start_at/end_at (±10s around full hour)
# - Take the latest funding_rate from the window, use full hour as timestamp
# - All 30 days (720 hours) fetched in parallel per token
# - Rate limit: 1500 req/min (Paradex default)
# - Phase 1: Fetch all data to local JSON files
# - Phase 2: Generate SQL and import to DB

DAYS_BACK=${1:-30}
DATA_DIR="/tmp/paradex_v3_data"
PARALLEL=20  # concurrent requests per batch

echo "=================================================="
echo "V3 Paradex Funding Data Import"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: paradex_funding_v3 table"
echo "API: https://api.prod.paradex.trade"
echo "Strategy: 1 req/hour with start_at/end_at, ${PARALLEL} parallel"
echo "Rate Limit: 1500 req/min (Paradex default)"
echo "=================================================="
echo ""

# Calculate timestamps
NOW_SEC=$(date -u +%s)
CURRENT_HOUR=$(( (NOW_SEC / 3600) * 3600 ))
TOTAL_HOURS=$((DAYS_BACK * 24))

# Paradex rate config (8h interval, matching ParadexCollector.ts)
INTERVAL_HOURS=8
EVENTS_PER_YEAR=$((365 * 3))  # 3 funding events per day (every 8h)

# Create data directory
mkdir -p "$DATA_DIR"

# Fetch all active PERP markets
echo "Fetching active PERP markets from Paradex API..."
MARKETS=$(curl -s "https://api.prod.paradex.trade/v1/markets" \
  -H "Accept: application/json" | \
  jq -r '.results[] | select(.asset_kind == "PERP") | .symbol')

if [ -z "$MARKETS" ]; then
  echo "Error: No markets found"
  exit 1
fi

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found ${MARKET_COUNT} active PERP markets"
echo "Total hours to fetch per token: ${TOTAL_HOURS}"
echo "Expected requests per token: ${TOTAL_HOURS}"
echo "Total requests: $((TOTAL_HOURS * MARKET_COUNT))"
echo ""

# ============================================================
# PHASE 1: Fetch all data to local JSON files
# ============================================================
echo "=== PHASE 1: Fetching data from API ==="
echo ""

CURRENT=0
REQUEST_COUNT=0
RATE_LIMIT_START=$(date +%s)

for SYMBOL in $MARKETS; do
  CURRENT=$((CURRENT + 1))
  BASE_ASSET=$(echo "$SYMBOL" | cut -d'-' -f1)
  
  TOKEN_DIR="${DATA_DIR}/${SYMBOL}"
  mkdir -p "$TOKEN_DIR"
  
  # Check how many hours already fetched (for resume support)
  EXISTING=$(ls "$TOKEN_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
  if [ "$EXISTING" -ge "$TOTAL_HOURS" ]; then
    echo "[${CURRENT}/${MARKET_COUNT}] ${BASE_ASSET}: already fetched (${EXISTING} files), skipping"
    continue
  fi
  
  echo -n "[${CURRENT}/${MARKET_COUNT}] ${BASE_ASSET}: fetching ${TOTAL_HOURS}h..."
  
  FETCHED=0
  ERRORS=0
  
  # Fetch all hours in parallel batches
  for BATCH_START in $(seq 0 $PARALLEL $((TOTAL_HOURS - 1))); do
    PIDS=""
    BATCH_SIZE=0
    
    for i in $(seq 0 $((PARALLEL - 1))); do
      HOUR_OFFSET=$((BATCH_START + i))
      if [ "$HOUR_OFFSET" -ge "$TOTAL_HOURS" ]; then
        break
      fi
      
      # Calculate the full hour timestamp
      FULL_HOUR=$((CURRENT_HOUR - (TOTAL_HOURS - HOUR_OFFSET) * 3600))
      
      # Skip if already fetched
      if [ -s "$TOKEN_DIR/${FULL_HOUR}.json" ]; then
        FETCHED=$((FETCHED + 1))
        continue
      fi
      
      # Window: ±10 seconds around the full hour
      START_MS=$(( (FULL_HOUR - 10) * 1000 ))
      END_MS=$(( (FULL_HOUR + 10) * 1000 ))
      
      # Fetch in background, write to individual file
      (
        RESP=$(curl -s --max-time 10 \
          "https://api.prod.paradex.trade/v1/funding/data?market=${SYMBOL}&page_size=5&start_at=${START_MS}&end_at=${END_MS}" \
          -H "Accept: application/json" 2>/dev/null)
        
        # Extract the latest record (closest to or after the full hour)
        # Results are descending, so first result is the newest
        if [ -n "$RESP" ]; then
          echo "$RESP" | jq -c --arg fh "$FULL_HOUR" '
            .results // [] |
            if length > 0 then
              sort_by(.created_at) | last |
              {market, funding_rate, created_at, full_hour: ($fh | tonumber)}
            else empty end
          ' 2>/dev/null > "$TOKEN_DIR/${FULL_HOUR}.json"
        fi
      ) &
      PIDS="$PIDS $!"
      BATCH_SIZE=$((BATCH_SIZE + 1))
    done
    
    # Wait for batch
    for PID in $PIDS; do
      wait $PID 2>/dev/null
    done
    
    REQUEST_COUNT=$((REQUEST_COUNT + BATCH_SIZE))
    
    # Rate limit throttle: stay under 1200 req/min (80% of 1500)
    ELAPSED=$(($(date +%s) - RATE_LIMIT_START))
    if [ "$ELAPSED" -gt 0 ]; then
      CURRENT_RATE=$((REQUEST_COUNT * 60 / ELAPSED))
      if [ "$CURRENT_RATE" -gt 1200 ]; then
        sleep 1
      fi
    fi
  done
  
  # Count results
  FETCHED=$(ls "$TOKEN_DIR"/*.json 2>/dev/null | while read f; do [ -s "$f" ] && echo 1; done | wc -l | tr -d ' ')
  echo " ✓ ${FETCHED}/${TOTAL_HOURS} hours"
done

echo ""
echo "=== PHASE 1 Complete: ${REQUEST_COUNT} API requests ==="
echo ""

# ============================================================
# PHASE 2: Generate SQL and import to DB
# ============================================================
echo "=== PHASE 2: Importing to database ==="
echo ""

TOTAL_RECORDS=0
CURRENT=0
TEMP_SQL="/tmp/paradex_v3_import_$$.sql"

for SYMBOL in $MARKETS; do
  CURRENT=$((CURRENT + 1))
  BASE_ASSET=$(echo "$SYMBOL" | cut -d'-' -f1)
  TOKEN_DIR="${DATA_DIR}/${SYMBOL}"
  
  # Count valid data files
  FILE_COUNT=$(ls "$TOKEN_DIR"/*.json 2>/dev/null | while read f; do [ -s "$f" ] && echo 1; done | wc -l | tr -d ' ')
  
  if [ "$FILE_COUNT" -eq 0 ]; then
    echo "[${CURRENT}/${MARKET_COUNT}] ${BASE_ASSET}: no data"
    continue
  fi
  
  # Generate SQL from all hourly JSON files
  > "$TEMP_SQL"
  
  for f in "$TOKEN_DIR"/*.json; do
    [ -s "$f" ] || continue
    cat "$f"
  done | jq -r \
    --arg symbol "$SYMBOL" \
    --arg base_asset "$BASE_ASSET" \
    --arg interval "$INTERVAL_HOURS" \
    --arg events "$EVENTS_PER_YEAR" \
    --arg now "$NOW_SEC" '
    (.funding_rate | tonumber) as $rate_raw |
    ($rate_raw * 100) as $rate_raw_percent |
    ($rate_raw_percent / ($interval | tonumber)) as $rate_1h_percent |
    ($rate_raw_percent * ($events | tonumber)) as $rate_apr |
    .full_hour as $funding_time |
    "INSERT OR REPLACE INTO paradex_funding_v3 (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source) VALUES ('\''\($symbol)'\'', '\''\($base_asset)'\'', \($funding_time), \($rate_raw), \($rate_raw_percent), \($interval), \($rate_1h_percent), \($rate_apr), \($now), '\''import'\'');"
  ' >> "$TEMP_SQL" 2>/dev/null
  
  BATCH_RECORDS=$(wc -l < "$TEMP_SQL" | tr -d ' ')
  
  if [ "$BATCH_RECORDS" -eq 0 ]; then
    echo "[${CURRENT}/${MARKET_COUNT}] ${BASE_ASSET}: no valid records"
    continue
  fi
  
  if npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1; then
    echo "[${CURRENT}/${MARKET_COUNT}] ${BASE_ASSET}: ✓ ${BATCH_RECORDS} records imported"
    TOTAL_RECORDS=$((TOTAL_RECORDS + BATCH_RECORDS))
  else
    echo "[${CURRENT}/${MARKET_COUNT}] ${BASE_ASSET}: ⚠️  DB error (${BATCH_RECORDS} records)"
  fi
done

# Cleanup
rm -f "$TEMP_SQL"

echo ""
echo "=================================================="
echo "Import Complete!"
echo "=================================================="
echo "Total records: ${TOTAL_RECORDS}"
echo "Total markets: ${MARKET_COUNT}"
echo "Total API requests: ${REQUEST_COUNT}"
echo "Data dir: ${DATA_DIR}"
echo ""
echo "Verify:"
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) as total, COUNT(DISTINCT symbol) as symbols FROM paradex_funding_v3 WHERE source = 'import'\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT symbol, datetime(funding_time, 'unixepoch') as ts, rate_raw_percent, rate_1h_percent, rate_apr FROM paradex_funding_v3 WHERE source = 'import' ORDER BY funding_time DESC LIMIT 10\""
echo "=================================================="
