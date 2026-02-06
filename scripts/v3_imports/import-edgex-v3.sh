#!/bin/bash

# EdgeX V3 Historical Funding Rate Import with Hourly Aggregation
# =================================================================
# Imports ALL funding rates and aggregates them hourly for V3 schema.
# Adapted from V2 script for edgex_funding_v3 table.
#
# Strategy:
# - Fetch all funding rates for each contract
# - Group by hour and calculate average
# - Import hourly aggregates into edgex_funding_v3 table
# - Process month by month to keep memory usage low
#
# Usage:
#   ./import-edgex-v3.sh [START_DATE] [END_DATE]
#   Default: Last 30 days

set -e

API_BASE="https://pro.edgex.exchange/api/v1/public"
DB_NAME="defiapi-db-write"
REMOTE="--remote"
PAGE_SIZE=1000
EXCHANGE="edgex"

# V3 Config: EdgeX uses 4-hour intervals (240 minutes)
INTERVAL_HOURS=4
CONVERSION_FACTOR=100  # decimal to percent

# Parse arguments - default to last 30 days
if [ -z "$1" ]; then
  START_DATE=$(date -u -v-30d '+%Y-%m-%d' 2>/dev/null || date -u -d '30 days ago' '+%Y-%m-%d' 2>/dev/null)
else
  START_DATE="$1"
fi
END_DATE="${2:-$(date -u '+%Y-%m-%d')}"

echo "=========================================="
echo "EdgeX V3 Historical Funding Rate Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE"
echo "Target table: edgex_funding_v3"
echo "Strategy: All funding rates + hourly aggregation"
echo "Interval: ${INTERVAL_HOURS}h"
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
FROM edgex_funding_v3
WHERE source = 'import'
GROUP BY symbol
" --json 2>/dev/null | jq -r '.[] | .results[]? | "\(.symbol):\(.records)"' || echo "")

echo "Existing imported data in database:"
if [ -n "$EXISTING_DATA" ]; then
  echo "$EXISTING_DATA" | head -5
  EXISTING_COUNT=$(echo "$EXISTING_DATA" | wc -l | tr -d ' ')
  if [ $EXISTING_COUNT -gt 5 ]; then
    echo "... and $((EXISTING_COUNT - 5)) more symbols"
  fi
else
  echo "  No imported data found"
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
echo "[4/4] Importing funding rates (parallel mode)..."
TEMP_DIR=$(mktemp -d)
TOTAL_IMPORTED=0
COLLECTED_AT=$(date +%s)

# Sequential processing to avoid Cloudflare blocking
MAX_PARALLEL=1
BATCH_SIZE=1

# Function to process a single contract
process_contract() {
  local CONTRACT_ID="$1"
  local CONTRACT_NAME="$2"
  local NUM="$3"
  local CONTRACT_COUNT="$4"
  local OUTPUT_FILE="$5"
  
  local BASE_ASSET=$(echo "$CONTRACT_NAME" | sed 's/USD$//')
  local CONTRACT_TOTAL=0
  
  # Reconstruct MONTHS array from exported string
  IFS=' ' read -ra MONTHS <<< "$MONTHS_STR"
  
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

      RESPONSE=$(curl -s -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "$API_URL")
      
      # Small delay between API calls to avoid rate limiting
      sleep 0.5
      
      # Check if response is valid JSON
      if ! echo "$RESPONSE" | jq empty 2>/dev/null; then
        break
      fi
      
      CODE=$(echo "$RESPONSE" | jq -r '.code // empty' 2>/dev/null)

      if [ "$CODE" != "SUCCESS" ]; then
        break
      fi

      DATA_COUNT=$(echo "$RESPONSE" | jq '.data.dataList | length // 0' 2>/dev/null)
      if [ -z "$DATA_COUNT" ] || [ "$DATA_COUNT" -eq 0 ]; then
        break
      fi

      # Extract funding rate data (ALL records)
      echo "$RESPONSE" | jq -r '.data.dataList[]? | "\(.fundingTimestamp)|\(.fundingRate)"' 2>/dev/null >> "$TEMP_RAW"

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
      funding_rate = $2

      sum_funding[hour_ts] += funding_rate
      rec_count[hour_ts]++
    }
    END {
      for (hour in rec_count) {
        avg_funding = sum_funding[hour] / rec_count[hour]
        print hour "|" avg_funding "|" rec_count[hour]
      }
    }
    ' "$TEMP_RAW" | sort -n > "$TEMP_AGG"

    AGG_COUNT=$(wc -l < "$TEMP_AGG" | tr -d ' ')

    if [ "$AGG_COUNT" -eq 0 ]; then
      rm -f "$TEMP_RAW" "$TEMP_AGG"
      continue
    fi

    # Generate SQL for V3 schema
    while IFS='|' read -r HOUR_TS AVG_FUNDING SAMPLE_COUNT; do
      # V3 calculations
      RATE_RAW="$AVG_FUNDING"
      RATE_RAW_PERCENT=$(echo "$AVG_FUNDING * $CONVERSION_FACTOR" | bc -l)
      RATE_1H_PERCENT=$(echo "$RATE_RAW_PERCENT / $INTERVAL_HOURS" | bc -l)
      RATE_APR=$(echo "$RATE_1H_PERCENT * 24 * 365" | bc -l)

      cat >> "$OUTPUT_FILE" <<EOF
INSERT OR REPLACE INTO edgex_funding_v3 (
  symbol, base_asset, funding_time, 
  rate_raw, rate_raw_percent, interval_hours, 
  rate_1h_percent, rate_apr, 
  collected_at, source
) VALUES (
  '$CONTRACT_NAME', '$BASE_ASSET', $HOUR_TS,
  $RATE_RAW, $RATE_RAW_PERCENT, $INTERVAL_HOURS,
  $RATE_1H_PERCENT, $RATE_APR,
  $COLLECTED_AT, 'import'
);
EOF
      CONTRACT_TOTAL=$((CONTRACT_TOTAL + 1))
    done < "$TEMP_AGG"

    # Cleanup
    rm -f "$TEMP_RAW" "$TEMP_AGG"
  done
  
  # Write result summary
  echo "$CONTRACT_NAME|$CONTRACT_TOTAL" >> "${TEMP_DIR}/results.txt"
  
  printf "  [%d/%d] %-20s ✓ %d hours\n" "$NUM" "$CONTRACT_COUNT" "$CONTRACT_NAME" "$CONTRACT_TOTAL"
}

export -f process_contract
export API_BASE PAGE_SIZE INTERVAL_HOURS CONVERSION_FACTOR COLLECTED_AT TEMP_DIR DB_NAME REMOTE END_DATE
export MONTH_COUNT

# Export MONTHS array as space-separated string
MONTHS_STR="${MONTHS[*]}"
export MONTHS_STR

# Process contracts in parallel batches
NUM=0
ACTIVE_PIDS=()

while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  NUM=$((NUM + 1))
  OUTPUT_FILE="${TEMP_DIR}/contract_${NUM}.sql"
  
  # Start background process
  process_contract "$CONTRACT_ID" "$CONTRACT_NAME" "$NUM" "$CONTRACT_COUNT" "$OUTPUT_FILE" &
  ACTIVE_PIDS+=($!)
  
  # Wait if we've reached max parallel processes
  if [ ${#ACTIVE_PIDS[@]} -ge $MAX_PARALLEL ]; then
    # Wait for the oldest process to finish
    wait ${ACTIVE_PIDS[0]}
    ACTIVE_PIDS=("${ACTIVE_PIDS[@]:1}")
  fi
  
  # Long delay between contracts to avoid Cloudflare blocking
  sleep 3
done <<< "$CONTRACTS"

# Wait for all remaining processes
echo ""
echo "Waiting for all parallel processes to complete..."
for PID in "${ACTIVE_PIDS[@]}"; do
  wait $PID 2>/dev/null
done

# Import all SQL files in batches to avoid D1 limits
echo "Importing to database in batches..."
BATCH_NUM=0
BATCH_FILES=()

for SQL_FILE in "${TEMP_DIR}"/contract_*.sql; do
  if [ -f "$SQL_FILE" ]; then
    BATCH_FILES+=("$SQL_FILE")
    
    # Import in batches of 10 contracts
    if [ ${#BATCH_FILES[@]} -ge 10 ]; then
      BATCH_NUM=$((BATCH_NUM + 1))
      COMBINED_BATCH=$(mktemp)
      cat "${BATCH_FILES[@]}" > "$COMBINED_BATCH"
      
      echo "  Importing batch $BATCH_NUM (${#BATCH_FILES[@]} contracts)..."
      npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$COMBINED_BATCH" > /dev/null 2>&1
      
      rm "$COMBINED_BATCH"
      BATCH_FILES=()
    fi
  fi
done

# Import remaining files
if [ ${#BATCH_FILES[@]} -gt 0 ]; then
  BATCH_NUM=$((BATCH_NUM + 1))
  COMBINED_BATCH=$(mktemp)
  cat "${BATCH_FILES[@]}" > "$COMBINED_BATCH"
  
  echo "  Importing final batch (${#BATCH_FILES[@]} contracts)..."
  npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$COMBINED_BATCH" > /dev/null 2>&1
  
  rm "$COMBINED_BATCH"
fi

# Calculate totals from results
if [ -f "${TEMP_DIR}/results.txt" ]; then
  while IFS='|' read -r CONTRACT HOURS; do
    TOTAL_IMPORTED=$((TOTAL_IMPORTED + HOURS))
  done < "${TEMP_DIR}/results.txt"
fi

# Cleanup temp directory
rm -rf "$TEMP_DIR"

echo ""
echo "=========================================="
echo "Import Summary"
echo "=========================================="
echo "Contracts processed: $CONTRACT_COUNT"
echo "Months processed: $MONTH_COUNT"
echo "Total hours imported: $TOTAL_IMPORTED"
echo "Date range: $START_DATE to $END_DATE"
echo ""

# Verify imported data
echo "Verifying imported data..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --command="
  SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT symbol) as markets,
    MIN(datetime(funding_time, 'unixepoch')) as earliest,
    MAX(datetime(funding_time, 'unixepoch')) as latest,
    SUM(CASE WHEN source = 'import' THEN 1 ELSE 0 END) as imported_records
  FROM edgex_funding_v3
"

echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
