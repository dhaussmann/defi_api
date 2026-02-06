#!/bin/bash

# V3: Import Hyperliquid Historical Funding Data
# 
# Features:
# - Unified schema with percent-based rates
# - Direct API access (no proxy)
# - Batch processing for efficiency
# - Can be triggered via API endpoint

set -e

DAYS_BACK=${1:-30}
TEMP_SQL="/tmp/hyperliquid_v3_import_$$.sql"

echo "=================================================="
echo "V3 Hyperliquid Funding Data Import"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: hyperliquid_funding_v3 table"
echo "Direct API: https://api.hyperliquid.xyz"
echo "=================================================="
echo ""

# Calculate timestamps (Hyperliquid uses milliseconds)
END_TS=$(date -u +%s)000
START_TS=$((END_TS - DAYS_BACK * 86400 * 1000))
NOW_SEC=$(date -u +%s)

# Fetch active coins
echo "Fetching active coins from Hyperliquid API..."
COINS=$(curl -s "https://api.hyperliquid.xyz/info" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"type":"meta"}' | \
  jq -r '.universe[].name')

if [ -z "$COINS" ]; then
  echo "Error: No coins found"
  exit 1
fi

COIN_COUNT=$(echo "$COINS" | wc -l | tr -d ' ')
echo "Found ${COIN_COUNT} active coins"
echo ""

TOTAL_RECORDS=0
INTERVAL_HOURS=1
EVENTS_PER_YEAR=$((365 * 24))
CURRENT=0

for COIN in $COINS; do
  CURRENT=$((CURRENT + 1))
  echo "[${CURRENT}/${COIN_COUNT}] ${COIN}..."
  
  # Fetch funding history
  FUNDINGS=$(curl -s "https://api.hyperliquid.xyz/info" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"fundingHistory\",\"coin\":\"${COIN}\",\"startTime\":${START_TS},\"endTime\":${END_TS}}")
  
  # Check if response is valid
  if [ -z "$FUNDINGS" ] || [ "$FUNDINGS" = "null" ]; then
    echo "[${COIN}] ⚠️  No data received"
    continue
  fi
  
  RECORD_COUNT=$(echo "$FUNDINGS" | jq 'length')
  
  if [ "$RECORD_COUNT" -eq 0 ]; then
    echo "[${COIN}] ⚠️  No funding data"
    continue
  fi
  
  echo "[${COIN}] ✓ ${RECORD_COUNT} records received"
  
  # Generate SQL with unified V3 schema
  # Rate calculations:
  # - rate_raw: Original decimal value (e.g., 0.0001)
  # - rate_raw_percent: rate_raw * 100 (e.g., 0.01%)
  # - rate_1h_percent: rate_raw_percent / interval_hours
  # - rate_apr: rate_raw_percent * events_per_year
  
  > "$TEMP_SQL"
  
  echo "$FUNDINGS" | jq -r \
    --arg coin "$COIN" \
    --arg interval "$INTERVAL_HOURS" \
    --arg events "$EVENTS_PER_YEAR" \
    --arg now "$NOW_SEC" '
    .[] | 
    (.fundingRate | tonumber) as $rate_raw |
    ($rate_raw * 100) as $rate_raw_percent |
    ($rate_raw_percent / ($interval | tonumber)) as $rate_1h_percent |
    ($rate_raw_percent * ($events | tonumber)) as $rate_apr |
    (.time / 1000 | floor) as $funding_time |
    "INSERT OR REPLACE INTO hyperliquid_funding_v3 (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source) VALUES ('\''\($coin)'\'', '\''\($coin)'\'', \($funding_time), \($rate_raw), \($rate_raw_percent), \($interval), \($rate_1h_percent), \($rate_apr), \($now), '\''import'\'');"
  ' >> "$TEMP_SQL"
  
  # Execute batch insert
  BATCH_RECORDS=$(wc -l < "$TEMP_SQL" | tr -d ' ')
  
  if [ "$BATCH_RECORDS" -gt 0 ]; then
    npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1
    echo "[${COIN}] ✓ ${BATCH_RECORDS} records imported"
    TOTAL_RECORDS=$((TOTAL_RECORDS + BATCH_RECORDS))
  fi
  
  sleep 0.1
done

# Cleanup
rm -f "$TEMP_SQL"

echo ""
echo "=================================================="
echo "Import Complete!"
echo "=================================================="
echo "Total records: ${TOTAL_RECORDS}"
echo "Total coins: ${COIN_COUNT}"
echo ""
echo "Verify:"
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) as total, COUNT(DISTINCT symbol) as coins FROM hyperliquid_funding_v3\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT symbol, funding_time, rate_raw_percent, rate_1h_percent, rate_apr FROM hyperliquid_funding_v3 ORDER BY funding_time DESC LIMIT 10\""
echo "=================================================="
