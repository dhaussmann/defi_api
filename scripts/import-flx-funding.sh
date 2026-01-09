#!/bin/bash

# FLX (Trade.flx) Historical Funding Rate Import
# ===============================================
# Imports funding rates from FLX in 15-day chunks for the last 30 days.
#
# Usage:
#   ./import-flx-funding.sh

set -e

API_URL="https://api.hyperliquid.flx/info"
DB_NAME="defiapi-db"
REMOTE="--remote"
EXCHANGE="flx"
DEX="flx"

# Coins to import (only crypto assets have historical funding data on FLX)
# Traditional finance instruments (stocks, commodities, forex) don't have historical data
COINS=("BTC" "ETH" "SOL")

# Time range: Start from December 1, 2025 (when FLX DEX launched)
# FLX is a new HIP-3 DEX that launched in December 2025
START_TIME=1764547200000  # Dec 1, 2025 in ms
CURRENT_TIME=$(date +%s)
END_TIME=$(( CURRENT_TIME * 1000 ))  # Now in ms

# 15 days in milliseconds
CHUNK_SIZE=$((15 * 24 * 60 * 60 * 1000))

echo "=========================================="
echo "FLX (Trade.flx) Historical Funding Import"
echo "=========================================="
echo "Exchange: $EXCHANGE"
echo "DEX: $DEX"
echo "Coins: ${#COINS[@]} symbols"
echo "Start: $(date -u -r $((START_TIME / 1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo "End:   $(date -u -r $((END_TIME / 1000)) '+%Y-%m-%d %H:%M:%S UTC')"
echo "Chunk size: 15 days"
echo ""

# Calculate total chunks
TOTAL_DURATION=$((END_TIME - START_TIME))
TOTAL_CHUNKS=$(( (TOTAL_DURATION + CHUNK_SIZE - 1) / CHUNK_SIZE ))
TOTAL_API_CALLS=$((TOTAL_CHUNKS * ${#COINS[@]}))

echo "Total chunks per coin: $TOTAL_CHUNKS"
echo "Total API calls: $TOTAL_API_CALLS"
echo "Estimated time: ~$((TOTAL_API_CALLS / 2)) seconds (at 2 calls/sec)"
echo ""

# Check existing data
echo "[1/2] Checking existing data..."
EXISTING_COUNT=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT COUNT(*) as cnt FROM market_history WHERE exchange = '$EXCHANGE'
" --json 2>/dev/null | jq -r '.[] | .results[0].cnt' || echo "0")
echo "Current records in DB: $EXISTING_COUNT"
echo ""

# Import data
echo "[2/2] Importing funding rates..."
TOTAL_IMPORTED=0
TOTAL_ERRORS=0
SKIPPED_COINS=0

for COIN in "${COINS[@]}"; do
  echo ""
  echo "Processing: $COIN"
  echo "----------------------------------------"

  COIN_IMPORTED=0
  COIN_ERRORS=0
  CHUNK_NUM=0

  # Create SQL file for this coin
  SQL_FILE=$(mktemp)

  # Loop through time chunks
  CURRENT_START=$START_TIME
  while [ $CURRENT_START -lt $END_TIME ]; do
    ((CHUNK_NUM++))

    # Calculate chunk end (min of current + chunk_size and END_TIME)
    CURRENT_END=$((CURRENT_START + CHUNK_SIZE))
    if [ $CURRENT_END -gt $END_TIME ]; then
      CURRENT_END=$END_TIME
    fi

    echo "  Chunk $CHUNK_NUM: $(date -u -r $((CURRENT_START / 1000)) '+%Y-%m-%d') to $(date -u -r $((CURRENT_END / 1000)) '+%Y-%m-%d')"

    # Call API
    RESPONSE=$(curl -s -X POST "$API_URL" \
      -H "Content-Type: application/json" \
      -d "{
        \"type\": \"fundingHistory\",
        \"coin\": \"$COIN\",
        \"startTime\": $CURRENT_START,
        \"endTime\": $CURRENT_END,
        \"dex\": \"$DEX\"
      }" 2>/dev/null || echo '[]')

    # Small delay to avoid rate limiting
    sleep 0.5

    # Check if response is valid JSON array
    if ! echo "$RESPONSE" | jq -e '. | type == "array"' > /dev/null 2>&1; then
      echo "    ✗ Invalid response (not an array)"
      ((COIN_ERRORS++))
      CURRENT_START=$CURRENT_END
      continue
    fi

    # Count records
    RECORD_COUNT=$(echo "$RESPONSE" | jq 'length' 2>/dev/null || echo "0")

    if [ "$RECORD_COUNT" -eq 0 ]; then
      echo "    - No data for this period"
      CURRENT_START=$CURRENT_END
      continue
    fi

    echo "    Processing $RECORD_COUNT records..."

    # Process each funding rate record
    echo "$RESPONSE" | jq -c '.[]' | while IFS= read -r record; do
      # Extract fields
      TIME=$(echo "$record" | jq -r '.time')
      COIN_NAME=$(echo "$record" | jq -r '.coin')
      FUNDING_RATE=$(echo "$record" | jq -r '.fundingRate')
      PREMIUM=$(echo "$record" | jq -r '.premium // "0"')

      # Skip if essential fields are null
      if [ "$TIME" = "null" ] || [ "$FUNDING_RATE" = "null" ]; then
        continue
      fi

      # Convert time to seconds (API returns milliseconds)
      TIME_SECONDS=$((TIME / 1000))

      # Round to nearest hour for hour_timestamp
      HOUR_TIMESTAMP=$(( (TIME_SECONDS / 3600) * 3600 ))

      # Symbol formatting - API returns "flx:COIN", use as-is
      SYMBOL="$COIN_NAME"
      # Normalized symbol without prefix
      NORMALIZED_SYMBOL=$(echo "$COIN_NAME" | sed 's/^flx://')

      # Calculate annual funding rate
      # HIP-3 DEXs use 8-hour intervals = 3 payments per day
      FUNDING_ANNUAL=$(echo "$FUNDING_RATE * 100 * 3 * 365" | bc -l)

      # Create INSERT statement
      cat >> "$SQL_FILE" <<EOF
INSERT INTO market_history (
  exchange, symbol, normalized_symbol, hour_timestamp,
  avg_mark_price, avg_index_price, avg_funding_rate, avg_funding_rate_annual,
  min_price, max_price, price_volatility,
  volume_base, volume_quote,
  avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
  min_funding_rate, max_funding_rate,
  sample_count, aggregated_at
) VALUES (
  '$EXCHANGE', '$SYMBOL', '$NORMALIZED_SYMBOL', $HOUR_TIMESTAMP,
  0.0, 0.0, $FUNDING_RATE, $FUNDING_ANNUAL,
  0.0, 0.0, 0.0,
  0.0, 0.0,
  0.0, 0.0, 0.0,
  $FUNDING_RATE, $FUNDING_RATE,
  1, unixepoch('now')
) ON CONFLICT(exchange, symbol, hour_timestamp) DO UPDATE SET
  avg_funding_rate = COALESCE(avg_funding_rate, $FUNDING_RATE),
  avg_funding_rate_annual = COALESCE(avg_funding_rate_annual, $FUNDING_ANNUAL),
  min_funding_rate = COALESCE(min_funding_rate, $FUNDING_RATE),
  max_funding_rate = COALESCE(max_funding_rate, $FUNDING_RATE);
EOF

      ((COIN_IMPORTED++))
    done

    echo "    ✓ Processed: $RECORD_COUNT records"

    # Move to next chunk
    CURRENT_START=$CURRENT_END
  done

  # Import this coin's data
  if [ -s "$SQL_FILE" ]; then
    echo "  Importing $COIN_IMPORTED records to database..."
    npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1
    echo "  ✓ Import completed for $COIN"
    ((TOTAL_IMPORTED += COIN_IMPORTED))
  else
    echo "  ✗ No data to import for $COIN"
    ((SKIPPED_COINS++))
  fi

  # Cleanup
  rm -f "$SQL_FILE"

  ((TOTAL_ERRORS += COIN_ERRORS))

  echo "  Total for $COIN: $COIN_IMPORTED imported, $COIN_ERRORS errors"
done

echo ""
echo "=========================================="
echo "Import Summary"
echo "=========================================="
echo "Exchange: $EXCHANGE ($DEX)"
echo "Coins processed: ${#COINS[@]}"
echo "Coins with data: $((${#COINS[@]} - SKIPPED_COINS))"
echo "Coins skipped (no data): $SKIPPED_COINS"
echo "Total records imported: $TOTAL_IMPORTED"
echo "Total errors: $TOTAL_ERRORS"
echo ""

# Check new total
NEW_COUNT=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT COUNT(*) as cnt FROM market_history WHERE exchange = '$EXCHANGE'
" --json 2>/dev/null | jq -r '.[] | .results[0].cnt' || echo "0")
echo "Records in DB before: $EXISTING_COUNT"
echo "Records in DB after:  $NEW_COUNT"
echo "Net increase:         $((NEW_COUNT - EXISTING_COUNT))"
echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
