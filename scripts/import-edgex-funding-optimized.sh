#!/bin/bash

# EdgeX Optimized Funding Rate Import Script
# ===========================================
# This script imports only settlement funding rates (typically every 4-8 hours)
# instead of all minute-by-minute data, making it 100x faster.
#
# Usage:
#   ./import-edgex-funding-optimized.sh [START_DATE] [END_DATE]
#
# Examples:
#   ./import-edgex-funding-optimized.sh                    # Import all available history
#   ./import-edgex-funding-optimized.sh 2025-01-01         # Import from specific date
#   ./import-edgex-funding-optimized.sh 2025-01-01 2025-12-31  # Import date range

set -e

# Configuration
API_BASE="https://pro.edgex.exchange/api/v1/public"
DB_NAME="defiapi-db"
REMOTE="--remote"
PAGE_SIZE=1000  # Larger page size since we filter for settlements
EXCHANGE="edgex"

# Parse arguments
START_DATE="${1:-2025-01-01}"
END_DATE="${2:-$(date -u '+%Y-%m-%d')}"

# Convert dates to milliseconds timestamp
START_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$START_DATE 00:00:00" "+%s" 2>/dev/null || date -d "$START_DATE 00:00:00" "+%s" 2>/dev/null)000
END_TS=$(date -u -j -f "%Y-%m-%d %H:%M:%S" "$END_DATE 23:59:59" "+%s" 2>/dev/null || date -d "$END_DATE 23:59:59" "+%s" 2>/dev/null)999

echo "=========================================="
echo "EdgeX Optimized Funding Rate Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE"
echo "Timestamp range: $START_TS to $END_TS"
echo "Strategy: Settlement records only"
echo ""

# Step 1: Get all active contracts
echo "[1/5] Fetching EdgeX contracts..."
METADATA=$(curl -s "$API_BASE/meta/getMetaData")
CONTRACTS=$(echo "$METADATA" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')

CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found $CONTRACT_COUNT active contracts"
echo ""

# Step 2: Analyze settlement intervals for first contract (to estimate total)
echo "[2/5] Analyzing settlement patterns..."
FIRST_CONTRACT_ID=$(echo "$CONTRACTS" | head -1 | cut -d'|' -f1)
SAMPLE_DATA=$(curl -s "$API_BASE/funding/getFundingRatePage?contractId=$FIRST_CONTRACT_ID&size=1000")
TOTAL_IN_SAMPLE=$(echo "$SAMPLE_DATA" | jq '.data.dataList | length')
SETTLEMENTS_IN_SAMPLE=$(echo "$SAMPLE_DATA" | jq '.data.dataList | map(select(.isSettlement == true)) | length')

if [ "$SETTLEMENTS_IN_SAMPLE" -gt 0 ]; then
  SETTLEMENT_RATIO=$(echo "scale=4; $SETTLEMENTS_IN_SAMPLE / $TOTAL_IN_SAMPLE" | bc)
  echo "  Settlement ratio: $SETTLEMENTS_IN_SAMPLE/$TOTAL_IN_SAMPLE (~$(echo "$SETTLEMENT_RATIO * 100" | bc)%)"
  echo "  Estimated speedup: $(echo "scale=0; 1 / $SETTLEMENT_RATIO" | bc)x faster"
else
  echo "  Warning: No settlements found in sample, using all data"
  SETTLEMENT_RATIO=1
fi
echo ""

# Step 3: Create temporary import file
TEMP_FILE=$(mktemp)
trap "rm -f $TEMP_FILE" EXIT

echo "[3/5] Collecting settlement funding rates..."
CURRENT_CONTRACT=0
TOTAL_RECORDS=0

while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  ((CURRENT_CONTRACT++))
  echo "  [$CURRENT_CONTRACT/$CONTRACT_COUNT] Processing $CONTRACT_NAME (ID: $CONTRACT_ID)..."

  # Fetch funding rate history with pagination
  OFFSET_DATA=""
  PAGE=1
  CONTRACT_RECORDS=0

  while true; do
    # Build API URL
    API_URL="$API_BASE/funding/getFundingRatePage?contractId=$CONTRACT_ID&size=$PAGE_SIZE"
    API_URL="$API_URL&filterBeginTimeInclusive=$START_TS&filterEndTimeExclusive=$END_TS"

    if [ -n "$OFFSET_DATA" ]; then
      API_URL="$API_URL&offsetData=$OFFSET_DATA"
    fi

    # Fetch page
    RESPONSE=$(curl -s "$API_URL")

    # Check for errors
    CODE=$(echo "$RESPONSE" | jq -r '.code')
    if [ "$CODE" != "SUCCESS" ]; then
      echo "    Warning: API error for $CONTRACT_NAME: $CODE"
      break
    fi

    # Extract ONLY settlement records
    DATA_LIST=$(echo "$RESPONSE" | jq -r '.data.dataList[] | select(.isSettlement == true) | @json')

    if [ -z "$DATA_LIST" ]; then
      # Check if we got any data at all
      TOTAL_IN_PAGE=$(echo "$RESPONSE" | jq '.data.dataList | length')
      if [ "$TOTAL_IN_PAGE" -eq 0 ]; then
        break
      fi
      # If we got data but no settlements, continue to next page
      OFFSET_DATA=$(echo "$RESPONSE" | jq -r '.data.nextPageOffsetData // empty')
      if [ -z "$OFFSET_DATA" ]; then
        break
      fi
      ((PAGE++))
      continue
    fi

    # Process each settlement funding rate record
    while IFS= read -r record; do
      # Extract fields
      FUNDING_TS=$(echo "$record" | jq -r '.fundingTimestamp')
      ORACLE_PRICE=$(echo "$record" | jq -r '.oraclePrice')
      INDEX_PRICE=$(echo "$record" | jq -r '.indexPrice')
      FUNDING_RATE=$(echo "$record" | jq -r '.fundingRate')

      # Convert timestamp to Unix epoch (seconds)
      EPOCH_TS=$((FUNDING_TS / 1000))

      # Round to nearest hour (for consistency with other data)
      HOUR_TS=$((EPOCH_TS - (EPOCH_TS % 3600)))

      # Write to temp file (CSV format)
      echo "$CONTRACT_NAME|$HOUR_TS|$ORACLE_PRICE|$INDEX_PRICE|$FUNDING_RATE" >> "$TEMP_FILE"
      ((CONTRACT_RECORDS++))
      ((TOTAL_RECORDS++))
    done <<< "$DATA_LIST"

    # Check for next page
    OFFSET_DATA=$(echo "$RESPONSE" | jq -r '.data.nextPageOffsetData // empty')

    if [ -z "$OFFSET_DATA" ]; then
      break
    fi

    ((PAGE++))

    # Progress indicator for large datasets
    if [ $((PAGE % 10)) -eq 0 ]; then
      echo "    Page $PAGE... ($CONTRACT_RECORDS records so far)"
    fi
  done

  echo "    Collected $CONTRACT_RECORDS settlement records"
done <<< "$CONTRACTS"

echo ""
echo "Total settlement records collected: $TOTAL_RECORDS"
echo ""

# Step 4: Import into database
echo "[4/5] Importing into database..."

# Create SQL insert statements
SQL_FILE=$(mktemp)
trap "rm -f $TEMP_FILE $SQL_FILE" EXIT

# D1 doesn't support BEGIN TRANSACTION in SQL files
> "$SQL_FILE"

IMPORT_COUNT=0

while IFS='|' read -r SYMBOL HOUR_TS ORACLE_PRICE INDEX_PRICE FUNDING_RATE; do
  # Normalize symbol (remove USD suffix if present)
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

  # Progress indicator
  if [ $((IMPORT_COUNT % 1000)) -eq 0 ]; then
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
echo "Settlement records imported: $IMPORT_COUNT"
echo "Date range: $START_DATE to $END_DATE"
echo "Efficiency: $(echo "scale=1; $IMPORT_COUNT / $CONTRACT_COUNT" | bc) records/contract (vs ~520k in old script)"
echo ""

# Step 5: Verify import
echo "[5/5] Verification:"
START_TS_SEC=$((START_TS / 1000))
END_TS_SEC=$((END_TS / 1000))

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
