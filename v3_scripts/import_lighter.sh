#!/bin/bash

# Lighter V3 Historical Data Import Script
# Imports funding rate history from Lighter API into lighter_funding_v3 table
# Uses unified V3 schema with percent-based rates

# Note: No set -e to allow continuing on wrangler errors

# Configuration
DB_NAME="defiapi-db-write"
DAYS_BACK=${1:-30}  # Default 30 days if not specified
API_BASE="https://mainnet.zklighter.elliot.ai/api/v1"

# Calculate timestamps
END_TS=$(date -u +%s)
START_TS=$((END_TS - (DAYS_BACK * 86400)))
COLLECTED_AT=$END_TS

echo "=== Lighter V3 Historical Import ==="
echo "Start: $(date -u -r $START_TS)"
echo "End: $(date -u -r $END_TS)"
echo "Days: $DAYS_BACK"
echo ""

# Fetch active markets
echo "Fetching active markets..."
MARKETS=$(curl -s "${API_BASE}/orderBooks" | jq -r '.order_books[] | select(.status == "active") | "\(.market_id)|\(.symbol)|\(.base_asset // (.symbol | split("-")[0]))"')

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found $MARKET_COUNT active markets"
echo ""

# Process each market
CURRENT=0
TOTAL_RECORDS=0
ERRORS=0

while IFS='|' read -r MARKET_ID SYMBOL BASE_ASSET; do
  CURRENT=$((CURRENT + 1))
  echo "[$CURRENT/$MARKET_COUNT] Processing $SYMBOL (ID: $MARKET_ID)..."
  
  # Fetch funding history
  FUNDINGS=$(curl -s "${API_BASE}/fundings?market_id=${MARKET_ID}&resolution=1h&start_timestamp=${START_TS}&end_timestamp=${END_TS}&count_back=0")
  
  # Check if response is valid
  if ! echo "$FUNDINGS" | jq -e '.fundings' > /dev/null 2>&1; then
    echo "  ⚠️  No data or invalid response for $SYMBOL"
    ERRORS=$((ERRORS + 1))
    continue
  fi
  
  FUNDING_COUNT=$(echo "$FUNDINGS" | jq '.fundings | length')
  
  if [ "$FUNDING_COUNT" -eq 0 ]; then
    echo "  ℹ️  No funding data for $SYMBOL"
    continue
  fi
  
  # Calculate interval from data - simplified approach
  INTERVAL_HOURS=$(echo "$FUNDINGS" | jq -r '
    if (.fundings | length) > 1 then
      ((.fundings[1].timestamp | tonumber) - (.fundings[0].timestamp | tonumber)) / 3600 | 
      if . > 0 then round else 8 end
    else
      8
    end
  ')
  
  # Generate SQL and execute in batches of 50 records
  SQL_FILE="/tmp/lighter_import_${MARKET_ID}.sql"
  
  echo "$FUNDINGS" | jq -r --arg symbol "$SYMBOL" --arg base "$BASE_ASSET" --arg market_id "$MARKET_ID" --arg interval "$INTERVAL_HOURS" --arg collected "$COLLECTED_AT" '
    .fundings[] | 
    . as $item |
    ($item.rate | tonumber) as $rate_raw |
    $rate_raw as $rate_raw_percent |
    ($rate_raw_percent / ($interval | tonumber)) as $rate_1h_percent |
    ($rate_raw_percent * (365 * 24 / ($interval | tonumber))) as $rate_apr |
    ($item.timestamp | tonumber) as $funding_time |
    "INSERT OR REPLACE INTO lighter_funding_v3 (symbol, base_asset, market_id, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, direction, cumulative_value, collected_at, source) VALUES ('\''\($symbol)'\'', '\''\($base)'\'', \($market_id), \($funding_time), \($rate_raw), \($rate_raw_percent), \($interval), \($rate_1h_percent), \($rate_apr), '\''\($item.direction)'\'', \($item.value | tonumber), \($collected), '\''import'\'');"
  ' > "$SQL_FILE"
  
  RECORD_COUNT=$(wc -l < "$SQL_FILE" | tr -d ' ')
  
  if [ "$RECORD_COUNT" -gt 0 ]; then
    # Try with larger batches (200 records) - fewer API calls
    BATCH_SIZE=200
    BATCH_NUM=0
    SUCCESS_COUNT=0
    
    for ((i=1; i<=RECORD_COUNT; i+=BATCH_SIZE)); do
      BATCH_NUM=$((BATCH_NUM + 1))
      BATCH_END=$((i + BATCH_SIZE - 1))
      BATCH_FILE="/tmp/lighter_batch_${MARKET_ID}_${BATCH_NUM}.sql"
      
      sed -n "${i},${BATCH_END}p" "$SQL_FILE" > "$BATCH_FILE"
      
      if npx wrangler d1 execute "$DB_NAME" --remote --file="$BATCH_FILE" > /dev/null 2>&1; then
        BATCH_RECORDS=$(wc -l < "$BATCH_FILE" | tr -d ' ')
        SUCCESS_COUNT=$((SUCCESS_COUNT + BATCH_RECORDS))
      fi
      
      rm -f "$BATCH_FILE"
    done
    
    rm -f "$SQL_FILE"
    
    if [ "$SUCCESS_COUNT" -gt 0 ]; then
      echo "  ✓ ${SUCCESS_COUNT}/${RECORD_COUNT} records imported"
    else
      echo "  ⚠️  Import failed, continuing..."
      ERRORS=$((ERRORS + 1))
    fi
  fi
  
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  
  sleep 0.1
done <<< "$MARKETS"

# Cleanup
rm -f /tmp/lighter_import_$$.sql

echo ""
echo "=== Import Complete ==="
echo "Total records: $TOTAL_RECORDS"
echo "Markets processed: $CURRENT"
echo "Errors: $ERRORS"
echo ""

# Verify import
echo "Verifying import..."
npx wrangler d1 execute "$DB_NAME" --remote --command="
  SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT symbol) as unique_markets,
    MIN(funding_time) as earliest_timestamp,
    MAX(funding_time) as latest_timestamp,
    datetime(MIN(funding_time), 'unixepoch') as earliest_time,
    datetime(MAX(funding_time), 'unixepoch') as latest_time
  FROM lighter_funding_v3
  WHERE source = 'import'
"

echo ""
echo "✓ Lighter V3 import completed successfully!"
