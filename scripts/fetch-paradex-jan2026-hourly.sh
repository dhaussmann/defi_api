#!/bin/bash

# Fetch Paradex funding rates for Jan 9-29, 2026
# Uses hourly timestamps with page_size=1 to get one value per hour

START_S=1767916800  # Jan 9, 2026 00:00:00 UTC
END_S=1769731199    # Jan 29, 2026 23:59:59 UTC

echo "=== Paradex Funding Rate Fetcher (Hourly) ==="
echo ""
echo "Period: Jan 9-29, 2026"
echo ""

# Get all PERP markets
echo "Fetching markets..."
MARKETS=$(curl -s "https://api.prod.paradex.trade/v1/markets" | jq -r '.results[] | select(.asset_kind == "PERP") | .symbol')
MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')

echo "✓ Found $MARKET_COUNT PERP markets"
echo ""

# Generate hourly timestamps
HOURLY_TIMESTAMPS=()
CURRENT=$START_S
while [ $CURRENT -le $END_S ]; do
  HOURLY_TIMESTAMPS+=($CURRENT)
  CURRENT=$((CURRENT + 3600))
done

HOUR_COUNT=${#HOURLY_TIMESTAMPS[@]}
echo "✓ Generated $HOUR_COUNT hourly timestamps"
echo ""

TEMP_SQL="/tmp/paradex_hourly_$(date +%s).sql"
> "$TEMP_SQL"

TOTAL=0
ERRORS=0
NUM=0

for MARKET in $MARKETS; do
  NUM=$((NUM + 1))
  SYMBOL="${MARKET%-USD-PERP}"
  
  printf "[%d/%d] %-20s " "$NUM" "$MARKET_COUNT" "$MARKET"
  
  MARKET_TOTAL=0
  MARKET_ERRORS=0
  
  # Fetch one value per hour (use first minute of each hour)
  for TS in "${HOURLY_TIMESTAMPS[@]}"; do
    TS_MS=$((TS * 1000))
    TS_END_MS=$((TS_MS + 60000))  # Add 60 seconds (1 minute)
    
    RESPONSE=$(curl -s "https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_at=${TS_MS}&end_at=${TS_END_MS}&page_size=1")
    
    # Check for errors
    if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
      MARKET_ERRORS=$((MARKET_ERRORS + 1))
      continue
    fi
    
    # Check if we have results
    HAS_RESULTS=$(echo "$RESPONSE" | jq -r '.results | length' 2>/dev/null)
    
    if [ "$HAS_RESULTS" -eq 1 ] 2>/dev/null; then
      # Convert to market_history SQL directly (hourly aggregation)
      FUNDING_RATE=$(echo "$RESPONSE" | jq -r '.results[0].funding_rate | tonumber')
      FUNDING_RATE_ANNUAL=$(echo "$RESPONSE" | jq -r ".results[0].funding_rate | tonumber * 365 * 24")
      AGGREGATED_AT=$(date +%s)
      
      echo "INSERT INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('paradex', '${MARKET}', '${SYMBOL}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${FUNDING_RATE}, ${FUNDING_RATE_ANNUAL}, ${FUNDING_RATE}, ${FUNDING_RATE}, ${TS}, 1, ${AGGREGATED_AT});" >> "$TEMP_SQL"
      
      MARKET_TOTAL=$((MARKET_TOTAL + 1))
    else
      MARKET_ERRORS=$((MARKET_ERRORS + 1))
    fi
    
    # Rate limiting: 1500 req/min = 25 req/sec = 0.04s per request
    # No sleep needed - curl itself takes time
    # Only sleep every 25 requests to stay under limit
    if [ $((MARKET_TOTAL % 25)) -eq 0 ]; then
      sleep 1
    fi
  done
  
  TOTAL=$((TOTAL + MARKET_TOTAL))
  ERRORS=$((ERRORS + MARKET_ERRORS))
  
  if [ "$MARKET_TOTAL" -gt 0 ]; then
    echo "✓ $MARKET_TOTAL records ($MARKET_ERRORS errors)"
  else
    echo "⚠ No data"
  fi
  
  # No sleep between markets needed with 1500 req/min limit
done

echo ""
echo "=== Fetch Complete ==="
echo "Total records: $TOTAL"
echo "Total errors: $ERRORS"
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
