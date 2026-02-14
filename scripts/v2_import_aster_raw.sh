#!/bin/bash

# V2: Import Aster Raw Data (Standalone)
# Imports historical funding data into aster_raw_data table
# Features automatic interval detection and normalized hourly rates

set -e

DAYS_BACK=${1:-30}

echo "=================================================="
echo "V2 Aster Raw Data Import (Standalone)"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: aster_raw_data table (DB_WRITE only)"
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

# Update market metadata
echo "Updating market metadata..."
MARKET_SQL="BEGIN TRANSACTION;"
NOW_SEC=$(date -u +%s)

while IFS=: read -r SYMBOL BASE_ASSET QUOTE_ASSET; do
  MARKET_SQL="${MARKET_SQL}
INSERT OR REPLACE INTO aster_markets (symbol, base_asset, quote_asset, contract_type, status, last_updated)
VALUES ('${SYMBOL}', '${BASE_ASSET}', '${QUOTE_ASSET}', 'PERPETUAL', 'TRADING', ${NOW_SEC});"
done <<< "$MARKETS"

MARKET_SQL="${MARKET_SQL}
COMMIT;"

echo "$MARKET_SQL" | npx wrangler d1 execute defiapi-db-write --remote --command="$(cat)" > /dev/null 2>&1

echo "✓ Market metadata updated"
echo ""

# Import funding data
CURRENT=0
TOTAL_RECORDS=0
BATCH_SIZE=500
BATCH_SQL=""
BATCH_COUNT=0

echo "Importing funding data with interval detection..."

while IFS=: read -r SYMBOL BASE_ASSET QUOTE_ASSET; do
  CURRENT=$((CURRENT + 1))
  echo "[${CURRENT}/${MARKET_COUNT}] ${SYMBOL} (${BASE_ASSET})..."
  
  # Fetch funding history via proxy
  FUNDINGS=$(curl -s "https://aster.wirewaving.workers.dev?symbol=${SYMBOL}&startTime=${START_TS}&endTime=${END_TS}&limit=1000")
  
  RECORD_COUNT=$(echo "$FUNDINGS" | jq '. | length')
  
  if [ "$RECORD_COUNT" -eq 0 ]; then
    echo "  ⚠️  No data"
    continue
  fi
  
  # Calculate interval using jq (median of time differences)
  INTERVAL_CALC=$(echo "$FUNDINGS" | jq -r '
    sort_by(.fundingTime) |
    [
      .[] | select(. != null)
    ] as $sorted |
    [
      range(1; $sorted | length) | 
      $sorted[.].fundingTime - $sorted[. - 1].fundingTime
    ] |
    sort |
    if length > 0 then
      .[length / 2 | floor]
    else
      3600000
    end
  ')
  
  # Convert to hours (rounded)
  INTERVAL_HOURS=$(echo "scale=0; ($INTERVAL_CALC + 1800000) / 3600000" | bc)
  
  # Calculate events per year
  EVENTS_PER_YEAR=$(echo "scale=6; 365 * 24 / $INTERVAL_HOURS" | bc)
  
  echo "  → Detected interval: ${INTERVAL_HOURS}h (${EVENTS_PER_YEAR} events/year)"
  
  # Update market interval
  INTERVAL_UPDATE="UPDATE aster_markets SET detected_interval_hours = ${INTERVAL_HOURS}, last_interval_update = ${NOW_SEC} WHERE symbol = '${SYMBOL}';"
  echo "$INTERVAL_UPDATE" | npx wrangler d1 execute defiapi-db-write --remote --command="$(cat)" > /dev/null 2>&1
  
  # Generate insert statements with all 3 rate values
  INSERTS=$(echo "$FUNDINGS" | jq -r --arg symbol "$SYMBOL" --arg base "$BASE_ASSET" --arg now "$NOW_SEC" --arg interval "$INTERVAL_HOURS" --arg events "$EVENTS_PER_YEAR" '
    .[] | 
    (.fundingRate | tonumber) as $rate_raw |
    ($rate_raw * 100) as $rate_percent |
    ($rate_percent / ($interval | tonumber)) as $rate_hourly |
    ($rate_percent * ($events | tonumber)) as $rate_annual |
    "INSERT OR REPLACE INTO aster_raw_data (
      symbol, base_asset, funding_time,
      rate_raw, rate_raw_percent,
      rate_hourly, rate_annual,
      interval_hours, events_per_year,
      collected_at, source
    ) VALUES (
      \"\($symbol)\",
      \"\($base)\",
      \(.fundingTime),
      \($rate_raw),
      \($rate_percent),
      \($rate_hourly),
      \($rate_annual),
      \($interval | tonumber),
      \($events | tonumber),
      \($now),
      \"import\"
    );"
  ')
  
  echo "  ✓ ${RECORD_COUNT} records"
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  
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
  sleep 0.15
  
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
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) FROM aster_raw_data\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT * FROM aster_latest LIMIT 10\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT * FROM aster_interval_distribution\""
echo "=================================================="
