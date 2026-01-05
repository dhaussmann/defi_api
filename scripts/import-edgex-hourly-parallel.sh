#!/bin/bash

# EdgeX Parallel Hourly Funding Rate Import
# ==========================================
# Imports funding rates by running multiple contracts in parallel.
# Much faster than sequential processing.
#
# Usage:
#   ./import-edgex-hourly-parallel.sh [START_DATE] [END_DATE] [PARALLEL_JOBS]

# set -e disabled - we handle errors manually

API_BASE="https://pro.edgex.exchange/api/v1/public"
DB_NAME="defiapi-db"
REMOTE="--remote"
EXCHANGE="edgex"

# Parse arguments
START_DATE="${1:-2025-10-01}"
END_DATE="${2:-$(date -u '+%Y-%m-%d')}"
PARALLEL_JOBS="${3:-10}"  # Default: 10 contracts parallel

# Convert to epoch seconds
START_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$START_DATE 00:00:00" "+%s" 2>/dev/null || date -d "$START_DATE 00:00:00" "+%s" 2>/dev/null)
END_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$END_DATE 23:59:59" "+%s" 2>/dev/null || date -d "$END_DATE 23:59:59" "+%s" 2>/dev/null)

# Calculate number of hours
TOTAL_HOURS=$(( (END_TS - START_TS) / 3600 ))

echo "=========================================="
echo "EdgeX Parallel Hourly Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE"
echo "Total hours: $TOTAL_HOURS"
echo "Parallel jobs: $PARALLEL_JOBS"
echo ""

# Get all active contracts
echo "[1/3] Fetching EdgeX contracts..."
METADATA=$(curl -s "$API_BASE/meta/getMetaData")
CONTRACTS=$(echo "$METADATA" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')

CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found $CONTRACT_COUNT active contracts"
echo ""

TOTAL_API_CALLS=$((TOTAL_HOURS * CONTRACT_COUNT))
ESTIMATED_TIME=$((TOTAL_API_CALLS / (10 * PARALLEL_JOBS)))
echo "Expected API calls: ~$TOTAL_API_CALLS"
echo "Estimated time: ~$((ESTIMATED_TIME / 60)) minutes (with $PARALLEL_JOBS parallel jobs)"
echo ""

# Create temporary directory for job results
JOB_DIR=$(mktemp -d)
echo "Job directory: $JOB_DIR"
echo ""

# Function to process a single contract
process_contract() {
  local CONTRACT_ID=$1
  local CONTRACT_NAME=$2
  local START_TS=$3
  local END_TS=$4
  local JOB_DIR=$5

  local SQL_FILE="$JOB_DIR/${CONTRACT_NAME}.sql"
  local LOG_FILE="$JOB_DIR/${CONTRACT_NAME}.log"

  local IMPORTED=0
  local SKIPPED=0
  local ERRORS=0

  # Loop through each hour
  local CURRENT_HOUR_TS=$START_TS
  while [ $CURRENT_HOUR_TS -le $END_TS ]; do
    local HOUR_START_MS=$((CURRENT_HOUR_TS * 1000))
    local HOUR_END_MS=$(((CURRENT_HOUR_TS + 3600) * 1000))

    # Query funding rate for this exact hour
    local RESPONSE=$(curl -s "$API_BASE/funding/getFundingRatePage?contractId=$CONTRACT_ID&size=1&filterBeginTimeInclusive=$HOUR_START_MS&filterEndTimeExclusive=$HOUR_END_MS" 2>/dev/null || echo '{"code":"CURL_ERROR"}')

    # Check if we got data
    local CODE=$(echo "$RESPONSE" | jq -r '.code' 2>/dev/null || echo "PARSE_ERROR")

    if [ "$CODE" != "SUCCESS" ]; then
      ((ERRORS++))
      CURRENT_HOUR_TS=$((CURRENT_HOUR_TS + 3600))
      continue
    fi

    local DATA_COUNT=$(echo "$RESPONSE" | jq '.data.dataList | length' 2>/dev/null || echo "0")

    if [ "$DATA_COUNT" -eq 0 ]; then
      ((SKIPPED++))
      CURRENT_HOUR_TS=$((CURRENT_HOUR_TS + 3600))
      continue
    fi

    # Extract data
    local ORACLE_PRICE=$(echo "$RESPONSE" | jq -r '.data.dataList[0].oraclePrice' 2>/dev/null)
    local INDEX_PRICE=$(echo "$RESPONSE" | jq -r '.data.dataList[0].indexPrice' 2>/dev/null)
    local FUNDING_RATE=$(echo "$RESPONSE" | jq -r '.data.dataList[0].fundingRate' 2>/dev/null)

    # Skip if data is null
    if [ "$ORACLE_PRICE" = "null" ] || [ "$INDEX_PRICE" = "null" ] || [ "$FUNDING_RATE" = "null" ]; then
      ((SKIPPED++))
      CURRENT_HOUR_TS=$((CURRENT_HOUR_TS + 3600))
      continue
    fi

    # Calculate annual funding rate
    # EdgeX has 4-hour intervals = 6 payments per day
    local FUNDING_ANNUAL=$(echo "$FUNDING_RATE * 100 * 6 * 365" | bc -l)

    # Normalize symbol
    local NORMALIZED_SYMBOL=$(echo "$CONTRACT_NAME" | sed 's/USD$//')

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

    ((IMPORTED++))

    CURRENT_HOUR_TS=$((CURRENT_HOUR_TS + 3600))
  done

  # Write summary to log
  echo "$CONTRACT_NAME|$IMPORTED|$SKIPPED|$ERRORS" > "$LOG_FILE"
}

# Export function and variables for parallel execution
export -f process_contract
export API_BASE DB_NAME REMOTE EXCHANGE START_TS END_TS

echo "[2/3] Processing contracts in parallel..."

# Process contracts in parallel using xargs
echo "$CONTRACTS" | xargs -P $PARALLEL_JOBS -I {} bash -c '
  IFS="|" read -r CONTRACT_ID CONTRACT_NAME <<< "{}"
  process_contract "$CONTRACT_ID" "$CONTRACT_NAME" "'"$START_TS"'" "'"$END_TS"'" "'"$JOB_DIR"'"
  echo "  ✓ $CONTRACT_NAME completed"
'

echo ""
echo "[3/3] Importing to database..."

# Import all SQL files
TOTAL_IMPORTED=0
TOTAL_SKIPPED=0
TOTAL_ERRORS=0
TOTAL_FILES=0

for SQL_FILE in "$JOB_DIR"/*.sql; do
  if [ -f "$SQL_FILE" ]; then
    CONTRACT_NAME=$(basename "$SQL_FILE" .sql)

    # Import to database
    npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1

    # Read stats from log file
    LOG_FILE="$JOB_DIR/${CONTRACT_NAME}.log"
    if [ -f "$LOG_FILE" ]; then
      IFS='|' read -r NAME IMPORTED SKIPPED ERRORS < "$LOG_FILE"
      ((TOTAL_IMPORTED += IMPORTED))
      ((TOTAL_SKIPPED += SKIPPED))
      ((TOTAL_ERRORS += ERRORS))
    fi

    ((TOTAL_FILES++))
    echo "  [$TOTAL_FILES/$CONTRACT_COUNT] $CONTRACT_NAME imported"
  fi
done

# Cleanup
rm -rf "$JOB_DIR"

echo ""
echo "=========================================="
echo "Import Summary"
echo "=========================================="
echo "Contracts processed: $CONTRACT_COUNT"
echo "Hours per contract: $TOTAL_HOURS"
echo "Total imported: $TOTAL_IMPORTED"
echo "Total skipped: $TOTAL_SKIPPED"
echo "Total errors: $TOTAL_ERRORS"
if [ $((TOTAL_IMPORTED + TOTAL_SKIPPED + TOTAL_ERRORS)) -gt 0 ]; then
  SUCCESS_RATE=$(echo "scale=1; $TOTAL_IMPORTED * 100 / ($TOTAL_IMPORTED + $TOTAL_SKIPPED + $TOTAL_ERRORS)" | bc)
  echo "Success rate: ${SUCCESS_RATE}%"
fi
echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
