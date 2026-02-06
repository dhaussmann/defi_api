#!/bin/bash

# V2: Import Lighter Raw Data (Working Version)
# Key fix: No BEGIN/COMMIT in SQL files (D1 doesn't support it)

set -e

DAYS_BACK=${1:-7}
TEMP_SQL="/tmp/lighter_import_$$.sql"

echo "=================================================="
echo "V2 Lighter Raw Data Import (Working)"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Target: lighter_raw_data table"
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

# Update market metadata (without BEGIN/COMMIT)
echo "Updating market metadata..."
> "$TEMP_SQL"

while IFS=: read -r MARKET_ID SYMBOL; do
  echo "INSERT OR REPLACE INTO lighter_markets (market_id, symbol, status, last_updated) VALUES (${MARKET_ID}, '${SYMBOL}', 'active', ${END_TS});" >> "$TEMP_SQL"
done <<< "$MARKETS"

npx wrangler d1 execute defiapi-db-write --remote --file="$TEMP_SQL" > /dev/null 2>&1

echo "✓ Market metadata updated"
echo ""

# Import funding data
CURRENT=0
TOTAL_RECORDS=0

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
  
  # Create SQL file WITHOUT BEGIN/COMMIT
  # Note: Lighter API uses direction field - "short" means rate should be negative
  # IMPORTANT: Multiply timestamp by 1000 (Lighter API returns seconds, not milliseconds)
  echo "$FUNDINGS" | jq -r --arg market_id "$MARKET_ID" --arg symbol "$SYMBOL" --arg now "$END_TS" '
    .fundings[] | 
    (.rate | tonumber) as $raw_rate |
    (if .direction == "short" then -$raw_rate else $raw_rate end) as $signed_rate |
    ($signed_rate * 24 * 365) as $rate_annual |
    (.timestamp * 1000) as $timestamp_ms |
    "INSERT OR REPLACE INTO lighter_raw_data (market_id, symbol, timestamp, rate, rate_annual, direction, cumulative_value, collected_at, source) VALUES (\($market_id), '\''\($symbol)'\''', \($timestamp_ms), \($signed_rate), \($rate_annual), '\''\(.direction)'\''', \(.value | tonumber), \($now), '\''import'\'');"  
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
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT COUNT(*) FROM lighter_raw_data\""
echo "  npx wrangler d1 execute defiapi-db-write --remote --command=\"SELECT * FROM lighter_latest LIMIT 10\""
echo "=================================================="
