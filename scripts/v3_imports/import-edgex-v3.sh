#!/bin/bash

# EdgeX V3 Historical Funding Rate Import
# ========================================
# Fetches historical settlement funding rates using pagination.
# Based on Paradex V3 import script pattern.
#
# Strategy:
# - Fetch active contracts from /meta/getMetaData
# - Use /funding/getFundingRatePage with filterSettlementFundingRate=true
#   to get only 4h settlement rates (not per-minute predictions)
# - Paginate with offsetData (max 100 per page)
# - Import into edgex_funding_v3 table
#
# API Docs: https://edgex-1.gitbook.io/edgex-documentation/api/public-api/funding-api
#
# Usage:
#   ./import-edgex-v3.sh [DAYS_BACK]
#   Default: Last 30 days

set -e

API_BASE="https://pro.edgex.exchange/api/v1/public"
DB_NAME="defiapi-db-write"
REMOTE="--remote"
PAGE_SIZE=100  # API max is 100

# V3 Config: EdgeX uses 4-hour intervals (240 minutes)
INTERVAL_HOURS=4
CONVERSION_FACTOR=100  # decimal to percent

# Parse arguments - default to last 30 days
DAYS_BACK="${1:-30}"
END_TS=$(date +%s)
START_TS=$((END_TS - DAYS_BACK * 86400))
START_MS="${START_TS}000"
END_MS="${END_TS}000"

START_DATE=$(date -u -r $START_TS '+%Y-%m-%d' 2>/dev/null || date -u -d @$START_TS '+%Y-%m-%d')
END_DATE=$(date -u -r $END_TS '+%Y-%m-%d' 2>/dev/null || date -u -d @$END_TS '+%Y-%m-%d')

echo "=========================================="
echo "EdgeX V3 Historical Funding Rate Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE ($DAYS_BACK days)"
echo "Target table: edgex_funding_v3"
echo "Strategy: Settlement rates only (every 4h)"
echo "Page size: $PAGE_SIZE"
echo ""

# Get all active contracts
echo "[1/3] Fetching EdgeX contracts..."
METADATA=$(curl -s "$API_BASE/meta/getMetaData")
CONTRACTS=$(echo "$METADATA" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')

CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found $CONTRACT_COUNT active contracts"
echo ""

# Check existing data
echo "[2/3] Checking existing data..."
EXISTING_DATA=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
SELECT symbol, COUNT(*) as records, 
  MIN(datetime(funding_time, 'unixepoch')) as earliest,
  MAX(datetime(funding_time, 'unixepoch')) as latest
FROM edgex_funding_v3
WHERE source = 'import'
GROUP BY symbol
ORDER BY records DESC
LIMIT 5
" 2>&1 | tail -20 || echo "")

echo "$EXISTING_DATA"
echo ""

# Import data
echo "[3/3] Importing settlement funding rates..."
TEMP_DIR=$(mktemp -d)
TOTAL_RECORDS=0
ERRORS=0
COLLECTED_AT=$(date +%s)

# Process each contract sequentially
NUM=0
while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  NUM=$((NUM + 1))
  BASE_ASSET=$(echo "$CONTRACT_NAME" | sed 's/USD$//')
  OUTPUT_FILE="${TEMP_DIR}/contract_${NUM}.sql"
  CONTRACT_RECORDS=0
  
  # Paginate through all settlement funding rates
  OFFSET_DATA=""
  PAGE=0
  MAX_PAGES=500  # 500 pages * 100 = 50k records max per contract
  
  while [ $PAGE -lt $MAX_PAGES ]; do
    # Build API URL
    API_URL="$API_BASE/funding/getFundingRatePage?contractId=$CONTRACT_ID&size=$PAGE_SIZE"
    API_URL="$API_URL&filterSettlementFundingRate=true"
    API_URL="$API_URL&filterBeginTimeInclusive=$START_MS&filterEndTimeExclusive=$END_MS"
    
    if [ -n "$OFFSET_DATA" ]; then
      API_URL="$API_URL&offsetData=$OFFSET_DATA"
    fi
    
    RESPONSE=$(curl -s "$API_URL")
    
    # Validate response
    if ! echo "$RESPONSE" | jq empty 2>/dev/null; then
      echo "    Invalid JSON response, skipping..."
      break
    fi
    
    CODE=$(echo "$RESPONSE" | jq -r '.code // empty')
    if [ "$CODE" != "SUCCESS" ]; then
      break
    fi
    
    DATA_COUNT=$(echo "$RESPONSE" | jq '.data.dataList | length' 2>/dev/null)
    if [ -z "$DATA_COUNT" ] || [ "$DATA_COUNT" -eq 0 ]; then
      break
    fi
    
    # Generate SQL from settlement rates
    # fundingTimestamp = when rate was calculated (ms)
    # fundingRate = decimal rate for 4h interval
    echo "$RESPONSE" | jq -r --arg sym "$CONTRACT_NAME" --arg base "$BASE_ASSET" \
      --arg interval "$INTERVAL_HOURS" --arg conv "$CONVERSION_FACTOR" \
      --arg collected "$COLLECTED_AT" '
      .data.dataList[] |
      (.fundingRate | tonumber) as $rate_raw |
      ($rate_raw * ($conv | tonumber)) as $rate_pct |
      ($rate_pct / ($interval | tonumber)) as $rate_1h |
      ($rate_pct * (365 * 24 / ($interval | tonumber))) as $rate_apr |
      (.fundingTimestamp | tonumber / 1000 | floor) as $ts |
      "INSERT OR REPLACE INTO edgex_funding_v3 (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source) VALUES (\"\($sym)\", \"\($base)\", \($ts), \($rate_raw), \($rate_pct), \($interval), \($rate_1h), \($rate_apr), \($collected), \"import\");"' >> "$OUTPUT_FILE"
    
    CONTRACT_RECORDS=$((CONTRACT_RECORDS + DATA_COUNT))
    
    # Get next page offset
    OFFSET_DATA=$(echo "$RESPONSE" | jq -r '.data.nextPageOffsetData // empty')
    if [ -z "$OFFSET_DATA" ]; then
      break
    fi
    
    PAGE=$((PAGE + 1))
    
    # Rate limit protection
    sleep 0.3
  done
  
  # Log progress
  if [ "$CONTRACT_RECORDS" -gt 0 ]; then
    printf "  [%d/%d] %-20s %d records\n" "$NUM" "$CONTRACT_COUNT" "$CONTRACT_NAME" "$CONTRACT_RECORDS"
    TOTAL_RECORDS=$((TOTAL_RECORDS + CONTRACT_RECORDS))
  else
    printf "  [%d/%d] %-20s no data\n" "$NUM" "$CONTRACT_COUNT" "$CONTRACT_NAME"
    ERRORS=$((ERRORS + 1))
  fi
  
  # Delay between contracts to avoid 429
  sleep 0.5
  
done <<< "$CONTRACTS"

echo ""
echo "=========================================="
echo "Fetch Summary"
echo "=========================================="
echo "Contracts processed: $CONTRACT_COUNT"
echo "Total records fetched: $TOTAL_RECORDS"
echo "Contracts without data: $ERRORS"
echo ""

if [ "$TOTAL_RECORDS" -eq 0 ]; then
  echo "No data to import"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Import SQL files in batches to avoid D1 limits
echo "Importing to database..."
BATCH_NUM=0
BATCH_FILES=()

for SQL_FILE in "${TEMP_DIR}"/contract_*.sql; do
  if [ -f "$SQL_FILE" ] && [ -s "$SQL_FILE" ]; then
    BATCH_FILES+=("$SQL_FILE")
    
    # Import in batches of 10 contracts
    if [ ${#BATCH_FILES[@]} -ge 10 ]; then
      BATCH_NUM=$((BATCH_NUM + 1))
      COMBINED=$(mktemp)
      cat "${BATCH_FILES[@]}" > "$COMBINED"
      LINE_COUNT=$(wc -l < "$COMBINED" | tr -d ' ')
      
      echo "  Batch $BATCH_NUM: ${#BATCH_FILES[@]} contracts, $LINE_COUNT statements"
      npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$COMBINED" > /dev/null 2>&1
      
      rm "$COMBINED"
      BATCH_FILES=()
    fi
  fi
done

# Import remaining
if [ ${#BATCH_FILES[@]} -gt 0 ]; then
  BATCH_NUM=$((BATCH_NUM + 1))
  COMBINED=$(mktemp)
  cat "${BATCH_FILES[@]}" > "$COMBINED"
  LINE_COUNT=$(wc -l < "$COMBINED" | tr -d ' ')
  
  echo "  Batch $BATCH_NUM (final): ${#BATCH_FILES[@]} contracts, $LINE_COUNT statements"
  npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$COMBINED" > /dev/null 2>&1
  
  rm "$COMBINED"
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo ""

# Verify imported data
echo "Verifying imported data..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --command="
  SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT symbol) as symbols,
    MIN(datetime(funding_time, 'unixepoch')) as earliest,
    MAX(datetime(funding_time, 'unixepoch')) as latest,
    SUM(CASE WHEN source = 'import' THEN 1 ELSE 0 END) as imported,
    SUM(CASE WHEN source = 'api' THEN 1 ELSE 0 END) as from_api
  FROM edgex_funding_v3
"

echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
