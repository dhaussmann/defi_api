#!/bin/bash

# Ethereal V3 Historical Funding Rate Import
# ============================================
# Fetches historical funding rates from Ethereal API.
# Based on Paradex V3 import script pattern.
#
# Strategy:
# - Fetch active products via GET /v1/product?orderBy=createdAt
# - Use GET /v1/funding?productId={uuid}&range=MONTH&limit=200&orderBy=createdAt for history
# - Paginate with cursor parameter
# - Import into ethereal_funding_v3 table
#
# Usage:
#   ./import-ethereal-v3.sh
#   (fetches 1 month of data per product, API only supports range=MONTH)

set -e

API_URL="https://api.ethereal.trade"
DB_NAME="defiapi-db-write"
REMOTE="--remote"

# V3 Config: Ethereal uses 1-hour intervals, fundingRate1h is decimal
INTERVAL_HOURS=1
CONVERSION_FACTOR=100  # decimal to percent

COLLECTED_AT=$(date +%s)

echo "=========================================="
echo "Ethereal V3 Historical Funding Rate Import"
echo "=========================================="
echo "Target table: ethereal_funding_v3"
echo "API: $API_URL"
echo "Interval: ${INTERVAL_HOURS}h"
echo ""

# Get all active products (need id + ticker + baseTokenName)
echo "[1/3] Fetching Ethereal products..."
PRODUCTS_JSON=$(curl -s "$API_URL/v1/product?orderBy=createdAt")

# Extract active products: id, ticker, baseTokenName
PRODUCT_COUNT=$(echo "$PRODUCTS_JSON" | jq '[.data[] | select(.status == "ACTIVE")] | length')
echo "Found $PRODUCT_COUNT active products"
echo ""

if [ "$PRODUCT_COUNT" -eq 0 ]; then
  echo "Error: No active products found"
  exit 1
fi

# Check existing data
echo "[2/3] Checking existing data..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --command="SELECT COUNT(*) as total, COUNT(DISTINCT symbol) as symbols, MIN(datetime(funding_time, 'unixepoch')) as earliest, MAX(datetime(funding_time, 'unixepoch')) as latest FROM ethereal_funding_v3 WHERE source = 'import'" 2>&1 | tail -15
echo ""

# Import data
echo "[3/3] Importing funding rates..."
TEMP_DIR=$(mktemp -d)
TOTAL_RECORDS=0
ERRORS=0

NUM=0
echo "$PRODUCTS_JSON" | jq -c '.data[] | select(.status == "ACTIVE") | {id: .id, ticker: .ticker, base: .baseTokenName}' | while read -r PRODUCT; do
  NUM=$((NUM + 1))
  PRODUCT_ID=$(echo "$PRODUCT" | jq -r '.id')
  TICKER=$(echo "$PRODUCT" | jq -r '.ticker')
  BASE_ASSET=$(echo "$PRODUCT" | jq -r '.base')
  OUTPUT_FILE="${TEMP_DIR}/market_${NUM}.sql"
  PRODUCT_RECORDS=0
  CURSOR=""

  # Paginate through funding history
  while true; do
    if [ -z "$CURSOR" ]; then
      URL="$API_URL/v1/funding?limit=200&productId=${PRODUCT_ID}&range=MONTH&orderBy=createdAt"
    else
      URL="$API_URL/v1/funding?limit=200&productId=${PRODUCT_ID}&range=MONTH&orderBy=createdAt&cursor=${CURSOR}"
    fi

    RESPONSE=$(curl -s "$URL")

    # Validate response
    if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "null" ]; then
      break
    fi

    if ! echo "$RESPONSE" | jq -e '.data' > /dev/null 2>&1; then
      break
    fi

    PAGE_COUNT=$(echo "$RESPONSE" | jq '.data | length' 2>/dev/null)
    if [ -z "$PAGE_COUNT" ] || [ "$PAGE_COUNT" -eq 0 ]; then
      break
    fi

    # Generate SQL
    echo "$RESPONSE" | jq -r --arg sym "$TICKER" --arg base "$BASE_ASSET" \
      --arg interval "$INTERVAL_HOURS" --arg conv "$CONVERSION_FACTOR" \
      --arg collected "$COLLECTED_AT" '
      .data[] |
      (.fundingRate1h | tonumber) as $rate_raw |
      ($rate_raw * ($conv | tonumber)) as $rate_pct |
      ($rate_pct / ($interval | tonumber)) as $rate_1h |
      ($rate_pct * (365 * 24 / ($interval | tonumber))) as $rate_apr |
      (.createdAt / 1000 | floor) as $ts |
      "INSERT OR REPLACE INTO ethereal_funding_v3 (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source) VALUES (\"\($sym)\", \"\($base)\", \($ts), \($rate_raw), \($rate_pct), \($interval), \($rate_1h), \($rate_apr), \($collected), \"import\");"' >> "$OUTPUT_FILE"

    PRODUCT_RECORDS=$((PRODUCT_RECORDS + PAGE_COUNT))

    # Check if more pages
    HAS_NEXT=$(echo "$RESPONSE" | jq -r '.hasNext // false')
    if [ "$HAS_NEXT" != "true" ]; then
      break
    fi

    CURSOR=$(echo "$RESPONSE" | jq -r '.nextCursor // empty')
    if [ -z "$CURSOR" ]; then
      break
    fi

    sleep 0.2
  done

  # Log progress
  if [ "$PRODUCT_RECORDS" -gt 0 ]; then
    printf "  [%d/%d] %-20s %d records\n" "$NUM" "$PRODUCT_COUNT" "$TICKER" "$PRODUCT_RECORDS"
    TOTAL_RECORDS=$((TOTAL_RECORDS + PRODUCT_RECORDS))
  else
    printf "  [%d/%d] %-20s no data\n" "$NUM" "$PRODUCT_COUNT" "$TICKER"
    ERRORS=$((ERRORS + 1))
  fi

  # Write running totals to file for access outside subshell
  echo "$TOTAL_RECORDS" > "${TEMP_DIR}/total.txt"
  echo "$ERRORS" > "${TEMP_DIR}/errors.txt"

  sleep 0.1
done

# Read totals from subshell
TOTAL_RECORDS=$(cat "${TEMP_DIR}/total.txt" 2>/dev/null || echo "0")
ERRORS=$(cat "${TEMP_DIR}/errors.txt" 2>/dev/null || echo "0")

echo ""
echo "=========================================="
echo "Fetch Summary"
echo "=========================================="
echo "Products processed: $PRODUCT_COUNT"
echo "Total records fetched: $TOTAL_RECORDS"
echo "Products without data: $ERRORS"
echo ""

if [ "$TOTAL_RECORDS" -eq 0 ]; then
  echo "No data to import"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Import SQL files in batches
echo "Importing to database..."
BATCH_NUM=0
BATCH_FILES=()

for SQL_FILE in "${TEMP_DIR}"/market_*.sql; do
  if [ -f "$SQL_FILE" ] && [ -s "$SQL_FILE" ]; then
    BATCH_FILES+=("$SQL_FILE")

    if [ ${#BATCH_FILES[@]} -ge 10 ]; then
      BATCH_NUM=$((BATCH_NUM + 1))
      COMBINED=$(mktemp)
      cat "${BATCH_FILES[@]}" > "$COMBINED"
      LINE_COUNT=$(wc -l < "$COMBINED" | tr -d ' ')

      echo "  Batch $BATCH_NUM: ${#BATCH_FILES[@]} products, $LINE_COUNT statements"
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

  echo "  Batch $BATCH_NUM (final): ${#BATCH_FILES[@]} products, $LINE_COUNT statements"
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
  FROM ethereal_funding_v3
"

echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
