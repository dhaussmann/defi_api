#!/bin/bash

# Lighter V3 Historical Data Import Script
# Imports funding rate history from Lighter API into lighter_funding_v3 table
# Uses unified V3 schema with percent-based rates

set -e

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
MARKETS=$(curl -s "${API_BASE}/orderBooks" | jq -r '.order_books[] | select(.status == "active") | .market_id + "|" + .symbol + "|" + (.base_asset // (.symbol | split("-")[0]))')

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
  
  # Calculate interval from data
  INTERVAL_HOURS=$(echo "$FUNDINGS" | jq -r '
    if (.fundings | length) > 1 then
      [.fundings[1:] as $tail | .fundings[:-1] as $head | 
       [$tail, $head] | transpose | 
       map(.[0].value - .[1].value)] | 
      sort | 
      .[length/2 | floor] / 3600 | round
    else
      8
    end
  ')
  
  # Generate SQL for batch insert
  SQL_FILE="/tmp/lighter_import_${MARKET_ID}.sql"
  
  echo "$FUNDINGS" | jq -r --arg symbol "$SYMBOL" --arg base "$BASE_ASSET" --arg interval "$INTERVAL_HOURS" --arg collected "$COLLECTED_AT" '
    .fundings[] | 
    . as $item |
    ($item.rate | tonumber) as $rate_raw |
    ($rate_raw * 100) as $rate_raw_percent |
    ($rate_raw_percent / ($interval | tonumber)) as $rate_1h_percent |
    ($rate_raw_percent * (365 * 24 / ($interval | tonumber))) as $rate_apr |
    ($item.value | tonumber | floor) as $funding_time |
    "INSERT OR REPLACE INTO lighter_funding_v3 (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, direction, cumulative_value, collected_at, source) VALUES (\"\($symbol)\", \"\($base)\", \($funding_time), \($rate_raw), \($rate_raw_percent), \($interval), \($rate_1h_percent), \($rate_apr), \"\($item.direction)\", \($item.value | tonumber), \($collected), \"import\");"
  ' > "$SQL_FILE"
  
  # Execute in batches of 100
  BATCH_SIZE=100
  RECORD_COUNT=$(wc -l < "$SQL_FILE" | tr -d ' ')
  
  for ((i=0; i<RECORD_COUNT; i+=BATCH_SIZE)); do
    BATCH_END=$((i + BATCH_SIZE))
    sed -n "$((i+1)),${BATCH_END}p" "$SQL_FILE" | \
      npx wrangler d1 execute "$DB_NAME" --remote --file=/dev/stdin > /dev/null 2>&1
  done
  
  rm "$SQL_FILE"
  
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  echo "  ✓ Imported $RECORD_COUNT records (interval: ${INTERVAL_HOURS}h)"
  
  # Small delay every 10 markets
  if [ $((CURRENT % 10)) -eq 0 ]; then
    sleep 0.1
  fi
  
done <<< "$MARKETS"

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
