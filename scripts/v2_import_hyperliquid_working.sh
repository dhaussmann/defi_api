#!/bin/bash

# V2: Import Hyperliquid Raw Data
# Fetches 1-hour funding rate data from Hyperliquid API

set -e

DAYS_BACK=${1:-30}
TEMP_SQL="/tmp/hyperliquid_import_$$.sql"

echo "=================================================="
echo "V2 Hyperliquid Raw Data Import"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: hyperliquid_raw_data table"
echo "=================================================="
echo ""

# Calculate timestamps (Hyperliquid uses milliseconds)
END_TS=$(date -u +%s)000
START_TS=$((END_TS - DAYS_BACK * 86400 * 1000))

echo "Fetching active markets from Hyperliquid API..."

# Fetch meta info to get all active coins
META=$(curl -s -X POST https://api.hyperliquid.xyz/info \
  -H "Content-Type: application/json" \
  -d '{"type": "meta"}')

# Extract coin names from universe array, excluding delisted coins
COINS=$(echo "$META" | jq -r '.universe[] | select(.isDelisted != true) | .name' | sort -u)

if [ -z "$COINS" ]; then
  echo "Error: No coins found"
  exit 1
fi

COIN_COUNT=$(echo "$COINS" | wc -l | tr -d ' ')
echo "Found ${COIN_COUNT} active coins"
echo ""

# Update market metadata
echo "Updating market metadata..."
> "$TEMP_SQL"
NOW_SEC=$((END_TS / 1000))

while read -r COIN; do
  echo "INSERT OR REPLACE INTO hyperliquid_markets (symbol, status, last_updated) VALUES ('${COIN}', 'active', ${NOW_SEC});" >> "$TEMP_SQL"
done <<< "$COINS"

npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1

echo "✓ Market metadata updated"
echo ""

# Import funding data
CURRENT=0
TOTAL_RECORDS=0
FAILED=0

echo "Importing funding data (1h intervals)..."

while read -r COIN; do
  CURRENT=$((CURRENT + 1))
  echo "[${CURRENT}/${COIN_COUNT}] ${COIN}..."
  
  # Fetch funding history from Hyperliquid API
  FUNDINGS=$(curl -s -X POST https://api.hyperliquid.xyz/info \
    -H "Content-Type: application/json" \
    -d "{\"type\": \"fundingHistory\", \"coin\": \"${COIN}\", \"startTime\": ${START_TS}, \"endTime\": ${END_TS}}")
  
  # Check if response is valid array
  RECORD_COUNT=$(echo "$FUNDINGS" | jq '. | length' 2>/dev/null || echo "0")
  
  if [ "$RECORD_COUNT" -eq 0 ] || [ "$RECORD_COUNT" = "null" ]; then
    echo "  ⚠️  No data"
    FAILED=$((FAILED + 1))
    continue
  fi
  
  echo "  ✓ ${RECORD_COUNT} records"
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  
  # Generate SQL (without BEGIN/COMMIT)
  # Hyperliquid API format: {"time": 1770206400000, "fundingRate": "0.000013"}
  echo "$FUNDINGS" | jq -r --arg symbol "$COIN" --arg now "$NOW_SEC" '
    .[] | 
    (.fundingRate | tonumber) as $rate |
    ($rate * 100) as $rate_percent |
    ($rate * 24 * 365 * 100) as $rate_annual |
    "INSERT OR REPLACE INTO hyperliquid_raw_data (symbol, timestamp, rate, rate_percent, rate_annual, collected_at, source) VALUES ('\''\($symbol)'\'', \(.time), \($rate), \($rate_percent), \($rate_annual), \($now), '\''import'\'');"
  ' > "$TEMP_SQL"
  
  # Execute
  npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1
  
  sleep 0.05
  
done <<< "$COINS"

# Cleanup
rm -f "$TEMP_SQL"

echo ""
echo "=================================================="
echo "Import Complete!"
echo "=================================================="
echo "Total records: ${TOTAL_RECORDS}"
echo "Total coins: ${COIN_COUNT}"
echo "Failed coins: ${FAILED}"
echo ""
echo "Verify:"
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) as records, COUNT(DISTINCT symbol) as coins FROM hyperliquid_raw_data\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT * FROM hyperliquid_latest ORDER BY rate_annual DESC LIMIT 10\""
echo "=================================================="
