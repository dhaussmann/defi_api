#!/bin/bash

# V2: Import Aster Raw Data (Working Version)
# Key fix: No BEGIN/COMMIT in SQL files

set -e

DAYS_BACK=${1:-7}
TEMP_SQL="/tmp/aster_import_$$.sql"

echo "=================================================="
echo "V2 Aster Raw Data Import (Working)"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: aster_raw_data table"
echo "=================================================="
echo ""

# Calculate timestamps (Aster uses milliseconds)
END_TS=$(date -u +%s)000
START_TS=$((END_TS - DAYS_BACK * 86400 * 1000))

echo "Fetching active perpetual markets..."
MARKETS=$(curl -s "https://fapi.asterdex.com/fapi/v1/exchangeInfo" | \
  jq -r '.symbols[] | select(.contractType == "PERPETUAL" and .status == "TRADING") | "\(.symbol):\(.baseAsset):\(.quoteAsset)"')

if [ -z "$MARKETS" ]; then
  echo "Error: No markets found"
  exit 1
fi

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found ${MARKET_COUNT} active perpetual markets"
echo ""

# Update market metadata (without BEGIN/COMMIT)
echo "Updating market metadata..."
> "$TEMP_SQL"
NOW_SEC=$(date -u +%s)

while IFS=: read -r SYMBOL BASE_ASSET QUOTE_ASSET; do
  echo "INSERT OR REPLACE INTO aster_markets (symbol, base_asset, quote_asset, contract_type, status, last_updated) VALUES ('${SYMBOL}', '${BASE_ASSET}', '${QUOTE_ASSET}', 'PERPETUAL', 'TRADING', ${NOW_SEC});" >> "$TEMP_SQL"
done <<< "$MARKETS"

npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1

echo "✓ Market metadata updated"
echo ""

# Import funding data
CURRENT=0
TOTAL_RECORDS=0

echo "Importing funding data with interval detection..."

while IFS=: read -r SYMBOL BASE_ASSET QUOTE_ASSET; do
  CURRENT=$((CURRENT + 1))
  echo "[${CURRENT}/${MARKET_COUNT}] ${SYMBOL} (${BASE_ASSET})..."
  
  # Fetch funding history via proxy
  FUNDINGS=$(curl -s "https://aster.wirewaving.workers.dev?symbol=${SYMBOL}&startTime=${START_TS}&endTime=${END_TS}&limit=1000")
  
  RECORD_COUNT=$(echo "$FUNDINGS" | jq '. | length')
  
  if [ "$RECORD_COUNT" -eq 0 ] || [ "$RECORD_COUNT" = "null" ]; then
    echo "  ⚠️  No data"
    continue
  fi
  
  echo "  ✓ ${RECORD_COUNT} records"
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  
  # Calculate interval and generate SQL (without BEGIN/COMMIT)
  echo "$FUNDINGS" | jq -r --arg symbol "$SYMBOL" --arg base "$BASE_ASSET" --arg now "$NOW_SEC" '
    # Sort by funding time
    sort_by(.fundingTime) |
    
    # Calculate time differences
    [.[:-1] as $prev | .[1:] as $next | range(0; ($next | length)) | ($next[.].fundingTime - $prev[.].fundingTime)] as $diffs |
    
    # Calculate median interval
    ($diffs | sort | if (length % 2 == 0) then (.[length/2 - 1] + .[length/2]) / 2 else .[length/2 | floor] end) as $median_diff |
    
    # Convert to hours
    ($median_diff / 3600000) as $interval_hours |
    
    # Round to nearest common interval (1, 4, or 8)
    (if $interval_hours < 2.5 then 1 elif $interval_hours < 6 then 4 else 8 end) as $interval |
    
    # Calculate events per year
    (365 * 24 / $interval) as $events_per_year |
    
    # Generate INSERT statements
    .[] |
    (.fundingRate | tonumber) as $rate_raw |
    ($rate_raw * 100) as $rate_raw_percent |
    ($rate_raw_percent / $interval) as $rate_hourly |
    ($rate_raw_percent * $events_per_year) as $rate_annual |
    
    "INSERT OR REPLACE INTO aster_raw_data (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, rate_hourly, rate_annual, interval_hours, events_per_year, collected_at, source) VALUES ('\''\($symbol)'\'', '\''\($base)'\'', \(.fundingTime), \($rate_raw), \($rate_raw_percent), \($rate_hourly), \($rate_annual), \($interval), \($events_per_year), \($now), '\''import'\'');"
  ' > "$TEMP_SQL"
  
  # Execute
  npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1
  
  sleep 0.05
  
done <<< "$MARKETS"

# Cleanup
rm -f "$TEMP_SQL"

echo ""
echo "=================================================="
echo "Import Complete!"
echo "=================================================="
echo "Total records: ${TOTAL_RECORDS}"
echo "Total markets: ${MARKET_COUNT}"
echo ""
echo "Verify:"
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) FROM aster_raw_data\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT * FROM aster_latest LIMIT 10\""
echo "=================================================="
