#!/bin/bash

# EdgeX Hourly Funding Rate Import
# =================================
# Imports funding rates by querying exactly at each full hour.
# This avoids pagination and is much faster than fetching all minute-level data.
#
# Strategy:
# - For each hour in the date range
# - Query the funding rate at exactly that hour
# - Import directly into database
#
# Usage:
#   ./import-edgex-hourly.sh [START_DATE] [END_DATE]

# set -e disabled - we handle errors manually

API_BASE="https://pro.edgex.exchange/api/v1/public"
DB_NAME="defiapi-db"
REMOTE="--remote"
EXCHANGE="edgex"

# Parse arguments
START_DATE="${1:-2025-10-01}"
END_DATE="${2:-$(date -u '+%Y-%m-%d')}"

# Convert to epoch seconds
START_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$START_DATE 00:00:00" "+%s" 2>/dev/null || date -d "$START_DATE 00:00:00" "+%s" 2>/dev/null)
END_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$END_DATE 23:59:59" "+%s" 2>/dev/null || date -d "$END_DATE 23:59:59" "+%s" 2>/dev/null)

# Calculate number of hours
TOTAL_HOURS=$(( (END_TS - START_TS) / 3600 ))

echo "=========================================="
echo "EdgeX Hourly Funding Rate Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE"
echo "Total hours: $TOTAL_HOURS"
echo "Strategy: Query at each full hour"
echo ""

# Get all active contracts
echo "[1/3] Fetching EdgeX contracts..."
METADATA=$(curl -s "$API_BASE/meta/getMetaData")
CONTRACTS=$(echo "$METADATA" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')

CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found $CONTRACT_COUNT active contracts"
echo ""

TOTAL_API_CALLS=$((TOTAL_HOURS * CONTRACT_COUNT))
echo "Expected API calls: ~$TOTAL_API_CALLS"
echo "Estimated time: ~$((TOTAL_API_CALLS / 10)) seconds (at 10 calls/sec)"
echo ""

# Check existing data
echo "[2/3] Checking existing data..."
EXISTING_COUNT=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT COUNT(*) as cnt FROM market_history WHERE exchange = '$EXCHANGE'
" --json 2>/dev/null | jq -r '.[] | .results[0].cnt' || echo "0")
echo "Current records in DB: $EXISTING_COUNT"
echo ""

# Import data
echo "[3/3] Importing hourly data..."
CURRENT_CONTRACT=0
TOTAL_IMPORTED=0
TOTAL_SKIPPED=0
TOTAL_ERRORS=0

while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  ((CURRENT_CONTRACT++))
  echo "  [$CURRENT_CONTRACT/$CONTRACT_COUNT] $CONTRACT_NAME (ID: $CONTRACT_ID)"

  CONTRACT_IMPORTED=0
  CONTRACT_SKIPPED=0
  CONTRACT_ERRORS=0

  # Create SQL file for this contract
  SQL_FILE=$(mktemp)

  # Loop through each hour
  CURRENT_HOUR_TS=$START_TS
  HOUR_COUNT=0
  while [ $CURRENT_HOUR_TS -le $END_TS ]; do
    ((HOUR_COUNT++))
    # Convert to milliseconds for API
    HOUR_START_MS=$((CURRENT_HOUR_TS * 1000))
    HOUR_END_MS=$(((CURRENT_HOUR_TS + 3600) * 1000))

    # Query funding rate for this exact hour
    RESPONSE=$(curl -s \
      -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
      -H "Accept: application/json" \
      -H "Accept-Language: en-US,en;q=0.9" \
      "$API_BASE/funding/getFundingRatePage?contractId=$CONTRACT_ID&size=1&filterBeginTimeInclusive=$HOUR_START_MS&filterEndTimeExclusive=$HOUR_END_MS" 2>/dev/null || echo '{"code":"CURL_ERROR"}')

    # Small delay to avoid rate limiting
    sleep 0.05

    # Check if we got data
    CODE=$(echo "$RESPONSE" | jq -r '.code' 2>/dev/null || echo "PARSE_ERROR")

    if [ "$CODE" != "SUCCESS" ]; then
      ((CONTRACT_ERRORS++))
      CURRENT_HOUR_TS=$((CURRENT_HOUR_TS + 3600))
      continue
    fi

    DATA_COUNT=$(echo "$RESPONSE" | jq '.data.dataList | length' 2>/dev/null || echo "0")

    if [ "$DATA_COUNT" -eq 0 ]; then
      ((CONTRACT_SKIPPED++))
      CURRENT_HOUR_TS=$((CURRENT_HOUR_TS + 3600))
      continue
    fi

    # Extract first (and should be only) record
    ORACLE_PRICE=$(echo "$RESPONSE" | jq -r '.data.dataList[0].oraclePrice' 2>/dev/null)
    INDEX_PRICE=$(echo "$RESPONSE" | jq -r '.data.dataList[0].indexPrice' 2>/dev/null)
    FUNDING_RATE=$(echo "$RESPONSE" | jq -r '.data.dataList[0].fundingRate' 2>/dev/null)

    # Skip if data is null
    if [ "$ORACLE_PRICE" = "null" ] || [ "$INDEX_PRICE" = "null" ] || [ "$FUNDING_RATE" = "null" ]; then
      ((CONTRACT_SKIPPED++))
      CURRENT_HOUR_TS=$((CURRENT_HOUR_TS + 3600))
      continue
    fi

    # Calculate annual funding rate
    # EdgeX has 4-hour intervals = 6 payments per day
    FUNDING_ANNUAL=$(echo "$FUNDING_RATE * 100 * 6 * 365" | bc -l)

    # Normalize symbol
    NORMALIZED_SYMBOL=$(echo "$CONTRACT_NAME" | sed 's/USD$//')

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
  '$EXCHANGE', '$CONTRACT_NAME', '$NORMALIZED_SYMBOL', $CURRENT_HOUR_TS,
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

    ((CONTRACT_IMPORTED++))

    # Move to next hour
    CURRENT_HOUR_TS=$((CURRENT_HOUR_TS + 3600))

    # Progress indicator every 100 hours
    if [ $((CONTRACT_IMPORTED % 100)) -eq 0 ]; then
      echo "    Progress: $CONTRACT_IMPORTED hours imported..."
    fi
  done

  # Import this contract's data
  if [ -s "$SQL_FILE" ]; then
    npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1
    echo "    ✓ Imported: $CONTRACT_IMPORTED | Skipped: $CONTRACT_SKIPPED | Errors: $CONTRACT_ERRORS"
  else
    echo "    ✗ No data found"
  fi

  # Cleanup
  rm -f "$SQL_FILE"

  ((TOTAL_IMPORTED += CONTRACT_IMPORTED))
  ((TOTAL_SKIPPED += CONTRACT_SKIPPED))
  ((TOTAL_ERRORS += CONTRACT_ERRORS))

done <<< "$CONTRACTS"

echo ""
echo "=========================================="
echo "Import Summary"
echo "=========================================="
echo "Contracts processed: $CONTRACT_COUNT"
echo "Hours per contract: $TOTAL_HOURS"
echo "Total imported: $TOTAL_IMPORTED"
echo "Total skipped: $TOTAL_SKIPPED"
echo "Total errors: $TOTAL_ERRORS"
echo "Success rate: $(echo "scale=1; $TOTAL_IMPORTED * 100 / ($TOTAL_IMPORTED + $TOTAL_SKIPPED + $TOTAL_ERRORS)" | bc)%"
echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
