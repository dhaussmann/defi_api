#!/bin/bash

# EdgeX Fast Funding Rate Import Script
# ======================================
# This script imports settlement funding rates by splitting the date range
# into monthly chunks, which dramatically speeds up the import process.
#
# Strategy: The API returns newest-first, so importing recent months is fast.
# By splitting into months, we avoid paging through 500+ pages per contract.
#
# Usage:
#   ./import-edgex-funding-fast.sh [START_DATE] [END_DATE]

set -e

API_BASE="https://pro.edgex.exchange/api/v1/public"
DB_NAME="defiapi-db"
REMOTE="--remote"
PAGE_SIZE=1000
EXCHANGE="edgex"

# Parse arguments
START_DATE="${1:-2025-01-01}"
END_DATE="${2:-$(date -u '+%Y-%m-%d')}"

echo "=========================================="
echo "EdgeX Fast Funding Rate Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE"
echo "Strategy: Monthly chunks + settlement-only"
echo ""

# Get all active contracts
echo "[1/4] Fetching EdgeX contracts..."
METADATA=$(curl -s "$API_BASE/meta/getMetaData")
CONTRACTS=$(echo "$METADATA" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')

CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found $CONTRACT_COUNT active contracts"
echo ""

# Generate monthly date ranges
echo "[2/4] Generating monthly import chunks..."
MONTHS=()

# Parse start and end dates
START_YEAR=$(echo "$START_DATE" | cut -d'-' -f1)
START_MONTH=$(echo "$START_DATE" | cut -d'-' -f2)
END_YEAR=$(echo "$END_DATE" | cut -d'-' -f1)
END_MONTH=$(echo "$END_DATE" | cut -d'-' -f2)

# Generate list of year-months
CURRENT_YEAR=$START_YEAR
CURRENT_MONTH=$START_MONTH

while [ "$CURRENT_YEAR" -lt "$END_YEAR" ] || { [ "$CURRENT_YEAR" -eq "$END_YEAR" ] && [ "$CURRENT_MONTH" -le "$END_MONTH" ]; }; do
  MONTHS+=("$CURRENT_YEAR-$(printf "%02d" $CURRENT_MONTH)")

  # Increment month
  CURRENT_MONTH=$((CURRENT_MONTH + 1))
  if [ "$CURRENT_MONTH" -gt 12 ]; then
    CURRENT_MONTH=1
    CURRENT_YEAR=$((CURRENT_YEAR + 1))
  fi
done

MONTH_COUNT=${#MONTHS[@]}
echo "Split into $MONTH_COUNT monthly chunks"
echo ""

# Create temporary files
TEMP_FILE=$(mktemp)
SQL_FILE=$(mktemp)
trap "rm -f $TEMP_FILE $SQL_FILE" EXIT

echo "[3/4] Collecting settlement funding rates..."
TOTAL_SETTLEMENTS=0
CURRENT_CONTRACT=0

# Process each contract
while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  ((CURRENT_CONTRACT++))
  echo "  [$CURRENT_CONTRACT/$CONTRACT_COUNT] Processing $CONTRACT_NAME..."

  CONTRACT_SETTLEMENTS=0

  # Process each month for this contract
  for i in "${!MONTHS[@]}"; do
    MONTH_STR="${MONTHS[$i]}"

    # Calculate month boundaries
    MONTH_START="${MONTH_STR}-01 00:00:00"

    # Calculate last day of month
    NEXT_MONTH_IDX=$((i + 1))
    if [ $NEXT_MONTH_IDX -lt $MONTH_COUNT ]; then
      MONTH_END="${MONTHS[$NEXT_MONTH_IDX]}-01 00:00:00"
    else
      # Last month: use END_DATE
      MONTH_END="$END_DATE 23:59:59"
    fi

    # Convert to milliseconds timestamp
    MONTH_START_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$MONTH_START" "+%s" 2>/dev/null || date -d "$MONTH_START" "+%s" 2>/dev/null)000
    MONTH_END_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$MONTH_END" "+%s" 2>/dev/null || date -d "$MONTH_END" "+%s" 2>/dev/null)000

    # Fetch data for this month
    OFFSET_DATA=""
    PAGE=1
    MONTH_SETTLEMENTS=0
    MAX_PAGES=50  # Safety limit per month (should only need ~2-3 pages)

    while [ $PAGE -le $MAX_PAGES ]; do
      # Build API URL
      API_URL="$API_BASE/funding/getFundingRatePage?contractId=$CONTRACT_ID&size=$PAGE_SIZE"
      API_URL="$API_URL&filterBeginTimeInclusive=$MONTH_START_TS&filterEndTimeExclusive=$MONTH_END_TS"

      if [ -n "$OFFSET_DATA" ]; then
        API_URL="$API_URL&offsetData=$OFFSET_DATA"
      fi

      # Fetch page
      RESPONSE=$(curl -s "$API_URL")

      # Check for errors
      CODE=$(echo "$RESPONSE" | jq -r '.code')
      if [ "$CODE" != "SUCCESS" ]; then
        break
      fi

      # Extract ONLY settlement records
      DATA_LIST=$(echo "$RESPONSE" | jq -r '.data.dataList[] | select(.isSettlement == true) | @json')

      # Check if we got any data at all
      TOTAL_IN_PAGE=$(echo "$RESPONSE" | jq '.data.dataList | length')
      if [ "$TOTAL_IN_PAGE" -eq 0 ]; then
        break
      fi

      # Process settlement records
      if [ -n "$DATA_LIST" ]; then
        while IFS= read -r record; do
          FUNDING_TS=$(echo "$record" | jq -r '.fundingTimestamp')
          ORACLE_PRICE=$(echo "$record" | jq -r '.oraclePrice')
          INDEX_PRICE=$(echo "$record" | jq -r '.indexPrice')
          FUNDING_RATE=$(echo "$record" | jq -r '.fundingRate')

          # Convert timestamp to Unix epoch (seconds)
          EPOCH_TS=$((FUNDING_TS / 1000))

          # Round to nearest hour
          HOUR_TS=$((EPOCH_TS - (EPOCH_TS % 3600)))

          # Write to temp file
          echo "$CONTRACT_NAME|$HOUR_TS|$ORACLE_PRICE|$INDEX_PRICE|$FUNDING_RATE" >> "$TEMP_FILE"
          ((MONTH_SETTLEMENTS++))
          ((CONTRACT_SETTLEMENTS++))
          ((TOTAL_SETTLEMENTS++))
        done <<< "$DATA_LIST"
      fi

      # Check for next page
      OFFSET_DATA=$(echo "$RESPONSE" | jq -r '.data.nextPageOffsetData // empty')

      if [ -z "$OFFSET_DATA" ]; then
        break
      fi

      ((PAGE++))
    done

    # Progress: show month completion
    if [ $MONTH_SETTLEMENTS -gt 0 ]; then
      echo "    $MONTH_STR: $MONTH_SETTLEMENTS settlements"
    fi
  done

  echo "    Total: $CONTRACT_SETTLEMENTS settlements"

done <<< "$CONTRACTS"

echo ""
echo "Total settlements collected: $TOTAL_SETTLEMENTS"
echo ""

# Import into database
echo "[4/4] Importing into database..."

> "$SQL_FILE"

IMPORT_COUNT=0

while IFS='|' read -r SYMBOL HOUR_TS ORACLE_PRICE INDEX_PRICE FUNDING_RATE; do
  # Normalize symbol
  NORMALIZED_SYMBOL=$(echo "$SYMBOL" | sed 's/USD$//')

  # Calculate annual funding rate
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
  sample_count, created_at
) VALUES (
  '$EXCHANGE', '$SYMBOL', '$NORMALIZED_SYMBOL', $HOUR_TS,
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
  avg_funding_rate_annual = COALESCE(avg_funding_rate_annual, $FUNDING_ANNUAL),
  min_funding_rate = COALESCE(min_funding_rate, $FUNDING_RATE),
  max_funding_rate = COALESCE(max_funding_rate, $FUNDING_RATE);
EOF

  ((IMPORT_COUNT++))

  if [ $((IMPORT_COUNT % 5000)) -eq 0 ]; then
    echo "  Prepared $IMPORT_COUNT records..."
  fi
done < "$TEMP_FILE"

echo "  Prepared $IMPORT_COUNT SQL statements"
echo ""

# Execute SQL
echo "  Executing database import..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$SQL_FILE"

echo ""
echo "=========================================="
echo "Import Summary"
echo "=========================================="
echo "Contracts processed: $CONTRACT_COUNT"
echo "Monthly chunks: $MONTH_COUNT"
echo "Settlement records imported: $IMPORT_COUNT"
echo "Date range: $START_DATE to $END_DATE"
echo "Avg per contract: $(echo "scale=0; $IMPORT_COUNT / $CONTRACT_COUNT" | bc) records"
echo ""

# Verify import
echo "Verification:"
START_TS_SEC=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$START_DATE 00:00:00" "+%s" 2>/dev/null || date -d "$START_DATE 00:00:00" "+%s" 2>/dev/null)
END_TS_SEC=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$END_DATE 23:59:59" "+%s" 2>/dev/null || date -d "$END_DATE 23:59:59" "+%s" 2>/dev/null)

npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT
  COUNT(DISTINCT symbol) as symbols,
  COUNT(*) as total_hours,
  datetime(MIN(hour_timestamp), 'unixepoch') as earliest,
  datetime(MAX(hour_timestamp), 'unixepoch') as latest
FROM market_history
WHERE exchange = '$EXCHANGE'
  AND hour_timestamp >= $START_TS_SEC
  AND hour_timestamp <= $END_TS_SEC
" --json | jq -r '.[] | .results[] | "  Symbols: \(.symbols)\n  Hours: \(.total_hours)\n  Range: \(.earliest) to \(.latest)"'

echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
