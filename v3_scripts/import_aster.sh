#!/bin/bash

# Aster V3 Historical Data Import Script
# Imports funding rate history from Aster API into aster_funding_v3 table
# Uses unified V3 schema with percent-based rates

set -e

# Configuration
DB_NAME="defiapi-db-write"
DAYS_BACK=${1:-30}  # Default 30 days if not specified
API_BASE="https://fapi.asterdex.com/fapi/v1"

# Calculate timestamps (in milliseconds for Aster API)
END_MS=$(date -u +%s)000
START_MS=$((END_MS - (DAYS_BACK * 86400 * 1000)))
COLLECTED_AT=$((END_MS / 1000))

echo "=== Aster V3 Historical Import ==="
echo "Start: $(date -u -d @$((START_MS / 1000)) 2>/dev/null || date -u -r $((START_MS / 1000)))"
echo "End: $(date -u -d @$((END_MS / 1000)) 2>/dev/null || date -u -r $((END_MS / 1000)))"
echo "Days: $DAYS_BACK"
echo ""

# Fetch active markets
echo "Fetching active markets..."
MARKETS=$(curl -s "${API_BASE}/exchangeInfo" | jq -r '.symbols[] | select(.contractType == "PERPETUAL" and .status == "TRADING") | .symbol + "|" + .baseAsset')

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found $MARKET_COUNT active markets"
echo ""

# Process each market
CURRENT=0
TOTAL_RECORDS=0
ERRORS=0

while IFS='|' read -r SYMBOL BASE_ASSET; do
  CURRENT=$((CURRENT + 1))
  echo "[$CURRENT/$MARKET_COUNT] Processing $SYMBOL..."
  
  # Fetch funding history
  FUNDINGS=$(curl -s "${API_BASE}/fundingRate?symbol=${SYMBOL}&startTime=${START_MS}&endTime=${END_MS}&limit=1000")
  
  # Check if response is valid
  if ! echo "$FUNDINGS" | jq -e '. | type == "array"' > /dev/null 2>&1; then
    echo "  ⚠️  No data or invalid response for $SYMBOL"
    ERRORS=$((ERRORS + 1))
    continue
  fi
  
  FUNDING_COUNT=$(echo "$FUNDINGS" | jq '. | length')
  
  if [ "$FUNDING_COUNT" -eq 0 ]; then
    echo "  ℹ️  No funding data for $SYMBOL"
    continue
  fi
  
  # Calculate interval from data - simplified approach
  INTERVAL_HOURS=$(echo "$FUNDINGS" | jq -r '
    if (. | length) > 1 then
      ((.[1].fundingTime | tonumber) - (.[0].fundingTime | tonumber)) / (60 * 60 * 1000) | 
      if . > 0 then round else 8 end
    else
      8
    end
  ')
  
  # Ensure interval is at least 1 hour
  if [ "$INTERVAL_HOURS" -eq 0 ]; then
    INTERVAL_HOURS=8
  fi
  
  # Generate SQL for batch insert
  SQL_FILE="/tmp/aster_import_${SYMBOL}.sql"
  
  echo "$FUNDINGS" | jq -r --arg symbol "$SYMBOL" --arg base "$BASE_ASSET" --arg interval "$INTERVAL_HOURS" --arg collected "$COLLECTED_AT" '
    .[] | 
    . as $item |
    ($item.fundingRate | tonumber) as $rate_raw |
    ($rate_raw * 100) as $rate_raw_percent |
    ($rate_raw_percent / ($interval | tonumber)) as $rate_1h_percent |
    ($rate_raw_percent * (365 * 24 / ($interval | tonumber))) as $rate_apr |
    ($item.fundingTime / 1000 | floor) as $funding_time |
    "INSERT OR REPLACE INTO aster_funding_v3 (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source) VALUES (\"\($symbol)\", \"\($base)\", \($funding_time), \($rate_raw), \($rate_raw_percent), \($interval), \($rate_1h_percent), \($rate_apr), \($collected), \"import\");"
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
  FROM aster_funding_v3
  WHERE source = 'import'
"

echo ""
echo "✓ Aster V3 import completed successfully!"
