#!/bin/bash

# Fetch Extended funding rates for Jan 27 07:00 - Feb 2 20:00, 2026

START_MS=1769493600000  # Jan 27, 2026 07:00:00 UTC
END_MS=1770000000000    # Feb 2, 2026 20:00:00 UTC

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
echo "Period: Jan 27 07:00 - Feb 2 20:00, 2026"
echo "Markets: ${#MARKETS[@]} pairs"
echo ""

TEMP_SQL="/tmp/extended_late_jan_$(date +%s).sql"
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
    # Extended: 8-hour funding = 3 payments/day = * 3 * 365
    echo "$RESPONSE" | jq -r ".data[] | \"INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('extended', '${MARKET}', '${SYMBOL}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, \(.f), \(.f | tonumber * 3 * 365), \(.f), \(.f), \((.T / 1000) | floor), 1, $(date +%s));\"" >> "$TEMP_SQL"
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
