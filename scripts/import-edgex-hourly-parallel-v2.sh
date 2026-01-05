#!/bin/bash

# EdgeX Parallel Hourly Import v2
# ================================
# Uses background jobs instead of xargs for better reliability

API_BASE="https://pro.edgex.exchange/api/v1/public"
DB_NAME="defiapi-db"
REMOTE="--remote"
EXCHANGE="edgex"

# Parse arguments
START_DATE="${1:-2025-10-01}"
END_DATE="${2:-$(date -u '+%Y-%m-%d')}"
MAX_PARALLEL="${3:-10}"

# Convert to epoch
START_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$START_DATE 00:00:00" "+%s" 2>/dev/null || date -d "$START_DATE 00:00:00" "+%s" 2>/dev/null)
END_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$END_DATE 23:59:59" "+%s" 2>/dev/null || date -d "$END_DATE 23:59:59" "+%s" 2>/dev/null)

TOTAL_HOURS=$(( (END_TS - START_TS) / 3600 ))

echo "=========================================="
echo "EdgeX Parallel Import v2"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE"
echo "Hours: $TOTAL_HOURS"
echo "Max parallel: $MAX_PARALLEL"
echo ""

# Get contracts
echo "[1/3] Fetching contracts..."
CONTRACTS=$(curl -s "$API_BASE/meta/getMetaData" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')
CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found: $CONTRACT_COUNT contracts"
echo ""

# Create work directory
WORK_DIR=$(mktemp -d)
echo "Work dir: $WORK_DIR"
echo ""

# Function to process one contract
process_contract() {
  local CONTRACT_ID=$1
  local CONTRACT_NAME=$2

  local SQL_FILE="$WORK_DIR/${CONTRACT_NAME}.sql"
  local STATS_FILE="$WORK_DIR/${CONTRACT_NAME}.stats"

  local IMPORTED=0
  local ERRORS=0

  local HOUR_TS=$START_TS
  while [ $HOUR_TS -le $END_TS ]; do
    local HMS=$((HOUR_TS * 1000))
    local HME=$(((HOUR_TS + 3600) * 1000))

    local RESP=$(curl -s \
      -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
      -H "Accept: application/json" \
      -H "Accept-Language: en-US,en;q=0.9" \
      "$API_BASE/funding/getFundingRatePage?contractId=$CONTRACT_ID&size=1&filterBeginTimeInclusive=$HMS&filterEndTimeExclusive=$HME" 2>/dev/null)

    # Small delay to avoid rate limiting
    sleep 0.1

    if [ -z "$RESP" ]; then
      ((ERRORS++))
      HOUR_TS=$((HOUR_TS + 3600))
      continue
    fi

    local COUNT=$(echo "$RESP" | jq '.data.dataList | length' 2>/dev/null || echo "0")

    if [ "$COUNT" -eq 0 ]; then
      HOUR_TS=$((HOUR_TS + 3600))
      continue
    fi

    local ORACLE=$(echo "$RESP" | jq -r '.data.dataList[0].oraclePrice' 2>/dev/null)
    local INDEX=$(echo "$RESP" | jq -r '.data.dataList[0].indexPrice' 2>/dev/null)
    local FUNDING=$(echo "$RESP" | jq -r '.data.dataList[0].fundingRate' 2>/dev/null)

    if [ "$ORACLE" = "null" ]; then
      HOUR_TS=$((HOUR_TS + 3600))
      continue
    fi

    # EdgeX has 4-hour intervals = 6 payments per day
    local ANNUAL=$(echo "$FUNDING * 100 * 6 * 365" | bc -l)
    local NORM=$(echo "$CONTRACT_NAME" | sed 's/USD$//')

    cat >> "$SQL_FILE" <<EOF
INSERT INTO market_history (exchange, symbol, normalized_symbol, hour_timestamp, avg_mark_price, avg_index_price, avg_funding_rate, avg_funding_rate_annual, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, min_funding_rate, max_funding_rate, sample_count, aggregated_at) VALUES ('$EXCHANGE', '$CONTRACT_NAME', '$NORM', $HOUR_TS, $ORACLE, $INDEX, $FUNDING, $ANNUAL, $ORACLE, $ORACLE, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, $FUNDING, $FUNDING, 1, unixepoch('now')) ON CONFLICT(exchange, symbol, hour_timestamp) DO UPDATE SET avg_mark_price = COALESCE(avg_mark_price, $ORACLE);
EOF

    ((IMPORTED++))
    HOUR_TS=$((HOUR_TS + 3600))
  done

  echo "$IMPORTED|$ERRORS" > "$STATS_FILE"
}

echo "[2/3] Processing contracts..."

# Process contracts in batches
CURRENT_BATCH=0
TOTAL_PROCESSED=0

while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  ((TOTAL_PROCESSED++))

  # Start background job
  process_contract "$CONTRACT_ID" "$CONTRACT_NAME" &

  ((CURRENT_BATCH++))

  # Wait when batch is full
  if [ $CURRENT_BATCH -ge $MAX_PARALLEL ]; then
    wait
    echo "  Batch completed ($TOTAL_PROCESSED/$CONTRACT_COUNT)"
    CURRENT_BATCH=0
  fi
done <<< "$CONTRACTS"

# Wait for remaining jobs
wait
echo "  All contracts processed ($TOTAL_PROCESSED/$CONTRACT_COUNT)"
echo ""

echo "[3/3] Importing to database..."

TOTAL_IMPORTED=0
TOTAL_ERRORS=0
IMPORTED_COUNT=0

for SQL_FILE in "$WORK_DIR"/*.sql; do
  [ -f "$SQL_FILE" ] || continue

  NAME=$(basename "$SQL_FILE" .sql)
  STATS_FILE="$WORK_DIR/${NAME}.stats"

  if [ -s "$SQL_FILE" ]; then
    npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1
    ((IMPORTED_COUNT++))

    if [ -f "$STATS_FILE" ]; then
      IFS='|' read -r IMP ERR < "$STATS_FILE"
      ((TOTAL_IMPORTED += IMP))
      ((TOTAL_ERRORS += ERR))
    fi

    echo "  [$IMPORTED_COUNT] $NAME"
  fi
done

rm -rf "$WORK_DIR"

echo ""
echo "=========================================="
echo "Summary"
echo "=========================================="
echo "Contracts: $CONTRACT_COUNT"
echo "Imported: $TOTAL_IMPORTED records"
echo "Errors: $TOTAL_ERRORS"
echo "Completed: $(date -u '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
