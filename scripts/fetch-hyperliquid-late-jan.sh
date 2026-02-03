#!/bin/bash

# Fetch Hyperliquid funding rates for Jan 27 07:00 - Feb 2 20:00, 2026

START_MS=1769493600000  # Jan 27, 2026 07:00:00 UTC
END_MS=1770000000000    # Feb 2, 2026 20:00:00 UTC

echo "=== Hyperliquid Funding Rate Fetcher ==="
echo ""
echo "Period: Jan 27 07:00 - Feb 2 20:00, 2026"
echo ""

# Get all coins
echo "Fetching coins..."
COINS=$(curl -s -X POST https://api.hyperliquid.xyz/info -H "Content-Type: application/json" -d '{"type": "meta"}' | jq -r '.universe[].name')
COIN_COUNT=$(echo "$COINS" | wc -l | tr -d ' ')

echo "✓ Found $COIN_COUNT coins"
echo ""

TEMP_SQL="/tmp/hyperliquid_late_jan_$(date +%s).sql"
> "$TEMP_SQL"

# Save coins to temp file to avoid subshell
COINS_FILE="/tmp/hyperliquid_coins_$$.txt"
echo "$COINS" > "$COINS_FILE"

TOTAL=0
ERRORS=0
NUM=0

# Read from file instead of pipe to avoid subshell
while read -r COIN; do
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
    # Hyperliquid: 8-hour funding = 3 payments/day = * 3 * 365
    echo "$RESPONSE" | jq -r ".[] | select(.time >= $START_MS and .time <= $END_MS) | \"INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('hyperliquid', '${COIN}', '${COIN}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, \(.fundingRate | tonumber), \(.fundingRate | tonumber * 3 * 365), \(.fundingRate | tonumber), \(.fundingRate | tonumber), \((.time / 1000) | floor), 1, $(date +%s));\"" >> "$TEMP_SQL"
    
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
done < "$COINS_FILE"

# Cleanup temp file
rm "$COINS_FILE"

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
