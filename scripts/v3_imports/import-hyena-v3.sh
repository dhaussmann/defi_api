#!/bin/bash

# HyENA V3 Historical Funding Rate Import
# ========================================
# Fetches historical funding rates from HyENA (Hyperliquid API with dex: hyna).
# Based on Paradex V3 import script pattern.
#
# Strategy:
# - Fetch active markets via POST {type: "metaAndAssetCtxs", dex: "hyna"}
# - Use POST {type: "fundingHistory", coin: "hyna:XXX"} for historical data
# - Paginate with startTime/endTime (max 500 per page)
# - Import into hyena_funding_v3 table
#
# Usage:
#   ./import-hyena-v3.sh [DAYS_BACK]
#   Default: Last 30 days

set -e

API_URL="https://api.hyperliquid.xyz/info"
DB_NAME="defiapi-db-write"
REMOTE="--remote"
DEX="hyna"
TABLE="hyena_funding_v3"

# V3 Config: HyENA uses 1-hour intervals (same as Hyperliquid)
INTERVAL_HOURS=1
CONVERSION_FACTOR=100  # decimal to percent

# Parse arguments
DAYS_BACK="${1:-30}"
END_TS=$(date +%s)
START_TS=$((END_TS - DAYS_BACK * 86400))
START_MS="${START_TS}000"
END_MS="${END_TS}000"

START_DATE=$(date -u -r $START_TS '+%Y-%m-%d' 2>/dev/null || date -u -d @$START_TS '+%Y-%m-%d')
END_DATE=$(date -u -r $END_TS '+%Y-%m-%d' 2>/dev/null || date -u -d @$END_TS '+%Y-%m-%d')

echo "=========================================="
echo "HyENA V3 Historical Funding Rate Import"
echo "=========================================="
echo "Date range: $START_DATE to $END_DATE ($DAYS_BACK days)"
echo "Target table: $TABLE"
echo "API: $API_URL (dex: $DEX)"
echo "Interval: ${INTERVAL_HOURS}h"
echo ""

# Get all active HyENA markets
echo "[1/3] Fetching HyENA markets..."
MARKETS=$(curl -s "$API_URL" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"metaAndAssetCtxs\", \"dex\": \"${DEX}\"}" | \
  jq -r '.[0].universe[].name')

if [ -z "$MARKETS" ]; then
  echo "Error: No markets found"
  exit 1
fi

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found $MARKET_COUNT active markets"
echo ""

# Check existing data
echo "[2/3] Checking existing data..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
  SELECT 
    COUNT(*) as total,
    COUNT(DISTINCT symbol) as symbols,
    MIN(datetime(funding_time, 'unixepoch')) as earliest,
    MAX(datetime(funding_time, 'unixepoch')) as latest
  FROM $TABLE
  WHERE source = 'import'
" 2>&1 | tail -15
echo ""

# Import data
echo "[3/3] Importing funding rates..."
TEMP_DIR=$(mktemp -d)
TOTAL_RECORDS=0
ERRORS=0
COLLECTED_AT=$(date +%s)

NUM=0
for COIN in $MARKETS; do
  NUM=$((NUM + 1))
  BASE_ASSET=$(echo "$COIN" | sed "s/^${DEX}://")
  OUTPUT_FILE="${TEMP_DIR}/market_${NUM}.sql"
  COIN_RECORDS=0
  PAGE_START=$START_MS
  
  # Paginate through funding history (max 500 per page)
  while true; do
    RESPONSE=$(curl -s "$API_URL" \
      -X POST \
      -H "Content-Type: application/json" \
      -d "{\"type\":\"fundingHistory\",\"coin\":\"${COIN}\",\"startTime\":${PAGE_START},\"endTime\":${END_MS}}")
    
    # Validate response
    if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "null" ]; then
      break
    fi
    
    if ! echo "$RESPONSE" | jq empty 2>/dev/null; then
      break
    fi
    
    PAGE_COUNT=$(echo "$RESPONSE" | jq 'length' 2>/dev/null)
    if [ -z "$PAGE_COUNT" ] || [ "$PAGE_COUNT" -eq 0 ]; then
      break
    fi
    
    # Generate SQL
    echo "$RESPONSE" | jq -r --arg sym "$COIN" --arg base "$BASE_ASSET" \
      --arg interval "$INTERVAL_HOURS" --arg conv "$CONVERSION_FACTOR" \
      --arg collected "$COLLECTED_AT" --arg tbl "$TABLE" '
      .[] |
      (.fundingRate | tonumber) as $rate_raw |
      ($rate_raw * ($conv | tonumber)) as $rate_pct |
      ($rate_pct / ($interval | tonumber)) as $rate_1h |
      ($rate_pct * (365 * 24 / ($interval | tonumber))) as $rate_apr |
      (.time / 1000 | floor) as $ts |
      "INSERT OR REPLACE INTO \($tbl) (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source) VALUES (\"\($sym)\", \"\($base)\", \($ts), \($rate_raw), \($rate_pct), \($interval), \($rate_1h), \($rate_apr), \($collected), \"import\");"' >> "$OUTPUT_FILE"
    
    COIN_RECORDS=$((COIN_RECORDS + PAGE_COUNT))
    
    # If less than 500, we got all data
    if [ "$PAGE_COUNT" -lt 500 ]; then
      break
    fi
    
    # Next page starts after last timestamp
    LAST_TIME=$(echo "$RESPONSE" | jq '.[-1].time')
    PAGE_START=$((LAST_TIME + 1))
    sleep 0.1
  done
  
  # Log progress
  if [ "$COIN_RECORDS" -gt 0 ]; then
    printf "  [%d/%d] %-20s %d records\n" "$NUM" "$MARKET_COUNT" "$COIN" "$COIN_RECORDS"
    TOTAL_RECORDS=$((TOTAL_RECORDS + COIN_RECORDS))
  else
    printf "  [%d/%d] %-20s no data\n" "$NUM" "$MARKET_COUNT" "$COIN"
    ERRORS=$((ERRORS + 1))
  fi
  
  sleep 0.1
done

echo ""
echo "=========================================="
echo "Fetch Summary"
echo "=========================================="
echo "Markets processed: $MARKET_COUNT"
echo "Total records fetched: $TOTAL_RECORDS"
echo "Markets without data: $ERRORS"
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
      
      echo "  Batch $BATCH_NUM: ${#BATCH_FILES[@]} markets, $LINE_COUNT statements"
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
  
  echo "  Batch $BATCH_NUM (final): ${#BATCH_FILES[@]} markets, $LINE_COUNT statements"
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
  FROM $TABLE
"

echo ""
echo "Import completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
