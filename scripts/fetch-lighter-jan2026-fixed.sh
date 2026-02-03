#!/bin/bash

# Fetch Lighter funding rates for Jan 9-29, 2026
# Uses correct API endpoints with market_id

START_S=1767916800  # Jan 9, 2026 00:00:00 UTC
END_S=1769731199    # Jan 29, 2026 23:59:59 UTC
COUNT_BACK=600      # Buffer for hourly data (504 hours + buffer)

echo "=== Lighter Funding Rate Fetcher ==="
echo ""
echo "Period: Jan 9-29, 2026"
echo ""

# Get all markets with their IDs
echo "Fetching markets..."
MARKETS_JSON=$(curl -s "https://explorer.elliot.ai/api/markets")
MARKET_COUNT=$(echo "$MARKETS_JSON" | jq 'keys | length')

echo "✓ Found $MARKET_COUNT markets"
echo ""

TEMP_SQL="/tmp/lighter_import_$(date +%s).sql"
> "$TEMP_SQL"

TOTAL=0
ERRORS=0

# Save market list to temp file to avoid subshell issues
MARKETS_FILE="/tmp/lighter_markets_$$.txt"
echo "$MARKETS_JSON" | jq -r 'to_entries[] | "\(.key):\(.value.symbol)"' > "$MARKETS_FILE"

NUM=0
# Read from file instead of pipe to avoid subshell
while IFS=: read -r MARKET_ID SYMBOL; do
  NUM=$((NUM + 1))
  
  # Skip if market_id or symbol is null/empty
  if [ -z "$MARKET_ID" ] || [ "$MARKET_ID" = "null" ] || [ -z "$SYMBOL" ] || [ "$SYMBOL" = "null" ]; then
    continue
  fi
  
  printf "[%d/%d] %-15s (ID: %s) " "$NUM" "$MARKET_COUNT" "$SYMBOL" "$MARKET_ID"
  
  # Fetch funding rates
  RESPONSE=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=${MARKET_ID}&resolution=1h&start_timestamp=${START_S}&end_timestamp=${END_S}&count_back=${COUNT_BACK}")
  
  # Check if response has fundings array
  if ! echo "$RESPONSE" | jq -e '.fundings | type == "array"' > /dev/null 2>&1; then
    echo "⚠ Invalid response"
    ERRORS=$((ERRORS + 1))
    continue
  fi
  
  # Parse and convert to market_history SQL
  COUNT=$(echo "$RESPONSE" | jq '.fundings | length')
  
  if [ "$COUNT" -gt 0 ] 2>/dev/null; then
    # Write SQL statements
    # IMPORTANT: Lighter API returns rates as percentages (0.0012 = 0.12%), so divide by 100
    echo "$RESPONSE" | jq -r ".fundings[] | select(.timestamp >= $START_S and .timestamp <= $END_S) | \"INSERT INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('lighter', '${SYMBOL}', '${SYMBOL}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, \(.rate | tonumber / 100), \(.rate | tonumber / 100 * 365 * 24), \(.rate | tonumber / 100), \(.rate | tonumber / 100), \(.timestamp), 1, $(date +%s));\"" >> "$TEMP_SQL"
    
    # Count actual records added
    FILTERED_COUNT=$(wc -l < "$TEMP_SQL" | tr -d ' ')
    MARKET_TOTAL=$((FILTERED_COUNT - TOTAL))
    TOTAL=$FILTERED_COUNT
    
    echo "✓ $MARKET_TOTAL records"
  else
    echo "⚠ No data"
    ERRORS=$((ERRORS + 1))
  fi
  
  sleep 0.1
done < "$MARKETS_FILE"

# Cleanup temp file
rm "$MARKETS_FILE"

echo ""
echo "=== Fetch Complete ==="
echo "Total records: $TOTAL"
echo "Errors: $ERRORS"
echo ""

if [ "$TOTAL" -eq 0 ]; then
  echo "❌ No data to import"
  rm "$TEMP_SQL"
  exit 1
fi

echo "Importing to defiapi-db-write..."
npx wrangler d1 execute defiapi-db-write --file "$TEMP_SQL" --remote

if [ $? -eq 0 ]; then
  echo "✓ Import complete"
  rm "$TEMP_SQL"
else
  echo "❌ Import failed"
  echo "SQL file saved at: $TEMP_SQL"
  exit 1
fi

echo ""
echo "=== Done ==="
