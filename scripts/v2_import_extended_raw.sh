#!/bin/bash

# V2: Import Extended Raw Data (Standalone)
# Imports historical funding data into extended_raw_data table
# Extended uses 1-hour intervals (like Lighter)

set -e

DAYS_BACK=${1:-30}

echo "=================================================="
echo "V2 Extended Raw Data Import (Standalone)"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: extended_raw_data table (DB_WRITE only)"
echo "=================================================="
echo ""

# Calculate timestamps (Extended uses milliseconds)
END_TS=$(date -u +%s)000
START_TS=$((END_TS - DAYS_BACK * 86400 * 1000))

# Extended supported tokens
TOKENS=("BTC" "ETH" "SOL" "STRK")

echo "Extended supports ${#TOKENS[@]} tokens: ${TOKENS[*]}"
echo ""

# Update market metadata
echo "Updating market metadata..."
MARKET_SQL="BEGIN TRANSACTION;"
NOW_SEC=$(date -u +%s)

for TOKEN in "${TOKENS[@]}"; do
  SYMBOL="${TOKEN}-USD"
  MARKET_SQL="${MARKET_SQL}
INSERT OR REPLACE INTO extended_markets (symbol, base_asset, quote_asset, status, last_updated)
VALUES ('${SYMBOL}', '${TOKEN}', 'USD', 'active', ${NOW_SEC});"
done

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

echo "Importing funding data (1h intervals)..."

for TOKEN in "${TOKENS[@]}"; do
  CURRENT=$((CURRENT + 1))
  SYMBOL="${TOKEN}-USD"
  echo "[${CURRENT}/${#TOKENS[@]}] ${SYMBOL}..."
  
  # Fetch funding history via proxy
  API_URL="https://api.starknet.extended.exchange/api/v1/info/${TOKEN}-USD/funding?startTime=${START_TS}&endTime=${END_TS}"
  PROXY_URL="https://extended.wirewaving.workers.dev/?url=$(echo -n "$API_URL" | jq -sRr @uri)"
  
  FUNDINGS=$(curl -s "$PROXY_URL")
  
  # Handle both direct array and wrapped response
  RECORD_COUNT=$(echo "$FUNDINGS" | jq 'if type == "array" then length elif .data then .data | length else 0 end')
  
  if [ "$RECORD_COUNT" -eq 0 ]; then
    echo "  ⚠️  No data"
    continue
  fi
  
  echo "  ✓ ${RECORD_COUNT} records"
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  
  # Generate insert statements
  INSERTS=$(echo "$FUNDINGS" | jq -r --arg symbol "$SYMBOL" --arg token "$TOKEN" --arg now "$NOW_SEC" '
    (if type == "array" then . else .data end) | 
    .[] | 
    (.fundingRate | tonumber) as $rate |
    ($rate * 100) as $rate_percent |
    ($rate * 24 * 365) as $rate_annual |
    "INSERT OR REPLACE INTO extended_raw_data (
      symbol, base_asset, timestamp,
      rate, rate_percent, rate_annual,
      collected_at, source
    ) VALUES (
      \"\($symbol)\",
      \"\($token)\",
      \(.timestamp),
      \($rate),
      \($rate_percent),
      \($rate_annual),
      \($now),
      \"import\"
    );"
  ')
  
  BATCH_SQL="${BATCH_SQL}${INSERTS}"
  BATCH_COUNT=$((BATCH_COUNT + RECORD_COUNT))
  
  # Execute batch when reaching batch size
  if [ $BATCH_COUNT -ge $BATCH_SIZE ]; then
    echo "  → Batch insert (${BATCH_COUNT} records)..."
    SQL="BEGIN TRANSACTION;${BATCH_SQL}COMMIT;"
    echo "$SQL" | npx wrangler d1 execute defiapi-db-write --remote --command="$(cat)" > /dev/null 2>&1
    BATCH_SQL=""
    BATCH_COUNT=0
  fi
  
  # Rate limiting
  sleep 0.2
  
done

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
echo "Total tokens: ${#TOKENS[@]}"
echo ""
echo "Verify:"
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) FROM extended_raw_data\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT * FROM extended_latest\""
echo "=================================================="
