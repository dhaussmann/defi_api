#!/bin/bash

# Fetch Extended funding rates for Jan 9-29, 2026
# Uses curl instead of Node.js to avoid HTTPS issues

START_MS=1767916800000  # Jan 9, 2026
END_MS=1769731199000    # Jan 29, 2026

MARKETS=(
  "BTC-USD" "ETH-USD" "SOL-USD" "DOGE-USD" "XRP-USD" "BNB-USD" "ADA-USD"
  "AVAX-USD" "LTC-USD" "LINK-USD" "UNI-USD" "ARB-USD" "OP-USD" "APT-USD"
  "SUI-USD" "TIA-USD" "SEI-USD" "NEAR-USD" "AAVE-USD" "CRV-USD" "SNX-USD"
  "LDO-USD" "PENDLE-USD" "JUP-USD" "WLD-USD" "STRK-USD" "ZRO-USD" "ONDO-USD"
  "ENA-USD" "EIGEN-USD" "WIF-USD" "POPCAT-USD" "GOAT-USD" "HYPE-USD" "VIRTUAL-USD"
  "TRUMP-USD" "FARTCOIN-USD" "BERA-USD" "PUMP-USD" "TAO-USD" "1000PEPE-USD"
  "1000BONK-USD" "1000SHIB-USD" "TON-USD" "TRX-USD" "XMR-USD" "ZEC-USD" "MNT-USD"
)

echo "=== Extended Funding Rate Fetcher ==="
echo ""
echo "Period: Jan 9-29, 2026"
echo "Markets: ${#MARKETS[@]} pairs"
echo ""

TEMP_SQL="/tmp/extended_import_$(date +%s).sql"
> "$TEMP_SQL"

TOTAL=0
ERRORS=0

for i in "${!MARKETS[@]}"; do
  MARKET="${MARKETS[$i]}"
  SYMBOL="${MARKET%-USD}"
  NUM=$((i + 1))
  
  printf "[%d/%d] %-15s " "$NUM" "${#MARKETS[@]}" "$MARKET"
  
  # Fetch funding rates
  RESPONSE=$(curl -s "https://api.starknet.extended.exchange/api/v1/info/${MARKET}/funding?startTime=${START_MS}&endTime=${END_MS}")
  
  # Parse JSON and create SQL
  COUNT=$(echo "$RESPONSE" | jq -r '.data | length' 2>/dev/null)
  
  if [ "$COUNT" -gt 0 ] 2>/dev/null; then
    echo "$RESPONSE" | jq -r ".data[] | \"INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES ('extended', '${SYMBOL}', '${MARKET}', \(.f), \(.f | tonumber * 100), \(.f | tonumber * 365 * 24), \(.T));\"" >> "$TEMP_SQL"
    echo "✓ $COUNT records"
    TOTAL=$((TOTAL + COUNT))
  else
    echo "⚠ No data"
    ERRORS=$((ERRORS + 1))
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
