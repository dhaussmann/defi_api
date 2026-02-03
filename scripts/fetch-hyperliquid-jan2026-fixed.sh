#!/bin/bash

# Fetch Hyperliquid funding rates for Jan 9-29, 2026
# Uses correct API format (no endTime parameter)

START_MS=1767916800000  # Jan 9, 2026 00:00:00 UTC
END_MS=1769731199000    # Jan 29, 2026 23:59:59 UTC
START_S=1767916800
END_S=1769731199

echo "=== Hyperliquid Funding Rate Fetcher ==="
echo ""
echo "Period: Jan 9-29, 2026"
echo ""

# Get all coins
echo "Fetching coins..."
COINS=$(curl -s -X POST https://api.hyperliquid.xyz/info -H "Content-Type: application/json" -d '{"type": "meta"}' | jq -r '.universe[].name')
COIN_COUNT=$(echo "$COINS" | wc -l | tr -d ' ')

echo "✓ Found $COIN_COUNT coins"
echo ""

TEMP_SQL="/tmp/hyperliquid_import_$(date +%s).sql"
> "$TEMP_SQL"

TOTAL=0
ERRORS=0
NUM=0

# Fetch data for each coin
echo "$COINS" | while read -r COIN; do
  NUM=$((NUM + 1))
  
  printf "[%d/%d] %-15s " "$NUM" "$COIN_COUNT" "$COIN"
  
  # Fetch all funding rates from startTime onwards
  RESPONSE=$(curl -s -X POST https://api.hyperliquid.xyz/info -H "Content-Type: application/json" -d "{\"type\":\"fundingHistory\",\"coin\":\"${COIN}\",\"startTime\":${START_MS}}")
  
  # Check if response is valid array
  if ! echo "$RESPONSE" | jq -e 'type == "array"' > /dev/null 2>&1; then
    echo "⚠ Invalid response"
    ERRORS=$((ERRORS + 1))
    continue
  fi
  
  # Filter to our time range and convert to SQL
  COUNT=$(echo "$RESPONSE" | jq "[.[] | select(.time >= $START_MS and .time <= $END_MS)] | length")
  
  if [ "$COUNT" -gt 0 ] 2>/dev/null; then
    # Convert milliseconds to seconds for hour_timestamp
    echo "$RESPONSE" | jq -r ".[] | select(.time >= $START_MS and .time <= $END_MS) | \"INSERT INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('hyperliquid', '${COIN}', '${COIN}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, \(.fundingRate | tonumber), \(.fundingRate | tonumber * 365 * 24), \(.fundingRate | tonumber), \(.fundingRate | tonumber), \((.time / 1000) | floor), 1, $(date +%s));\"" >> "$TEMP_SQL"
    
    FILTERED_COUNT=$(wc -l < "$TEMP_SQL" | tr -d ' ')
    COIN_TOTAL=$((FILTERED_COUNT - TOTAL))
    TOTAL=$FILTERED_COUNT
    
    echo "✓ $COIN_TOTAL records"
  else
    echo "⚠ No data"
    ERRORS=$((ERRORS + 1))
  fi
  
  # Rate limiting: be gentle with API
  sleep 0.2
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
