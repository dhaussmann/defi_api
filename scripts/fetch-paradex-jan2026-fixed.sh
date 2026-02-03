#!/bin/bash

# Fetch Paradex funding rates for Jan 9-29, 2026
# Uses correct endpoint: /v1/funding/data (no auth required)

START_MS=1767916800000  # Jan 9, 2026
END_MS=1769731199000    # Jan 29, 2026

echo "=== Paradex Funding Rate Fetcher ==="
echo ""
echo "Period: Jan 9-29, 2026"
echo ""

# Get all PERP markets
echo "Fetching markets..."
MARKETS=$(curl -s "https://api.prod.paradex.trade/v1/markets" | jq -r '.results[] | select(.asset_kind == "PERP") | .symbol')
MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')

echo "✓ Found $MARKET_COUNT PERP markets"
echo ""

TEMP_SQL="/tmp/paradex_import_$(date +%s).sql"
> "$TEMP_SQL"

TOTAL=0
ERRORS=0
NUM=0

for MARKET in $MARKETS; do
  NUM=$((NUM + 1))
  SYMBOL="${MARKET%-USD-PERP}"
  
  printf "[%d/%d] %-20s " "$NUM" "$MARKET_COUNT" "$MARKET"
  
  MARKET_TOTAL=0
  CURSOR=""
  
  # Fetch with pagination (max 100 per request)
  while true; do
    if [ -z "$CURSOR" ]; then
      URL="https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_time=${START_MS}&end_time=${END_MS}"
    else
      URL="https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_time=${START_MS}&end_time=${END_MS}&cursor=${CURSOR}"
    fi
    
    RESPONSE=$(curl -s "$URL")
    
    # Check for errors
    if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
      echo "✗ Error: $(echo "$RESPONSE" | jq -r '.error')"
      ERRORS=$((ERRORS + 1))
      break
    fi
    
    # Parse results
    COUNT=$(echo "$RESPONSE" | jq -r '.results | length' 2>/dev/null)
    
    if [ "$COUNT" -gt 0 ] 2>/dev/null; then
      # Convert to SQL
      echo "$RESPONSE" | jq -r ".results[] | \"INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES ('paradex', '${SYMBOL}', '${MARKET}', \(.funding_rate | tonumber), \(.funding_rate | tonumber * 100), \(.funding_rate | tonumber * 365 * 24), \(.created_at));\"" >> "$TEMP_SQL"
      
      MARKET_TOTAL=$((MARKET_TOTAL + COUNT))
      TOTAL=$((TOTAL + COUNT))
    fi
    
    # Check for next page
    NEXT_CURSOR=$(echo "$RESPONSE" | jq -r '.next // empty')
    
    if [ -z "$NEXT_CURSOR" ] || [ "$NEXT_CURSOR" = "null" ]; then
      break
    fi
    
    CURSOR="$NEXT_CURSOR"
    sleep 0.1
  done
  
  if [ "$MARKET_TOTAL" -gt 0 ]; then
    echo "✓ $MARKET_TOTAL records"
  else
    echo "⚠ No data"
  fi
  
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

echo "Converting to market_history format..."
node scripts/convert-funding-to-market-history.js "$TEMP_SQL"

MARKET_HISTORY_SQL="${TEMP_SQL%.sql}_market_history.sql"

echo ""
echo "Importing to defiapi-db-write..."
npx wrangler d1 execute defiapi-db-write --file "$MARKET_HISTORY_SQL" --remote

if [ $? -eq 0 ]; then
  echo "✓ Import complete"
  rm "$TEMP_SQL" "$MARKET_HISTORY_SQL"
else
  echo "❌ Import failed"
  echo "SQL file saved at: $MARKET_HISTORY_SQL"
  exit 1
fi

echo ""
echo "=== Done ==="
