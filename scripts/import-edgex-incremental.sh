#!/bin/bash

# EdgeX Incremental Funding Rate Import Script
# =============================================
# Imports funding rates for symbols that don't have complete historical data.
# Can be safely interrupted and restarted - skips already completed symbols.
#
# Usage:
#   ./import-edgex-incremental.sh [START_DATE] [END_DATE]

set -e

API_BASE="https://pro.edgex.exchange/api/v1/public"
DB_NAME="defiapi-db"
REMOTE="--remote"
PAGE_SIZE=1000
EXCHANGE="edgex"

# Parse arguments
START_DATE="${1:-2025-01-01}"
END_DATE="${2:-$(date -u '+%Y-%m-%d')}"

# Convert dates to timestamps
START_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$START_DATE 00:00:00" "+%s" 2>/dev/null || date -d "$START_DATE 00:00:00" "+%s" 2>/dev/null)
END_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$END_DATE 23:59:59" "+%s" 2>/dev/null || date -d "$END_DATE 23:59:59" "+%s" 2>/dev/null)

# Calculate expected records (4h settlements)
HOURS=$((END_TS - START_TS))
HOURS=$((HOURS / 3600))
EXPECTED_SETTLEMENTS=$((HOURS / 4))

echo "=========================================="
echo "EdgeX Incremental Funding Rate Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE"
echo "Expected settlements per symbol: ~$EXPECTED_SETTLEMENTS"
echo ""

# Get all active contracts
echo "[1/3] Fetching EdgeX contracts..."
METADATA=$(curl -s "$API_BASE/meta/getMetaData")
CONTRACTS=$(echo "$METADATA" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')

CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found $CONTRACT_COUNT active contracts"
echo ""

# Check which symbols already have complete data
echo "[2/3] Checking existing data coverage..."
COMPLETE_SYMBOLS=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT
  symbol,
  COUNT(*) as records
FROM market_history
WHERE exchange = '$EXCHANGE'
  AND hour_timestamp >= $START_TS
  AND hour_timestamp <= $END_TS
GROUP BY symbol
HAVING records > $((EXPECTED_SETTLEMENTS - 100))
" --json 2>/dev/null | jq -r '.[] | .results[]? | .symbol' || echo "")

if [ -n "$COMPLETE_SYMBOLS" ]; then
  COMPLETE_COUNT=$(echo "$COMPLETE_SYMBOLS" | wc -l | tr -d ' ')
  echo "Found $COMPLETE_COUNT symbols with complete data (will skip)"
else
  COMPLETE_COUNT=0
  echo "No symbols with complete data found"
fi
echo ""

# Process each contract
echo "[3/3] Importing funding rates..."
CURRENT=0
SKIPPED=0
IMPORTED=0
TOTAL_SETTLEMENTS=0

while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  ((CURRENT++))

  # Check if already complete
  if echo "$COMPLETE_SYMBOLS" | grep -q "^${CONTRACT_NAME}$"; then
    echo "  [$CURRENT/$CONTRACT_COUNT] $CONTRACT_NAME - SKIP (already complete)"
    ((SKIPPED++))
    continue
  fi

  echo "  [$CURRENT/$CONTRACT_COUNT] Processing $CONTRACT_NAME (ID: $CONTRACT_ID)..."

  # Collect settlements for this contract
  TEMP_FILE=$(mktemp)
  CONTRACT_SETTLEMENTS=0

  # Generate monthly chunks
  START_YEAR=$(echo "$START_DATE" | cut -d'-' -f1)
  START_MONTH=$(echo "$START_DATE" | cut -d'-' -f2)
  END_YEAR=$(echo "$END_DATE" | cut -d'-' -f1)
  END_MONTH=$(echo "$END_DATE" | cut -d'-' -f2)

  CURRENT_YEAR=$START_YEAR
  CURRENT_MONTH=$START_MONTH

  while [ "$CURRENT_YEAR" -lt "$END_YEAR" ] || { [ "$CURRENT_YEAR" -eq "$END_YEAR" ] && [ "$CURRENT_MONTH" -le "$END_MONTH" ]; }; do
    MONTH_STR="$CURRENT_YEAR-$(printf "%02d" $CURRENT_MONTH)"
    MONTH_START="${MONTH_STR}-01 00:00:00"

    # Calculate next month for end boundary
    NEXT_MONTH=$((CURRENT_MONTH + 1))
    NEXT_YEAR=$CURRENT_YEAR
    if [ "$NEXT_MONTH" -gt 12 ]; then
      NEXT_MONTH=1
      NEXT_YEAR=$((CURRENT_YEAR + 1))
    fi

    # Check if this is the last month
    if [ "$CURRENT_YEAR" -eq "$END_YEAR" ] && [ "$CURRENT_MONTH" -eq "$END_MONTH" ]; then
      MONTH_END="$END_DATE 23:59:59"
    else
      MONTH_END="$NEXT_YEAR-$(printf "%02d" $NEXT_MONTH)-01 00:00:00"
    fi

    # Convert to milliseconds
    MONTH_START_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$MONTH_START" "+%s" 2>/dev/null || date -d "$MONTH_START" "+%s" 2>/dev/null)000
    MONTH_END_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$MONTH_END" "+%s" 2>/dev/null || date -d "$MONTH_END" "+%s" 2>/dev/null)000

    # Fetch settlements for this month
    OFFSET_DATA=""
    PAGE=1
    MAX_PAGES=10

    while [ $PAGE -le $MAX_PAGES ]; do
      API_URL="$API_BASE/funding/getFundingRatePage?contractId=$CONTRACT_ID&size=$PAGE_SIZE"
      API_URL="$API_URL&filterBeginTimeInclusive=$MONTH_START_TS&filterEndTimeExclusive=$MONTH_END_TS"

      if [ -n "$OFFSET_DATA" ]; then
        API_URL="$API_URL&offsetData=$OFFSET_DATA"
      fi

      RESPONSE=$(curl -s "$API_URL")
      CODE=$(echo "$RESPONSE" | jq -r '.code')

      if [ "$CODE" != "SUCCESS" ]; then
        break
      fi

      TOTAL_IN_PAGE=$(echo "$RESPONSE" | jq '.data.dataList | length')
      if [ "$TOTAL_IN_PAGE" -eq 0 ]; then
        break
      fi

      # Extract settlement records
      echo "$RESPONSE" | jq -r '.data.dataList[] | select(.isSettlement == true) | "\(.fundingTimestamp)|\(.oraclePrice)|\(.indexPrice)|\(.fundingRate)"' >> "$TEMP_FILE"

      OFFSET_DATA=$(echo "$RESPONSE" | jq -r '.data.nextPageOffsetData // empty')
      if [ -z "$OFFSET_DATA" ]; then
        break
      fi

      ((PAGE++))
    done

    # Increment month
    CURRENT_MONTH=$((CURRENT_MONTH + 1))
    if [ "$CURRENT_MONTH" -gt 12 ]; then
      CURRENT_MONTH=1
      CURRENT_YEAR=$((CURRENT_YEAR + 1))
    fi
  done

  # Count settlements collected
  if [ -f "$TEMP_FILE" ]; then
    CONTRACT_SETTLEMENTS=$(wc -l < "$TEMP_FILE" | tr -d ' ')
  fi

  if [ "$CONTRACT_SETTLEMENTS" -eq 0 ]; then
    echo "    No settlements found, skipping"
    rm -f "$TEMP_FILE"
    continue
  fi

  echo "    Collected $CONTRACT_SETTLEMENTS settlements, importing..."

  # Create SQL file for this contract
  SQL_FILE=$(mktemp)

  while IFS='|' read -r FUNDING_TS ORACLE_PRICE INDEX_PRICE FUNDING_RATE; do
    # Convert to epoch seconds and round to hour
    EPOCH_TS=$((FUNDING_TS / 1000))
    HOUR_TS=$((EPOCH_TS - (EPOCH_TS % 3600)))

    # Normalize symbol
    NORMALIZED_SYMBOL=$(echo "$CONTRACT_NAME" | sed 's/USD$//')

    # Calculate annual funding rate
    FUNDING_ANNUAL=$(echo "$FUNDING_RATE * 100 * 3 * 365" | bc -l)

    cat >> "$SQL_FILE" <<EOF
INSERT INTO market_history (
  exchange, symbol, normalized_symbol, hour_timestamp,
  avg_mark_price, avg_index_price, avg_funding_rate, avg_funding_rate_annual,
  min_price, max_price, price_volatility,
  volume_base, volume_quote,
  avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
  min_funding_rate, max_funding_rate,
  sample_count, created_at
) VALUES (
  '$EXCHANGE', '$CONTRACT_NAME', '$NORMALIZED_SYMBOL', $HOUR_TS,
  $ORACLE_PRICE, $INDEX_PRICE, $FUNDING_RATE, $FUNDING_ANNUAL,
  $ORACLE_PRICE, $ORACLE_PRICE, 0.0,
  0.0, 0.0,
  0.0, 0.0, 0.0,
  $FUNDING_RATE, $FUNDING_RATE,
  1, unixepoch('now')
) ON CONFLICT(exchange, symbol, hour_timestamp) DO UPDATE SET
  avg_mark_price = COALESCE(avg_mark_price, $ORACLE_PRICE),
  avg_index_price = COALESCE(avg_index_price, $INDEX_PRICE),
  avg_funding_rate = COALESCE(avg_funding_rate, $FUNDING_RATE),
  avg_funding_rate_annual = COALESCE(avg_funding_rate_annual, $FUNDING_ANNUAL);
EOF
  done < "$TEMP_FILE"

  # Execute import for this contract
  npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1

  echo "    ✓ Imported $CONTRACT_SETTLEMENTS records"

  # Cleanup
  rm -f "$TEMP_FILE" "$SQL_FILE"

  ((IMPORTED++))
  ((TOTAL_SETTLEMENTS += CONTRACT_SETTLEMENTS))

done <<< "$CONTRACTS"

echo ""
echo "=========================================="
echo "Import Summary"
echo "=========================================="
echo "Total contracts: $CONTRACT_COUNT"
echo "Already complete: $SKIPPED"
echo "Newly imported: $IMPORTED"
echo "Total settlements: $TOTAL_SETTLEMENTS"
echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
