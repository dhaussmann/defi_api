#!/bin/bash

# Fetch missing Lighter markets with correct market_index

START_S=1767916800  # Jan 9, 2026 00:00:00 UTC
END_S=1769731199    # Jan 29, 2026 23:59:59 UTC
COUNT_BACK=600      # Buffer for hourly data

echo "=== Lighter Missing Markets Fetcher ==="
echo ""

TEMP_SQL="/tmp/lighter_missing_$(date +%s).sql"
> "$TEMP_SQL"

# Missing markets: BMNR(123), FOGO(124), DUSK(125), RIVER(126)
declare -A MARKETS=(
  [123]="BMNR"
  [124]="FOGO"
  [125]="DUSK"
  [126]="RIVER"
)

TOTAL=0
ERRORS=0

for MARKET_ID in "${!MARKETS[@]}"; do
  SYMBOL="${MARKETS[$MARKET_ID]}"
  
  printf "Fetching %-15s (ID: %s) ... " "$SYMBOL" "$MARKET_ID"
  
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
    echo "$RESPONSE" | jq -r ".fundings[] | select(.timestamp >= $START_S and .timestamp <= $END_S) | \"INSERT INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('lighter', '${SYMBOL}', '${SYMBOL}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, \(.rate | tonumber), \(.rate | tonumber * 365 * 24), \(.rate | tonumber), \(.rate | tonumber), \(.timestamp), 1, $(date +%s));\"" >> "$TEMP_SQL"
    
    FILTERED_COUNT=$(wc -l < "$TEMP_SQL" | tr -d ' ')
    MARKET_TOTAL=$((FILTERED_COUNT - TOTAL))
    TOTAL=$FILTERED_COUNT
    
    echo "✓ $MARKET_TOTAL records"
  else
    echo "⚠ No data"
    ERRORS=$((ERRORS + 1))
  fi
  
  sleep 0.1
done

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
