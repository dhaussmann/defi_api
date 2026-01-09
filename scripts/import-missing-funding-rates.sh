#!/bin/bash
set -e

API_URL="https://api.hyperliquid.xyz/info"
DB_NAME="defiapi-db"
REMOTE="--remote"

COINS=("BTC" "ETH" "SOL")
START_TIME=1764547200000  # Dec 1, 2025
CURRENT_TIME=$(date +%s)
END_TIME=$(( CURRENT_TIME * 1000 ))

echo "=========================================="
echo "HIP-3 DEX Historical Funding Import"
echo "=========================================="
echo "Coins: ${COINS[@]}"
echo "Start: $(date -u -r $((START_TIME / 1000)))"
echo "End:   $(date -u -r $((CURRENT_TIME)))"
echo ""

TOTAL_IMPORTED=0

for DEX_INFO in "flx:FLX:Felix" "vntl:VNTL:Ventures" "km:KM:Kinetiq"; do
  IFS=':' read -r DEX EXCHANGE_CODE NAME <<< "$DEX_INFO"

  echo ""
  echo "=========================================="
  echo "$NAME ($EXCHANGE_CODE)"
  echo "=========================================="

  for COIN in "${COINS[@]}"; do
    echo "Processing $COIN..."

    RESPONSE=$(curl -s -X POST "$API_URL" \
      -H "Content-Type: application/json" \
      -d "{
        \"type\": \"fundingHistory\",
        \"coin\": \"$COIN\",
        \"startTime\": $START_TIME,
        \"endTime\": $END_TIME,
        \"dex\": \"$DEX\"
      }")

    RECORD_COUNT=$(echo "$RESPONSE" | jq -e 'length' 2>/dev/null || echo "0")

    if [ "$RECORD_COUNT" = "0" ] || [ "$RECORD_COUNT" = "null" ]; then
      echo "  ✗ No data for $COIN"
      continue
    fi

    echo "  ✓ Received $RECORD_COUNT records"
    SQL_FILE=$(mktemp)

    echo "$RESPONSE" | jq -c '.[]' | while IFS= read -r record; do
      TIME=$(echo "$record" | jq -r '.time')
      FUNDING_RATE=$(echo "$record" | jq -r '.fundingRate')

      if [ "$TIME" = "null" ] || [ "$FUNDING_RATE" = "null" ]; then
        continue
      fi

      TIME_SECONDS=$((TIME / 1000))
      HOUR_TIMESTAMP=$(( (TIME_SECONDS / 3600) * 3600 ))
      SYMBOL="${DEX}:${COIN}"
      FUNDING_ANNUAL=$(echo "$FUNDING_RATE * 100 * 3 * 365" | bc -l)

      cat >> "$SQL_FILE" <<SQL
INSERT INTO market_history (exchange, symbol, normalized_symbol, hour_timestamp, avg_mark_price, avg_index_price, avg_funding_rate, avg_funding_rate_annual, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, min_funding_rate, max_funding_rate, sample_count, aggregated_at)
VALUES ('$DEX', '$SYMBOL', '$COIN', $HOUR_TIMESTAMP, 0.0, 0.0, $FUNDING_RATE, $FUNDING_ANNUAL, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, $FUNDING_RATE, $FUNDING_RATE, 1, unixepoch('now'))
ON CONFLICT(exchange, symbol, hour_timestamp) DO UPDATE SET avg_funding_rate = COALESCE(excluded.avg_funding_rate, avg_funding_rate);
SQL
    done

    if [ -s "$SQL_FILE" ]; then
      LINES=$(wc -l < "$SQL_FILE" | tr -d ' ')
      echo "  📝 Importing $LINES SQL statements..."

      npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1 && \
        echo "  ✅ Import successful" || echo "  ⚠️  Import errors"

      TOTAL_IMPORTED=$((TOTAL_IMPORTED + LINES))
    fi

    rm -f "$SQL_FILE"
    sleep 0.5
  done
done

echo ""
echo "=========================================="
echo "Import Summary"
echo "=========================================="
echo "Total SQL statements: ~$TOTAL_IMPORTED"
echo "Completed: $(date -u)"
