#!/bin/bash

# EdgeX Historical Funding Rate Import with Hourly Aggregation
# =============================================================
# Imports ALL funding rates (not just settlements) and aggregates them hourly.
# This works around the issue that historical data may not have settlement flags.
#
# Strategy:
# - Fetch all funding rates for each contract
# - Group by hour and calculate average
# - Import hourly aggregates into database
# - Process month by month to keep memory usage low
#
# Usage:
#   ./import-edgex-historical-funding.sh [START_DATE] [END_DATE]

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
echo "EdgeX Historical Funding Rate Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE"
echo "Strategy: All funding rates + hourly aggregation"
echo ""

# Get all active contracts
echo "[1/4] Fetching EdgeX contracts..."
METADATA=$(curl -s "$API_BASE/meta/getMetaData")
CONTRACTS=$(echo "$METADATA" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')

CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found $CONTRACT_COUNT active contracts"
echo ""

# Check existing data
echo "[2/4] Checking existing data..."
EXISTING_DATA=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT symbol, COUNT(*) as records
FROM market_history
WHERE exchange = '$EXCHANGE'
GROUP BY symbol
" --json 2>/dev/null | jq -r '.[] | .results[]? | "\(.symbol):\(.records)"' || echo "")

echo "Existing data in database:"
if [ -n "$EXISTING_DATA" ]; then
  echo "$EXISTING_DATA" | head -5
  EXISTING_COUNT=$(echo "$EXISTING_DATA" | wc -l | tr -d ' ')
  echo "... and $((EXISTING_COUNT - 5)) more symbols"
else
  echo "  No data found"
fi
echo ""

# Generate monthly chunks
echo "[3/4] Generating monthly import plan..."
START_YEAR=$(echo "$START_DATE" | cut -d'-' -f1)
START_MONTH=$(echo "$START_DATE" | cut -d'-' -f2)
END_YEAR=$(echo "$END_DATE" | cut -d'-' -f1)
END_MONTH=$(echo "$END_DATE" | cut -d'-' -f2)

MONTHS=()
CURRENT_YEAR=$START_YEAR
CURRENT_MONTH=$START_MONTH

while [ "$CURRENT_YEAR" -lt "$END_YEAR" ] || { [ "$CURRENT_YEAR" -eq "$END_YEAR" ] && [ "$CURRENT_MONTH" -le "$END_MONTH" ]; }; do
  MONTHS+=("$CURRENT_YEAR-$(printf "%02d" $CURRENT_MONTH)")
  CURRENT_MONTH=$((CURRENT_MONTH + 1))
  if [ "$CURRENT_MONTH" -gt 12 ]; then
    CURRENT_MONTH=1
    CURRENT_YEAR=$((CURRENT_YEAR + 1))
  fi
done

MONTH_COUNT=${#MONTHS[@]}
echo "Will process $MONTH_COUNT months"
echo ""

# Import data
echo "[4/4] Importing funding rates..."
TOTAL_IMPORTED=0
CURRENT_CONTRACT=0

while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  ((CURRENT_CONTRACT++))
  echo "  [$CURRENT_CONTRACT/$CONTRACT_COUNT] Processing $CONTRACT_NAME..."

  CONTRACT_TOTAL=0

  # Process each month
  for i in "${!MONTHS[@]}"; do
    MONTH_STR="${MONTHS[$i]}"
    MONTH_START="${MONTH_STR}-01 00:00:00"

    # Calculate month end
    NEXT_IDX=$((i + 1))
    if [ $NEXT_IDX -lt $MONTH_COUNT ]; then
      MONTH_END="${MONTHS[$NEXT_IDX]}-01 00:00:00"
    else
      MONTH_END="$END_DATE 23:59:59"
    fi

    # Convert to milliseconds
    MONTH_START_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$MONTH_START" "+%s" 2>/dev/null || date -d "$MONTH_START" "+%s" 2>/dev/null)000
    MONTH_END_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$MONTH_END" "+%s" 2>/dev/null || date -d "$MONTH_END" "+%s" 2>/dev/null)000

    # Fetch all funding rates for this month
    TEMP_RAW=$(mktemp)
    PAGE=1
    MAX_PAGES=50
    OFFSET_DATA=""

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

      DATA_COUNT=$(echo "$RESPONSE" | jq '.data.dataList | length')
      if [ "$DATA_COUNT" -eq 0 ]; then
        break
      fi

      # Extract funding rate data (ALL records, not just settlements)
      echo "$RESPONSE" | jq -r '.data.dataList[] | "\(.fundingTimestamp)|\(.oraclePrice)|\(.indexPrice)|\(.fundingRate)"' >> "$TEMP_RAW"

      # Save offset for next page
      OFFSET_DATA=$(echo "$RESPONSE" | jq -r '.data.nextPageOffsetData // empty')
      if [ -z "$OFFSET_DATA" ]; then
        break
      fi

      ((PAGE++))
    done

    # Check if we got any data
    if [ ! -f "$TEMP_RAW" ] || [ ! -s "$TEMP_RAW" ]; then
      rm -f "$TEMP_RAW"
      continue
    fi

    RAW_COUNT=$(wc -l < "$TEMP_RAW" | tr -d ' ')

    # Aggregate by hour
    TEMP_AGG=$(mktemp)

    awk -F'|' '
    {
      ts = int($1 / 1000)
      hour_ts = ts - (ts % 3600)

      oracle_price = $2
      index_price = $3
      funding_rate = $4

      sum_oracle[hour_ts] += oracle_price
      sum_index[hour_ts] += index_price
      sum_funding[hour_ts] += funding_rate
      rec_count[hour_ts]++
    }
    END {
      for (hour in rec_count) {
        avg_oracle = sum_oracle[hour] / rec_count[hour]
        avg_index = sum_index[hour] / rec_count[hour]
        avg_funding = sum_funding[hour] / rec_count[hour]
        print hour "|" avg_oracle "|" avg_index "|" avg_funding "|" rec_count[hour]
      }
    }
    ' "$TEMP_RAW" | sort -n > "$TEMP_AGG"

    AGG_COUNT=$(wc -l < "$TEMP_AGG" | tr -d ' ')

    if [ "$AGG_COUNT" -eq 0 ]; then
      rm -f "$TEMP_RAW" "$TEMP_AGG"
      continue
    fi

    # Import aggregated data
    SQL_FILE=$(mktemp)

    while IFS='|' read -r HOUR_TS AVG_ORACLE AVG_INDEX AVG_FUNDING SAMPLE_COUNT; do
      NORMALIZED_SYMBOL=$(echo "$CONTRACT_NAME" | sed 's/USD$//')
      # EdgeX has 4-hour intervals = 6 payments per day
      FUNDING_ANNUAL=$(echo "$AVG_FUNDING * 100 * 6 * 365" | bc -l)

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
  $AVG_ORACLE, $AVG_INDEX, $AVG_FUNDING, $FUNDING_ANNUAL,
  $AVG_ORACLE, $AVG_ORACLE, 0.0,
  0.0, 0.0,
  0.0, 0.0, 0.0,
  $AVG_FUNDING, $AVG_FUNDING,
  $SAMPLE_COUNT, unixepoch('now')
) ON CONFLICT(exchange, symbol, hour_timestamp) DO UPDATE SET
  avg_mark_price = COALESCE(avg_mark_price, $AVG_ORACLE),
  avg_index_price = COALESCE(avg_index_price, $AVG_INDEX),
  avg_funding_rate = COALESCE(avg_funding_rate, $AVG_FUNDING),
  avg_funding_rate_annual = COALESCE(avg_funding_rate_annual, $FUNDING_ANNUAL),
  sample_count = sample_count + $SAMPLE_COUNT;
EOF
    done < "$TEMP_AGG"

    # Execute import
    npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1

    ((CONTRACT_TOTAL += AGG_COUNT))
    ((TOTAL_IMPORTED += AGG_COUNT))

    echo "    $MONTH_STR: $RAW_COUNT records → $AGG_COUNT hours"

    # Cleanup
    rm -f "$TEMP_RAW" "$TEMP_AGG" "$SQL_FILE"
  done

  echo "    Total: $CONTRACT_TOTAL hours imported"

done <<< "$CONTRACTS"

echo ""
echo "=========================================="
echo "Import Summary"
echo "=========================================="
echo "Contracts processed: $CONTRACT_COUNT"
echo "Months processed: $MONTH_COUNT"
echo "Total hours imported: $TOTAL_IMPORTED"
echo "Date range: $START_DATE to $END_DATE"
echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
