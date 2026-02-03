#!/bin/bash

# Fetch Paradex funding rates for Jan 9-29, 2026
# Optimized: Fetches in 2-day chunks to avoid pagination

START_MS=1767916800000  # Jan 9, 2026
END_MS=1769731199000    # Jan 29, 2026

echo "=== Paradex Funding Rate Fetcher (Fast) ==="
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

# Generate 2-day time windows (to stay under 100 record limit)
WINDOWS=()
CURRENT=$START_MS
TWO_DAYS=$((2 * 24 * 60 * 60 * 1000))

while [ $CURRENT -lt $END_MS ]; do
  WINDOW_END=$((CURRENT + TWO_DAYS))
  if [ $WINDOW_END -gt $END_MS ]; then
    WINDOW_END=$END_MS
  fi
  WINDOWS+=("$CURRENT:$WINDOW_END")
  CURRENT=$WINDOW_END
done

echo "Using ${#WINDOWS[@]} time windows (2-day chunks)"
echo ""

for MARKET in $MARKETS; do
  NUM=$((NUM + 1))
  SYMBOL="${MARKET%-USD-PERP}"
  
  printf "[%d/%d] %-20s " "$NUM" "$MARKET_COUNT" "$MARKET"
  
  MARKET_TOTAL=0
  
  # Fetch each time window
  for WINDOW in "${WINDOWS[@]}"; do
    WINDOW_START="${WINDOW%:*}"
    WINDOW_END="${WINDOW#*:}"
    
    RESPONSE=$(curl -s "https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_time=${WINDOW_START}&end_time=${WINDOW_END}")
    
    # Check for errors
    if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
      continue
    fi
    
    # Parse results
    COUNT=$(echo "$RESPONSE" | jq -r '.results | length' 2>/dev/null)
    
    if [ "$COUNT" -gt 0 ] 2>/dev/null; then
      # Convert to SQL
      echo "$RESPONSE" | jq -r ".results[] | \"INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES ('paradex', '${SYMBOL}', '${MARKET}', \(.funding_rate | tonumber), \(.funding_rate | tonumber * 100), \(.funding_rate | tonumber * 365 * 24), \(.created_at));\"" >> "$TEMP_SQL"
      
      MARKET_TOTAL=$((MARKET_TOTAL + COUNT))
    fi
  done
  
  TOTAL=$((TOTAL + MARKET_TOTAL))
  
  if [ "$MARKET_TOTAL" -gt 0 ]; then
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
echo "Markets without data: $ERRORS"
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
