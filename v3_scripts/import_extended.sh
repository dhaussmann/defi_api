#!/bin/bash

# V3: Import Extended Historical Funding Data
# 
# Features:
# - Unified schema with percent-based rates
# - Direct API access (no proxy)
# - Batch processing for efficiency
# - Can be triggered via API endpoint

set -e

DAYS_BACK=${1:-30}
TEMP_SQL="/tmp/extended_v3_import_$$.sql"

echo "=================================================="
echo "V3 Extended Funding Data Import"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: extended_funding_v3 table"
echo "Direct API: https://api.starknet.extended.exchange"
echo "=================================================="
echo ""

# Calculate timestamps (Extended uses milliseconds)
END_TS=$(date -u +%s)000
START_TS=$((END_TS - DAYS_BACK * 86400 * 1000))
NOW_SEC=$(date -u +%s)

# Fetch all active markets dynamically
echo "Fetching active markets from Extended API..."
MARKETS=$(curl -s "https://api.starknet.extended.exchange/api/v1/info/markets" \
  -H "User-Agent: Mozilla/5.0 (compatible; DefiAPI/1.0)" \
  -H "Accept: application/json" | \
  jq -r '.data[] | select(.status == "ACTIVE" and .active == true) | "\(.name):\(.assetName)"')

if [ -z "$MARKETS" ]; then
  echo "Error: No markets found"
  exit 1
fi

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found ${MARKET_COUNT} active markets"
echo ""

TOTAL_RECORDS=0
INTERVAL_HOURS=1
EVENTS_PER_YEAR=$((365 * 24))
CURRENT=0

while IFS=: read -r SYMBOL TOKEN; do
  CURRENT=$((CURRENT + 1))
  echo "[${CURRENT}/${MARKET_COUNT}] ${TOKEN} (${SYMBOL})..."
  
  # Fetch funding history (direct API, no proxy)
  API_URL="https://api.starknet.extended.exchange/api/v1/info/${SYMBOL}/funding?startTime=${START_TS}&endTime=${END_TS}"
  
  FUNDINGS=$(curl -s "$API_URL" \
    -H "User-Agent: Mozilla/5.0 (compatible; DefiAPI/1.0)" \
    -H "Accept: application/json")
  
  # Check if response is valid
  if [ -z "$FUNDINGS" ] || [ "$FUNDINGS" = "null" ]; then
    echo "[${TOKEN}] ⚠️  No data received"
    continue
  fi
  
  # Handle both array and wrapped response
  RECORD_COUNT=$(echo "$FUNDINGS" | jq 'if type == "array" then length elif .data then .data | length else 0 end')
  
  if [ "$RECORD_COUNT" -eq 0 ]; then
    echo "[${TOKEN}] ⚠️  No funding data"
    continue
  fi
  
  echo "[${TOKEN}] ✓ ${RECORD_COUNT} records received"
  
  # Generate SQL with unified V3 schema
  # Rate calculations:
  # - rate_raw: Original decimal value (e.g., 0.0001)
  # - rate_raw_percent: rate_raw * 100 (e.g., 0.01%)
  # - rate_1h_percent: rate_raw_percent / interval_hours
  # - rate_apr: rate_raw_percent * events_per_year
  
  > "$TEMP_SQL"
  
  echo "$FUNDINGS" | jq -r \
    --arg symbol "$SYMBOL" \
    --arg token "$TOKEN" \
    --arg interval "$INTERVAL_HOURS" \
    --arg events "$EVENTS_PER_YEAR" \
    --arg now "$NOW_SEC" '
    (if type == "array" then . else .data end) | 
    .[] | 
    (.f | tonumber) as $rate_raw |
    ($rate_raw * 100) as $rate_raw_percent |
    ($rate_raw_percent / ($interval | tonumber)) as $rate_1h_percent |
    ($rate_raw_percent * ($events | tonumber)) as $rate_apr |
    "INSERT OR REPLACE INTO extended_funding_v3 (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source) VALUES ('\''\($symbol)'\'', '\''\($token)'\'', \(.T), \($rate_raw), \($rate_raw_percent), \($interval), \($rate_1h_percent), \($rate_apr), \($now), '\''import'\'');"
  ' >> "$TEMP_SQL"
  
  # Execute batch insert
  BATCH_RECORDS=$(wc -l < "$TEMP_SQL" | tr -d ' ')
  
  if [ "$BATCH_RECORDS" -gt 0 ]; then
    npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1
    echo "[${TOKEN}] ✓ ${BATCH_RECORDS} records imported"
    TOTAL_RECORDS=$((TOTAL_RECORDS + BATCH_RECORDS))
  fi
  
  sleep 0.1
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
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) as total, COUNT(DISTINCT symbol) as tokens FROM extended_funding_v3\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT symbol, funding_time, rate_raw_percent, rate_1h_percent, rate_apr FROM extended_funding_v3 ORDER BY funding_time DESC LIMIT 10\""
echo "=================================================="
