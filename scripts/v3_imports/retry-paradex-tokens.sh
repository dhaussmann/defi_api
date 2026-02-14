#!/bin/bash

# Paradex Retry: Import missing data for PYTH, AVAX, BCH
# Gap: Jan 9 - Feb 5, 2026

set -e

API_BASE="https://api.prod.paradex.trade"
DB_NAME="defiapi-db-write"
REMOTE="--remote"
INTERVAL_HOURS=8
CONVERSION_FACTOR=100
COLLECTED_AT=$(date +%s)
TWO_DAYS=$((2 * 24 * 60 * 60 * 1000))

# Gap period: Jan 9 to Feb 6
START_MS=1736380800000
END_MS=1738800000000

TEMP_SQL=$(mktemp)
TOKENS="AVAX-USD-PERP BCH-USD-PERP PYTH-USD-PERP"

echo "=========================================="
echo "Paradex Retry: PYTH, AVAX, BCH"
echo "=========================================="
echo "Gap period: 2026-01-09 to 2026-02-06"
echo ""

for MARKET in $TOKENS; do
  BASE_ASSET="${MARKET%-USD-PERP}"
  MARKET_TOTAL=0
  CURRENT=$START_MS

  while [ $(echo "$CURRENT < $END_MS" | bc) -eq 1 ]; do
    WINDOW_END=$(echo "$CURRENT + $TWO_DAYS" | bc)
    if [ $(echo "$WINDOW_END > $END_MS" | bc) -eq 1 ]; then
      WINDOW_END=$END_MS
    fi

    RESPONSE=$(curl -s "$API_BASE/v1/funding/data?market=${MARKET}&start_time=${CURRENT}&end_time=${WINDOW_END}")

    # Check for errors
    if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
      CURRENT=$WINDOW_END
      continue
    fi

    COUNT=$(echo "$RESPONSE" | jq -r '.results | length' 2>/dev/null)

    if [ "$COUNT" -gt 0 ] 2>/dev/null; then
      echo "$RESPONSE" | jq -r --arg symbol "$BASE_ASSET" --arg market "$MARKET" \
        --arg interval "$INTERVAL_HOURS" --arg conv "$CONVERSION_FACTOR" \
        --arg collected "$COLLECTED_AT" '
        .results[] |
        (.funding_rate | tonumber) as $rate_raw |
        ($rate_raw * ($conv | tonumber)) as $rate_raw_percent |
        ($rate_raw_percent / ($interval | tonumber)) as $rate_1h_percent |
        ($rate_1h_percent * 24 * 365) as $rate_apr |
        "INSERT OR REPLACE INTO paradex_funding_v3 (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source) VALUES (\"\($market)\", \"\($symbol)\", \(.created_at), \($rate_raw), \($rate_raw_percent), \($interval), \($rate_1h_percent), \($rate_apr), \($collected), \"import\");"
      ' >> "$TEMP_SQL"
      MARKET_TOTAL=$((MARKET_TOTAL + COUNT))
    fi

    CURRENT=$WINDOW_END
    sleep 0.2
  done

  echo "  $MARKET: $MARKET_TOTAL records"
done

TOTAL=$(wc -l < "$TEMP_SQL" | tr -d ' ')
echo ""
echo "Total SQL statements: $TOTAL"

if [ "$TOTAL" -eq 0 ]; then
  echo "No data to import"
  rm "$TEMP_SQL"
  exit 0
fi

echo "Importing to database..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$TEMP_SQL" > /dev/null 2>&1
echo "Done!"
rm "$TEMP_SQL"

# Verify
echo ""
echo "Verifying..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
  SELECT symbol, COUNT(*) as records,
    MIN(datetime(funding_time, 'unixepoch')) as earliest,
    MAX(datetime(funding_time, 'unixepoch')) as latest
  FROM paradex_funding_v3
  WHERE symbol IN ('PYTH-USD-PERP','AVAX-USD-PERP','BCH-USD-PERP')
  GROUP BY symbol
  ORDER BY symbol
"
echo "=========================================="
