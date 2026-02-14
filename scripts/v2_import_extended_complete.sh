#!/bin/bash

# V2: Import Extended Raw Data (Complete - All Active Markets)
# Fetches all active markets dynamically from Extended API

set -e

DAYS_BACK=${1:-30}
TEMP_SQL="/tmp/extended_import_$$.sql"

echo "=================================================="
echo "V2 Extended Raw Data Import (Complete)"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: extended_raw_data table"
echo "=================================================="
echo ""

# Calculate timestamps (Extended uses milliseconds)
END_TS=$(date -u +%s)000
START_TS=$((END_TS - DAYS_BACK * 86400 * 1000))

# Fetch all active markets from Extended API
echo "Fetching active markets from Extended API..."
MARKETS=$(curl -s "https://api.starknet.extended.exchange/api/v1/info/markets" | \
  jq -r '.data | map(select(.status == "ACTIVE")) | .[] | "\(.name):\(.assetName)"')

if [ -z "$MARKETS" ]; then
  echo "Error: No markets found"
  exit 1
fi

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found ${MARKET_COUNT} active markets"
echo ""

# Update market metadata (without BEGIN/COMMIT)
echo "Updating market metadata..."
> "$TEMP_SQL"
NOW_SEC=$(date -u +%s)

while IFS=: read -r NAME ASSET_NAME; do
  echo "INSERT OR REPLACE INTO extended_markets (symbol, base_asset, quote_asset, status, last_updated) VALUES ('${NAME}', '${ASSET_NAME}', 'USD', 'active', ${NOW_SEC});" >> "$TEMP_SQL"
done <<< "$MARKETS"

npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1

echo "✓ Market metadata updated"
echo ""

# Import funding data
CURRENT=0
TOTAL_RECORDS=0
FAILED=0

echo "Importing funding data (1h intervals)..."

while IFS=: read -r NAME ASSET_NAME; do
  CURRENT=$((CURRENT + 1))
  echo "[${CURRENT}/${MARKET_COUNT}] ${NAME} (${ASSET_NAME})..."
  
  # Fetch funding history via proxy
  API_URL="https://api.starknet.extended.exchange/api/v1/info/${NAME}/funding?startTime=${START_TS}&endTime=${END_TS}"
  PROXY_URL="https://extended.wirewaving.workers.dev/?url=$(echo -n "$API_URL" | jq -sRr @uri)"
  
  FUNDINGS=$(curl -s "$PROXY_URL")
  
  # Handle both direct array and wrapped response
  RECORD_COUNT=$(echo "$FUNDINGS" | jq 'if type == "array" then length elif .data then .data | length else 0 end')
  
  if [ "$RECORD_COUNT" -eq 0 ] || [ "$RECORD_COUNT" = "null" ]; then
    echo "  ⚠️  No data"
    FAILED=$((FAILED + 1))
    continue
  fi
  
  echo "  ✓ ${RECORD_COUNT} records"
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  
  # Generate SQL (without BEGIN/COMMIT)
  # Extended API format: {"m": "BTC-USD", "f": "0.000013", "T": 1770202800}
  echo "$FUNDINGS" | jq -r --arg symbol "$NAME" --arg token "$ASSET_NAME" --arg now "$NOW_SEC" '
    (if type == "array" then . else .data end) | 
    .[] | 
    (.f | tonumber) as $rate |
    ($rate * 100) as $rate_percent |
    ($rate * 24 * 365 * 100) as $rate_annual |
    "INSERT OR REPLACE INTO extended_raw_data (symbol, base_asset, timestamp, rate, rate_percent, rate_annual, collected_at, source) VALUES ('\''\($symbol)'\'', '\''\($token)'\'', \(.T), \($rate), \($rate_percent), \($rate_annual), \($now), '\''import'\'');"
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
echo "Failed markets: ${FAILED}"
echo ""
echo "Verify:"
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) as records, COUNT(DISTINCT base_asset) as tokens FROM extended_raw_data\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT * FROM extended_latest ORDER BY rate_annual DESC LIMIT 10\""
echo "=================================================="
