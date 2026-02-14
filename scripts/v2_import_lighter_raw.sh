#!/bin/bash

# V2: Import Lighter Raw Data (Standalone)
# Imports historical funding data into lighter_raw_data table
# Does NOT touch existing market_history tables

set -e

DAYS_BACK=${1:-30}

echo "=================================================="
echo "V2 Lighter Raw Data Import (Standalone)"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: lighter_raw_data table (DB_WRITE only)"
echo "=================================================="
echo ""

# Calculate timestamps
END_TS=$(date -u +%s)
START_TS=$((END_TS - DAYS_BACK * 86400))

echo "Fetching active markets..."
MARKETS=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/orderBooks" | jq -r '.order_books[] | select(.status == "active") | "\(.market_id):\(.symbol)"')

if [ -z "$MARKETS" ]; then
  echo "Error: No markets found"
  exit 1
fi

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found ${MARKET_COUNT} active markets"
echo ""

# Update market metadata
echo "Updating market metadata..."
MARKET_SQL="BEGIN TRANSACTION;"

while IFS=: read -r MARKET_ID SYMBOL; do
  MARKET_SQL="${MARKET_SQL}
INSERT OR REPLACE INTO lighter_markets (market_id, symbol, status, last_updated)
VALUES (${MARKET_ID}, '${SYMBOL}', 'active', ${END_TS});"
done <<< "$MARKETS"

MARKET_SQL="${MARKET_SQL}
COMMIT;"

echo "$MARKET_SQL" | npx wrangler d1 execute defiapi-db-write --remote --command="$(cat)" > /dev/null 2>&1

echo "✓ Market metadata updated"
echo ""

# Import funding data
CURRENT=0
TOTAL_RECORDS=0
BATCH_SIZE=1000
BATCH_SQL=""
BATCH_COUNT=0

echo "Importing funding data..."

while IFS=: read -r MARKET_ID SYMBOL; do
  CURRENT=$((CURRENT + 1))
  echo "[${CURRENT}/${MARKET_COUNT}] ${SYMBOL}..."
  
  FUNDINGS=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=${MARKET_ID}&resolution=1h&start_timestamp=${START_TS}&end_timestamp=${END_TS}&count_back=0")
  
  RECORD_COUNT=$(echo "$FUNDINGS" | jq '.fundings | length')
  
  if [ "$RECORD_COUNT" -eq 0 ]; then
    echo "  ⚠️  No data"
    continue
  fi
  
  echo "  ✓ ${RECORD_COUNT} records"
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  
  INSERTS=$(echo "$FUNDINGS" | jq -r --arg market_id "$MARKET_ID" --arg symbol "$SYMBOL" --arg now "$END_TS" '
    .fundings[] | 
    "INSERT OR REPLACE INTO lighter_raw_data (
      market_id, symbol, timestamp,
      rate, rate_annual,
      direction, cumulative_value,
      collected_at, source
    ) VALUES (
      \($market_id),
      \"\($symbol)\",
      \(.timestamp),
      \(.rate | tonumber),
      \((.rate | tonumber) * 24 * 365),
      \"\(.direction)\",
      \(.value | tonumber),
      \($now),
      \"import\"
    );"
  ')
  
  BATCH_SQL="${BATCH_SQL}${INSERTS}"
  BATCH_COUNT=$((BATCH_COUNT + RECORD_COUNT))
  
  if [ $BATCH_COUNT -ge $BATCH_SIZE ]; then
    echo "  → Batch (${BATCH_COUNT} records)..."
    SQL="BEGIN TRANSACTION;${BATCH_SQL}COMMIT;"
    echo "$SQL" | npx wrangler d1 execute defiapi-db-write --remote --command="$(cat)" > /dev/null 2>&1
    BATCH_SQL=""
    BATCH_COUNT=0
  fi
  
  sleep 0.1
  
done <<< "$MARKETS"

# Execute remaining batch
if [ $BATCH_COUNT -gt 0 ]; then
  echo "Final batch (${BATCH_COUNT} records)..."
  SQL="BEGIN TRANSACTION;${BATCH_SQL}COMMIT;"
  echo "$SQL" | npx wrangler d1 execute defiapi-db-write --remote --command="$(cat)" > /dev/null 2>&1
fi

echo ""
echo "=================================================="
echo "Import Complete!"
echo "=================================================="
echo "Total records: ${TOTAL_RECORDS}"
echo "Total markets: ${MARKET_COUNT}"
echo ""
echo "Verify:"
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) FROM lighter_raw_data\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT * FROM lighter_latest LIMIT 10\""
echo "=================================================="
