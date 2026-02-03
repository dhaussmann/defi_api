#!/bin/bash
set -e

API_URL="https://api.hyperliquid.xyz/info"
DB_WRITE="defiapi-db-write"
DB_READ="defiapi-db-read"
REMOTE="--remote"

# Import last 30 days of data
CURRENT_TIME=$(date +%s)
START_TIME=$(( (CURRENT_TIME - 30 * 24 * 60 * 60) * 1000 ))  # 30 days ago in ms
END_TIME=$(( CURRENT_TIME * 1000 ))

echo "=========================================="
echo "HIP-3 DEX-Specific Symbols Import"
echo "=========================================="
echo "Time range: Last 30 days ($(date -u -r $((START_TIME / 1000)) +%Y-%m-%d) to $(date -u +%Y-%m-%d))"
echo ""

TOTAL_IMPORTED=0

# Process each DEX with its specific symbols
for DEX_INFO in \
  "flx:GOLD SILVER OIL GAS COIN NVDA TSLA CRCL XMR" \
  "vntl:SPACEX OPENAI ANTHROPIC MAG7 SEMIS ROBOT INFOTECH" \
  "km:M:US500 M:SMALL2000 M:USTECH M:USENERGY M:USOIL M:USBOND M:EUR M:BABA"
do
  DEX=$(echo "$DEX_INFO" | cut -d: -f1)
  SYMBOLS=$(echo "$DEX_INFO" | cut -d: -f2-)

  echo ""
  echo "=========================================="
  echo "Processing $DEX"
  echo "=========================================="

  for SYMBOL in $SYMBOLS; do
    echo ""
    echo "Fetching ${DEX}:${SYMBOL}..."

    # Process in chunks (API returns max 500 records)
    CHUNK_SIZE=$((15 * 24 * 60 * 60 * 1000))  # 15 days in ms
    CHUNK_START=$START_TIME
    TOTAL_RECORDS=0

    while [ $CHUNK_START -lt $END_TIME ]; do
      CHUNK_END=$((CHUNK_START + CHUNK_SIZE))
      if [ $CHUNK_END -gt $END_TIME ]; then
        CHUNK_END=$END_TIME
      fi

      # Fetch funding history from Hyperliquid API
      RESPONSE=$(curl -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "{
          \"type\": \"fundingHistory\",
          \"coin\": \"${DEX}:${SYMBOL}\",
          \"startTime\": $CHUNK_START,
          \"endTime\": $CHUNK_END
        }")

      # Check if we got data
      RECORD_COUNT=$(echo "$RESPONSE" | jq 'length' 2>/dev/null || echo "0")

      if [ "$RECORD_COUNT" -eq 0 ] || [ "$RECORD_COUNT" = "null" ]; then
        # No more data, move to next chunk
        CHUNK_START=$CHUNK_END
        continue
      fi

      echo "  ✓ Chunk $(date -u -r $((CHUNK_START / 1000)) +%Y-%m-%d) to $(date -u -r $((CHUNK_END / 1000)) +%Y-%m-%d): $RECORD_COUNT records"
      TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))

      # Create SQL file
      SQL_FILE=$(mktemp)

    # Process records and generate SQL
    echo "$RESPONSE" | jq -r '.[] | @json' | while IFS= read -r record; do
      TIME=$(echo "$record" | jq -r '.time')
      COIN_NAME=$(echo "$record" | jq -r '.coin')
      FUNDING_RATE=$(echo "$record" | jq -r '.fundingRate')

      if [ "$TIME" = "null" ] || [ "$FUNDING_RATE" = "null" ]; then
        continue
      fi

      # Convert millisecond timestamp to hour timestamp
      TIME_SECONDS=$((TIME / 1000))
      HOUR_TIMESTAMP=$(( (TIME_SECONDS / 3600) * 3600 ))

      # Symbol format: "dex:SYMBOL" (e.g., "flx:GOLD")
      # Normalized symbol: just "SYMBOL" (e.g., "GOLD")
      NORMALIZED_SYMBOL=$(echo "$COIN_NAME" | sed "s/^${DEX}://")

      # HIP-3: 8-hour intervals = 3 payments/day = rate * 3 * 365
      FUNDING_ANNUAL=$(echo "$FUNDING_RATE * 3 * 365" | bc -l)

      cat >> "$SQL_FILE" <<EOF
INSERT OR REPLACE INTO market_history (
  exchange, symbol, normalized_symbol, hour_timestamp,
  avg_mark_price, avg_index_price, avg_funding_rate, avg_funding_rate_annual,
  min_price, max_price, price_volatility,
  volume_base, volume_quote,
  avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
  min_funding_rate, max_funding_rate,
  sample_count, aggregated_at
) VALUES (
  '$DEX', '$COIN_NAME', '$NORMALIZED_SYMBOL', $HOUR_TIMESTAMP,
  NULL, NULL, $FUNDING_RATE, $FUNDING_ANNUAL,
  NULL, NULL, NULL,
  NULL, NULL,
  NULL, NULL, NULL,
  $FUNDING_RATE, $FUNDING_RATE,
  1, unixepoch('now')
);
EOF
    done

      # Import to database
      if [ -s "$SQL_FILE" ]; then
        LINE_COUNT=$(wc -l < "$SQL_FILE")
        RECORD_IMPORT=$((LINE_COUNT / 24))  # Each INSERT is ~24 lines

        if npx wrangler d1 execute "$DB_WRITE" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1; then
          echo "    ✅ Imported $RECORD_IMPORT records to DB_WRITE"
          TOTAL_IMPORTED=$((TOTAL_IMPORTED + RECORD_IMPORT))
        else
          echo "    ⚠️  Import to DB_WRITE had errors"
        fi
      fi

      rm -f "$SQL_FILE"
      sleep 0.5

      # Move to next chunk
      CHUNK_START=$CHUNK_END
    done

    echo "  ✅ Total for ${DEX}:${SYMBOL}: $TOTAL_RECORDS records"
  done
done

echo ""
echo "=========================================="
echo "Import Complete!"
echo "=========================================="
echo "Total records imported to DB_WRITE: ~$TOTAL_IMPORTED"
echo "Completed at: $(date -u)"
echo ""
echo "NOTE: Data is now in DB_WRITE. To make it available via API:"
echo "  Run sync script or manually sync to DB_READ"
