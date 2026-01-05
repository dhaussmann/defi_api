#!/bin/bash

# EdgeX Historical Data Backfill Script
# =====================================
# This script identifies missing hourly data for EdgeX contracts
# and documents the gaps for manual backfilling.
#
# Note: EdgeX does not provide a public REST API for historical klines/candles.
# The data can only be collected via WebSocket in real-time or from external sources.

set -e

DB_NAME="defiapi-db"
REMOTE="--remote"

echo "=================================="
echo "EdgeX Data Backfill Analysis"
echo "=================================="
echo ""

# Step 1: Get all EdgeX contracts from the API
echo "[1/4] Fetching all EdgeX contracts..."
CONTRACTS=$(curl -s "https://pro.edgex.exchange/api/v1/public/meta/getMetaData" | \
  jq -r '.data.contractList[] | select(.enableDisplay == true) | {contractId, contractName} | @json')

CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found $CONTRACT_COUNT active contracts"
echo ""

# Step 2: Check current database coverage
echo "[2/4] Analyzing database coverage..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT
  COUNT(DISTINCT symbol) as symbols,
  datetime(MIN(hour_timestamp), 'unixepoch') as earliest,
  datetime(MAX(hour_timestamp), 'unixepoch') as latest,
  COUNT(*) as total_hours
FROM market_history
WHERE exchange = 'edgex'
" --json | jq -r '.[] | .results[] | "  Symbols in DB: \(.symbols)\n  Earliest: \(.earliest)\n  Latest: \(.latest)\n  Total hours: \(.total_hours)"'

echo ""

# Step 3: Identify contracts missing from database
echo "[3/4] Checking for missing contracts..."
echo "Fetching contracts from database..."
DB_SYMBOLS=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT DISTINCT symbol FROM market_history WHERE exchange = 'edgex' ORDER BY symbol
" --json | jq -r '.[] | .results[] | .symbol')

echo ""
echo "Contracts in EdgeX API but NOT in database:"
echo "-------------------------------------------"

MISSING_COUNT=0
while IFS= read -r contract_json; do
  CONTRACT_NAME=$(echo "$contract_json" | jq -r '.contractName')
  CONTRACT_ID=$(echo "$contract_json" | jq -r '.contractId')

  # Check if this contract exists in DB
  if ! echo "$DB_SYMBOLS" | grep -q "^${CONTRACT_NAME}$"; then
    echo "  - $CONTRACT_NAME (ID: $CONTRACT_ID)"
    ((MISSING_COUNT++))
  fi
done <<< "$CONTRACTS"

if [ $MISSING_COUNT -eq 0 ]; then
  echo "  (none - all contracts are in database)"
fi

echo ""
echo "Total missing contracts: $MISSING_COUNT"
echo ""

# Step 4: Identify time gaps for existing contracts
echo "[4/4] Analyzing time gaps in existing data..."
echo ""

# Get the earliest and latest timestamps
EARLIEST=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT datetime(MIN(hour_timestamp), 'unixepoch') as earliest FROM market_history WHERE exchange = 'edgex'
" --json | jq -r '.[] | .results[] | .earliest')

LATEST=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT datetime(MAX(hour_timestamp), 'unixepoch') as latest FROM market_history WHERE exchange = 'edgex'
" --json | jq -r '.[] | .results[] | .latest')

echo "Data range: $EARLIEST to $LATEST"
echo ""

# Calculate expected vs actual hours for a sample of contracts
echo "Sample analysis (first 5 symbols with gaps):"
echo "--------------------------------------------"

npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
WITH date_range AS (
  SELECT
    (SELECT MIN(hour_timestamp) FROM market_history WHERE exchange = 'edgex') as start_ts,
    (SELECT MAX(hour_timestamp) FROM market_history WHERE exchange = 'edgex') as end_ts
),
expected_hours AS (
  SELECT
    ((end_ts - start_ts) / 3600) + 1 as expected
  FROM date_range
)
SELECT
  symbol,
  COUNT(*) as actual_hours,
  (SELECT expected FROM expected_hours) as expected_hours,
  (SELECT expected FROM expected_hours) - COUNT(*) as missing_hours,
  datetime(MIN(hour_timestamp), 'unixepoch') as first_data,
  datetime(MAX(hour_timestamp), 'unixepoch') as last_data
FROM market_history
WHERE exchange = 'edgex'
GROUP BY symbol
HAVING missing_hours > 0
ORDER BY missing_hours DESC
LIMIT 5
" --json | jq -r '.[] | .results[] | "  \(.symbol): \(.missing_hours) missing hours (has \(.actual_hours)/\(.expected_hours))"'

echo ""
echo "=================================="
echo "Summary and Recommendations"
echo "=================================="
echo ""
echo "LIMITATION:"
echo "  EdgeX does not provide a public REST API for historical klines/candles."
echo "  Historical data can only be obtained through:"
echo "    1. Real-time WebSocket collection (ongoing)"
echo "    2. Third-party data providers (CoinGecko, CryptoCompare, etc.)"
echo "    3. Direct contact with EdgeX for historical data export"
echo ""
echo "NEXT STEPS:"
echo "  1. The WebSocket tracker is now running and collecting real-time data"
echo "  2. For historical gaps before $(date -u '+%Y-%m-%d %H:00:00'), you need to:"
echo "     - Contact EdgeX support for historical data export"
echo "     - Use a third-party data provider"
echo "     - Accept the gaps and start fresh from current time"
echo ""
echo "  3. Run this script periodically to monitor coverage"
echo ""
echo "Script completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
