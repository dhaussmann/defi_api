#!/bin/bash

# V2 Import: Lighter Historical Funding Data
# Imports 30 days of hourly funding rates into lighter_funding_v2 table

set -e

DAYS_BACK=${1:-30}
DB_NAME=${2:-defiapi-db-write}

echo "=================================================="
echo "V2 Lighter History Import"
echo "=================================================="
echo "Database: ${DB_NAME}"
echo "Period: Last ${DAYS_BACK} days"
echo "=================================================="
echo ""

# Calculate timestamps
END_TS=$(date -u +%s)
START_TS=$((END_TS - DAYS_BACK * 86400))

echo "Fetching active markets from Lighter..."
MARKETS=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/orderBooks" | jq -r '.order_books[] | select(.status == "active") | "\(.market_id):\(.symbol):\(.status)"')

if [ -z "$MARKETS" ]; then
  echo "Error: No markets found"
  exit 1
fi

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found ${MARKET_COUNT} active markets"
echo ""

# First, update market metadata
echo "Updating market metadata..."
MARKET_SQL="BEGIN TRANSACTION;"

while IFS=: read -r MARKET_ID SYMBOL STATUS; do
  MARKET_SQL="${MARKET_SQL}
INSERT OR REPLACE INTO lighter_markets_v2 (market_id, symbol, status, last_updated)
VALUES (${MARKET_ID}, '${SYMBOL}', '${STATUS}', ${END_TS});"
done <<< "$MARKETS"

MARKET_SQL="${MARKET_SQL}
COMMIT;"

echo "$MARKET_SQL" | npx wrangler d1 execute ${DB_NAME} --remote --command="$(cat)"

echo "✓ Market metadata updated"
echo ""

# Now import funding data
CURRENT=0
TOTAL_RECORDS=0
BATCH_SIZE=1000
BATCH_SQL=""
BATCH_COUNT=0

echo "Importing funding data..."

while IFS=: read -r MARKET_ID SYMBOL STATUS; do
  CURRENT=$((CURRENT + 1))
  echo "[${CURRENT}/${MARKET_COUNT}] Processing ${SYMBOL} (market_id: ${MARKET_ID})..."
  
  # Fetch funding data
  FUNDINGS=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=${MARKET_ID}&resolution=1h&start_timestamp=${START_TS}&end_timestamp=${END_TS}&count_back=0")
  
  # Check if data exists
  RECORD_COUNT=$(echo "$FUNDINGS" | jq '.fundings | length')
  
  if [ "$RECORD_COUNT" -eq 0 ]; then
    echo "  ⚠️  No data found, skipping..."
    continue
  fi
  
  echo "  ✓ Found ${RECORD_COUNT} hourly records"
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  
  # Convert to SQL INSERT statements and add to batch
  INSERTS=$(echo "$FUNDINGS" | jq -r --arg market_id "$MARKET_ID" --arg symbol "$SYMBOL" --arg now "$END_TS" '
    .fundings[] | 
    "INSERT OR REPLACE INTO lighter_funding_v2 (
      market_id, symbol, timestamp,
      rate, rate_hourly, rate_annual,
      direction, cumulative_value,
      collected_at, source
    ) VALUES (
      \($market_id),
      \"\($symbol)\",
      \(.timestamp),
      \(.rate | tonumber),
      \(.rate | tonumber),
      \((.rate | tonumber) * 24 * 365),
      \"\(.direction)\",
      \(.value | tonumber),
      \($now),
      \"import\"
    );"
  ')
  
  # Add to batch
  BATCH_SQL="${BATCH_SQL}${INSERTS}"
  BATCH_COUNT=$((BATCH_COUNT + RECORD_COUNT))
  
  # Execute batch if it reaches BATCH_SIZE
  if [ $BATCH_COUNT -ge $BATCH_SIZE ]; then
    echo "  → Executing batch (${BATCH_COUNT} records)..."
    SQL="BEGIN TRANSACTION;${BATCH_SQL}COMMIT;"
    echo "$SQL" | npx wrangler d1 execute ${DB_NAME} --remote --command="$(cat)" > /dev/null 2>&1
    BATCH_SQL=""
    BATCH_COUNT=0
  fi
  
  # Rate limiting
  sleep 0.1
  
done <<< "$MARKETS"

# Execute remaining batch
if [ $BATCH_COUNT -gt 0 ]; then
  echo "Executing final batch (${BATCH_COUNT} records)..."
  SQL="BEGIN TRANSACTION;${BATCH_SQL}COMMIT;"
  echo "$SQL" | npx wrangler d1 execute ${DB_NAME} --remote --command="$(cat)" > /dev/null 2>&1
fi

echo ""
echo "=================================================="
echo "Import Complete!"
echo "=================================================="
echo "Total records imported: ${TOTAL_RECORDS}"
echo "Total markets: ${MARKET_COUNT}"
echo ""
echo "Verify import:"
echo "  npx wrangler d1 execute ${DB_NAME} --remote --command=\"SELECT COUNT(*) as total FROM lighter_funding_v2\""
echo "  npx wrangler d1 execute ${DB_NAME} --remote --command=\"SELECT COUNT(DISTINCT symbol) as markets FROM lighter_funding_v2\""
echo "=================================================="
