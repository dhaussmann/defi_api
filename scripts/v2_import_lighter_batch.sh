#!/bin/bash

# V2: Import Lighter Raw Data - Batch Version with Enhanced Logging
# Processes data in batches to avoid wrangler timeouts
# Timestamps: API returns SECONDS, DB needs MILLISECONDS (multiply by 1000)

set -e

DAYS_BACK=${1:-7}
BATCH_SIZE=10  # Process 10 symbols at a time
LOG_FILE="/tmp/lighter_batch_$$.log"

log() {
  echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=================================================="
log "V2 Lighter Raw Data Import (Batch Mode)"
log "=================================================="
log "Period: Last ${DAYS_BACK} days"
log "Batch size: ${BATCH_SIZE} symbols"
log "Log file: ${LOG_FILE}"
log "=================================================="
log ""

# Calculate timestamps (in seconds)
END_TS=$(date -u +%s)
START_TS=$((END_TS - DAYS_BACK * 86400))

log "Time range: $(date -r $START_TS '+%Y-%m-%d %H:%M:%S') to $(date -r $END_TS '+%Y-%m-%d %H:%M:%S')"
log ""

log "Fetching active markets from API..."
MARKETS=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/orderBooks" | jq -r '.order_books[] | select(.status == "active") | "\(.market_id):\(.symbol)"')

if [ -z "$MARKETS" ]; then
  log "ERROR: No markets found"
  exit 1
fi

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
log "✓ Found ${MARKET_COUNT} active markets"
log ""

# Update market metadata in one batch
log "Updating market metadata..."
METADATA_SQL=$(echo "$MARKETS" | while IFS=: read -r MARKET_ID SYMBOL; do
  echo "INSERT OR REPLACE INTO lighter_markets (market_id, symbol, status, last_updated) VALUES (${MARKET_ID}, '${SYMBOL}', 'active', ${END_TS});"
done | tr '\n' ' ')

log "  Executing metadata batch insert..."
if npx wrangler d1 execute defiapi-db-write --remote --command="$METADATA_SQL" > /dev/null 2>&1; then
  log "✓ Market metadata updated"
else
  log "⚠️  Market metadata update failed (non-critical)"
fi
log ""

# Import funding data in batches
CURRENT=0
TOTAL_RECORDS=0
BATCH_NUM=0
TEMP_SQL="/tmp/lighter_batch_sql_$$.sql"

log "Starting funding data import..."
log "Processing ${MARKET_COUNT} symbols in batches of ${BATCH_SIZE}..."
log ""

# Convert markets to array for batch processing
MARKETS_ARRAY=()
while IFS=: read -r MARKET_ID SYMBOL; do
  MARKETS_ARRAY+=("${MARKET_ID}:${SYMBOL}")
done <<< "$MARKETS"

# Process in batches
for ((i=0; i<${#MARKETS_ARRAY[@]}; i+=BATCH_SIZE)); do
  BATCH_NUM=$((BATCH_NUM + 1))
  BATCH_START=$i
  BATCH_END=$((i + BATCH_SIZE))
  if [ $BATCH_END -gt ${#MARKETS_ARRAY[@]} ]; then
    BATCH_END=${#MARKETS_ARRAY[@]}
  fi
  
  BATCH_COUNT=$((BATCH_END - BATCH_START))
  log "--- Batch ${BATCH_NUM} (Symbols ${BATCH_START}-$((BATCH_END-1)), ${BATCH_COUNT} symbols) ---"
  
  # Clear SQL file for this batch
  > "$TEMP_SQL"
  BATCH_RECORDS=0
  
  # Process each symbol in this batch
  for ((j=BATCH_START; j<BATCH_END; j++)); do
    IFS=: read -r MARKET_ID SYMBOL <<< "${MARKETS_ARRAY[$j]}"
    CURRENT=$((CURRENT + 1))
    
    log "  [${CURRENT}/${MARKET_COUNT}] ${SYMBOL}..."
    
    # Fetch funding data
    log "    Fetching data from API..."
    FUNDINGS=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=${MARKET_ID}&resolution=1h&start_timestamp=${START_TS}&end_timestamp=${END_TS}&count_back=0")
    
    RECORD_COUNT=$(echo "$FUNDINGS" | jq '.fundings | length')
    
    if [ "$RECORD_COUNT" -eq 0 ]; then
      log "    ⚠️  No data available"
      continue
    fi
    
    log "    ✓ Received ${RECORD_COUNT} records"
    BATCH_RECORDS=$((BATCH_RECORDS + RECORD_COUNT))
    TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
    
    # Generate SQL and append to batch file
    log "    Generating SQL statements..."
    echo "$FUNDINGS" | jq -r --arg mid "$MARKET_ID" --arg sym "$SYMBOL" --arg now "$END_TS" '
      .fundings[] | 
      (.rate | tonumber) as $raw_rate |
      (if .direction == "short" then -$raw_rate else $raw_rate end) as $signed_rate |
      ($signed_rate * 24 * 365) as $rate_annual |
      (.timestamp * 1000) as $timestamp_ms |
      (.value | tonumber) as $cumulative |
      "INSERT OR REPLACE INTO lighter_raw_data (market_id, symbol, timestamp, rate, rate_annual, direction, cumulative_value, collected_at, source) VALUES (\($mid), '\''\($sym)'\'', \($timestamp_ms), \($signed_rate), \($rate_annual), '\''\(.direction)'\'', \($cumulative), \($now), '\''import'\'');"
    ' >> "$TEMP_SQL"
    
    log "    ✓ SQL generated"
  done
  
  # Execute batch
  if [ $BATCH_RECORDS -gt 0 ]; then
    SQL_SIZE=$(wc -c < "$TEMP_SQL" | tr -d ' ')
    log "  Executing batch: ${BATCH_RECORDS} records, SQL file size: ${SQL_SIZE} bytes"
    
    if npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1; then
      log "  ✓ Batch ${BATCH_NUM} completed successfully"
    else
      log "  ❌ Batch ${BATCH_NUM} failed - retrying..."
      sleep 2
      if npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1; then
        log "  ✓ Batch ${BATCH_NUM} retry successful"
      else
        log "  ❌ Batch ${BATCH_NUM} retry failed - skipping"
      fi
    fi
  else
    log "  ⚠️  Batch ${BATCH_NUM} had no data to insert"
  fi
  
  log ""
  sleep 0.5
done

# Cleanup
rm -f "$TEMP_SQL"

log "=================================================="
log "Import Complete!"
log "=================================================="
log "Total records imported: ${TOTAL_RECORDS}"
log "Total symbols processed: ${MARKET_COUNT}"
log "Total batches: ${BATCH_NUM}"
log "Log file: ${LOG_FILE}"
log "=================================================="
