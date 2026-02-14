#!/bin/bash

# Paradex V3 Historical Funding Rate Import
# ==========================================
# Fetches historical funding rates using time windows to avoid pagination limits.
# Adapted from fetch-paradex-jan2026-fast.sh for V3 schema.
#
# Strategy:
# - Fetch markets from /v1/markets
# - Use /v1/funding/data with start_time/end_time parameters
# - Process in 2-day chunks to stay under 100 record limit
# - Import into paradex_funding_v3 table
#
# Usage:
#   ./import-paradex-v3.sh [DAYS_BACK]
#   Default: Last 30 days

set -e

API_BASE="https://api.prod.paradex.trade"
DB_NAME="defiapi-db-write"
REMOTE="--remote"

# V3 Config: Paradex uses 8-hour intervals (480 minutes)
INTERVAL_HOURS=8
CONVERSION_FACTOR=100  # decimal to percent

# Parse arguments - default to last 30 days
DAYS_BACK="${1:-30}"
END_MS=$(date +%s)000
START_MS=$(echo "$END_MS - ($DAYS_BACK * 24 * 60 * 60 * 1000)" | bc)

# Convert to readable dates
START_DATE=$(date -u -r $(echo "$START_MS / 1000" | bc) '+%Y-%m-%d')
END_DATE=$(date -u -r $(echo "$END_MS / 1000" | bc) '+%Y-%m-%d')

echo "=========================================="
echo "Paradex V3 Historical Funding Rate Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE"
echo "Days back: $DAYS_BACK"
echo "Target table: paradex_funding_v3"
echo "Interval: ${INTERVAL_HOURS}h"
echo ""

# Get all PERP markets
echo "[1/4] Fetching Paradex markets..."
MARKETS=$(curl -s "$API_BASE/v1/markets" | jq -r '.results[] | select(.asset_kind == "PERP") | .symbol')
MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')

echo "Found $MARKET_COUNT PERP markets"
echo ""

# Check existing data
echo "[2/4] Checking existing data..."
EXISTING_DATA=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT symbol, COUNT(*) as records
FROM paradex_funding_v3
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

# Generate 2-day time windows (to stay under 100 record limit)
echo "[3/4] Generating time windows..."
WINDOWS=()
CURRENT=$START_MS
TWO_DAYS=$((2 * 24 * 60 * 60 * 1000))

while [ $(echo "$CURRENT < $END_MS" | bc) -eq 1 ]; do
  WINDOW_END=$(echo "$CURRENT + $TWO_DAYS" | bc)
  if [ $(echo "$WINDOW_END > $END_MS" | bc) -eq 1 ]; then
    WINDOW_END=$END_MS
  fi
  WINDOWS+=("$CURRENT:$WINDOW_END")
  CURRENT=$WINDOW_END
done

echo "Using ${#WINDOWS[@]} time windows (2-day chunks)"
echo ""

# Import data
echo "[4/4] Importing funding rates (parallel mode)..."
TEMP_SQL=$(mktemp)
TEMP_DIR=$(mktemp -d)
TOTAL_RECORDS=0
ERRORS=0
COLLECTED_AT=$(date +%s)

# Parallel processing configuration
MAX_PARALLEL=10
BATCH_SIZE=5

# Function to process a single market
process_market() {
  local MARKET="$1"
  local NUM="$2"
  local MARKET_COUNT="$3"
  local OUTPUT_FILE="$4"
  
  local BASE_ASSET="${MARKET%-USD-PERP}"
  local MARKET_TOTAL=0
  
  # Fetch all time windows for this market
  for WINDOW in "${WINDOWS[@]}"; do
    WINDOW_START="${WINDOW%:*}"
    WINDOW_END="${WINDOW#*:}"
    
    RESPONSE=$(curl -s "$API_BASE/v1/funding/data?market=${MARKET}&start_time=${WINDOW_START}&end_time=${WINDOW_END}")
    
    # Check for errors
    if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
      continue
    fi
    
    # Parse results
    COUNT=$(echo "$RESPONSE" | jq -r '.results | length' 2>/dev/null)
    
    if [ "$COUNT" -gt 0 ] 2>/dev/null; then
      # Convert to V3 SQL format
      echo "$RESPONSE" | jq -r --arg symbol "$BASE_ASSET" --arg market "$MARKET" --arg interval "$INTERVAL_HOURS" --arg conv "$CONVERSION_FACTOR" --arg collected "$COLLECTED_AT" '
        .results[] | 
        . as $item |
        ($item.funding_rate | tonumber) as $rate_raw |
        ($rate_raw * ($conv | tonumber)) as $rate_raw_percent |
        ($rate_raw_percent / ($interval | tonumber)) as $rate_1h_percent |
        ($rate_1h_percent * 24 * 365) as $rate_apr |
        "INSERT OR REPLACE INTO paradex_funding_v3 (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source) VALUES (\"\($market)\", \"\($symbol)\", \($item.created_at), \($rate_raw), \($rate_raw_percent), \($interval), \($rate_1h_percent), \($rate_apr), \($collected), \"import\");"
      ' >> "$OUTPUT_FILE"
      
      MARKET_TOTAL=$((MARKET_TOTAL + COUNT))
    fi
  done
  
  # Write result summary
  echo "$MARKET|$MARKET_TOTAL" >> "${TEMP_DIR}/results.txt"
  
  if [ "$MARKET_TOTAL" -gt 0 ]; then
    printf "  [%d/%d] %-20s ✓ %d records\n" "$NUM" "$MARKET_COUNT" "$MARKET" "$MARKET_TOTAL"
  else
    printf "  [%d/%d] %-20s ⚠ No data\n" "$NUM" "$MARKET_COUNT" "$MARKET"
  fi
}

export -f process_market
export API_BASE INTERVAL_HOURS CONVERSION_FACTOR COLLECTED_AT TEMP_DIR
export WINDOWS

# Process markets in parallel batches
NUM=0
ACTIVE_PIDS=()

for MARKET in $MARKETS; do
  NUM=$((NUM + 1))
  OUTPUT_FILE="${TEMP_DIR}/market_${NUM}.sql"
  
  # Start background process
  process_market "$MARKET" "$NUM" "$MARKET_COUNT" "$OUTPUT_FILE" &
  ACTIVE_PIDS+=($!)
  
  # Wait if we've reached max parallel processes
  if [ ${#ACTIVE_PIDS[@]} -ge $MAX_PARALLEL ]; then
    # Wait for the oldest process to finish
    wait ${ACTIVE_PIDS[0]}
    ACTIVE_PIDS=("${ACTIVE_PIDS[@]:1}")
  fi
  
  # Small batch delay every BATCH_SIZE markets
  if [ $((NUM % BATCH_SIZE)) -eq 0 ]; then
    sleep 0.2
  fi
done

# Wait for all remaining processes
echo ""
echo "Waiting for all parallel processes to complete..."
for PID in "${ACTIVE_PIDS[@]}"; do
  wait $PID 2>/dev/null
done

# Combine all SQL files
echo "Combining results..."
cat "${TEMP_DIR}"/market_*.sql > "$TEMP_SQL" 2>/dev/null

# Calculate totals from results
if [ -f "${TEMP_DIR}/results.txt" ]; then
  while IFS='|' read -r MARKET RECORDS; do
    TOTAL_RECORDS=$((TOTAL_RECORDS + RECORDS))
    if [ "$RECORDS" -eq 0 ]; then
      ERRORS=$((ERRORS + 1))
    fi
  done < "${TEMP_DIR}/results.txt"
fi

# Cleanup temp directory
rm -rf "$TEMP_DIR"

echo ""
echo "=========================================="
echo "Import Summary"
echo "=========================================="
echo "Markets processed: $MARKET_COUNT"
echo "Total records fetched: $TOTAL_RECORDS"
echo "Markets without data: $ERRORS"
echo ""

if [ "$TOTAL_RECORDS" -eq 0 ]; then
  echo "❌ No data to import"
  rm "$TEMP_SQL"
  exit 1
fi

echo "Importing to database..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$TEMP_SQL" > /dev/null 2>&1

if [ $? -eq 0 ]; then
  echo "✓ Import complete"
  rm "$TEMP_SQL"
else
  echo "❌ Import failed"
  echo "SQL file saved at: $TEMP_SQL"
  exit 1
fi

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
  FROM paradex_funding_v3
"

echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
