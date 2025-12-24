#!/bin/bash
# Automated import of all funding rate data from funding-rates-db to defiapi-db
# This script handles multiple batches automatically

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Full Funding Rate Import (All 2M+)${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

SOURCE_DB="funding-rates-db"
TARGET_DB="defiapi-db"
BATCH_SIZE=100000
TEMP_DIR=$(mktemp -d)
START_DATE=1735689600000  # 2025-01-01 00:00:00 UTC in milliseconds

echo -e "${YELLOW}Configuration:${NC}"
echo "  Source: $SOURCE_DB"
echo "  Target: $TARGET_DB"
echo "  Batch size: $BATCH_SIZE records"
echo "  Temp directory: $TEMP_DIR"
echo ""

# Get total record count
echo -e "${BLUE}[1/4] Counting total records...${NC}"
TOTAL_QUERY="SELECT COUNT(*) as count FROM unified_funding_rates WHERE exchange IN ('hyperliquid', 'lighter', 'aster', 'paradex') AND collected_at >= $START_DATE"

TEMP_COUNT=$(mktemp)
npx wrangler d1 execute "$SOURCE_DB" --remote --command "$TOTAL_QUERY" --json > "$TEMP_COUNT" 2>/dev/null || {
  echo -e "${RED}Error: Failed to query source database${NC}"
  rm "$TEMP_COUNT"
  exit 1
}

TOTAL_RECORDS=$(cat "$TEMP_COUNT" | jq -r '.[0].results[0].count' 2>/dev/null || echo "0")
rm "$TEMP_COUNT"

if [ "$TOTAL_RECORDS" = "0" ]; then
  echo -e "${RED}No records found${NC}"
  exit 1
fi

TOTAL_BATCHES=$(( ($TOTAL_RECORDS + $BATCH_SIZE - 1) / $BATCH_SIZE ))

echo -e "${GREEN}✓ Total records: $TOTAL_RECORDS${NC}"
echo -e "${GREEN}✓ Batches needed: $TOTAL_BATCHES${NC}"
echo ""

# Check already imported
echo -e "${BLUE}[2/4] Checking already imported records...${NC}"
IMPORTED_QUERY="SELECT COUNT(*) as count FROM funding_rate_history"
TEMP_IMPORTED=$(mktemp)
npx wrangler d1 execute "$TARGET_DB" --remote --command "$IMPORTED_QUERY" --json > "$TEMP_IMPORTED" 2>/dev/null || {
  echo -e "${RED}Error: Failed to query target database${NC}"
  rm "$TEMP_IMPORTED"
  exit 1
}

ALREADY_IMPORTED=$(cat "$TEMP_IMPORTED" | jq -r '.[0].results[0].count' 2>/dev/null || echo "0")
rm "$TEMP_IMPORTED"

echo -e "${GREEN}✓ Already imported: $ALREADY_IMPORTED records${NC}"
REMAINING=$(($TOTAL_RECORDS - $ALREADY_IMPORTED))
echo -e "${YELLOW}  Remaining: $REMAINING records${NC}"
echo ""

if [ $REMAINING -le 0 ]; then
  echo -e "${GREEN}All records already imported!${NC}"
  exit 0
fi

# Confirmation
echo -e "${YELLOW}This will import ~$REMAINING records in $(( ($REMAINING + $BATCH_SIZE - 1) / $BATCH_SIZE )) batches.${NC}"
echo -e "${YELLOW}Estimated time: ~$(( ($REMAINING / $BATCH_SIZE) * 2 )) minutes${NC}"
echo ""

# Auto-confirm if FUNDING_IMPORT_AUTO is set
if [ "$FUNDING_IMPORT_AUTO" != "1" ]; then
  read -p "Continue? (y/N) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
else
  echo -e "${GREEN}Auto-confirmed (FUNDING_IMPORT_AUTO=1)${NC}"
fi

# Start batch import
echo ""
echo -e "${BLUE}[3/4] Starting batch import...${NC}"
echo ""

BATCH_NUM=1
OFFSET=0
SUCCESSFUL_BATCHES=0
FAILED_BATCHES=0

while [ $OFFSET -lt $TOTAL_RECORDS ]; do
  BATCH_FILE="$TEMP_DIR/batch-${BATCH_NUM}.sql"

  echo -e "${YELLOW}Batch $BATCH_NUM/$TOTAL_BATCHES (offset: $OFFSET)${NC}"

  # Export batch
  echo -n "  Exporting... "

  EXPORT_QUERY="
SELECT
  'INSERT OR IGNORE INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES (' ||
  quote(exchange) || ', ' ||
  quote(symbol) || ', ' ||
  quote(trading_pair) || ', ' ||
  funding_rate || ', ' ||
  funding_rate_percent || ', ' ||
  annualized_rate || ', ' ||
  collected_at || ');' as sql_statement
FROM unified_funding_rates
WHERE exchange IN ('hyperliquid', 'lighter', 'aster', 'paradex')
  AND collected_at >= $START_DATE
ORDER BY collected_at ASC
LIMIT $BATCH_SIZE OFFSET $OFFSET;
"

  TEMP_EXPORT=$(mktemp)
  npx wrangler d1 execute "$SOURCE_DB" --remote --command "$EXPORT_QUERY" --json > "$TEMP_EXPORT" 2>/dev/null || {
    echo -e "${RED}FAILED${NC}"
    FAILED_BATCHES=$((FAILED_BATCHES + 1))
    rm "$TEMP_EXPORT"
    OFFSET=$(($OFFSET + $BATCH_SIZE))
    BATCH_NUM=$((BATCH_NUM + 1))
    continue
  }

  # Create SQL file
  cat "$TEMP_EXPORT" | jq -r '.[0].results[].sql_statement' > "$BATCH_FILE" 2>/dev/null || {
    echo -e "${RED}FAILED (parsing)${NC}"
    FAILED_BATCHES=$((FAILED_BATCHES + 1))
    rm "$TEMP_EXPORT"
    OFFSET=$(($OFFSET + $BATCH_SIZE))
    BATCH_NUM=$((BATCH_NUM + 1))
    continue
  }
  rm "$TEMP_EXPORT"

  BATCH_RECORDS=$(wc -l < "$BATCH_FILE" | tr -d ' ')
  echo -e "${GREEN}OK ($BATCH_RECORDS records)${NC}"

  if [ "$BATCH_RECORDS" = "0" ]; then
    echo "  No more records, stopping."
    break
  fi

  # Import batch
  echo -n "  Importing... "

  npx wrangler d1 execute "$TARGET_DB" --remote --file="$BATCH_FILE" > /dev/null 2>&1 && {
    echo -e "${GREEN}OK${NC}"
    SUCCESSFUL_BATCHES=$((SUCCESSFUL_BATCHES + 1))
  } || {
    echo -e "${RED}FAILED${NC}"
    FAILED_BATCHES=$((FAILED_BATCHES + 1))
  }

  # Cleanup batch file
  rm "$BATCH_FILE"

  # Progress
  IMPORTED_SO_FAR=$(($OFFSET + $BATCH_RECORDS))
  PROGRESS=$(( ($IMPORTED_SO_FAR * 100) / $TOTAL_RECORDS ))
  echo -e "  ${BLUE}Progress: $PROGRESS% ($IMPORTED_SO_FAR / $TOTAL_RECORDS)${NC}"
  echo ""

  OFFSET=$(($OFFSET + $BATCH_SIZE))
  BATCH_NUM=$((BATCH_NUM + 1))

  # Small delay between batches to avoid overwhelming D1
  sleep 3
done

# Cleanup temp directory
rm -rf "$TEMP_DIR"

echo ""
echo -e "${BLUE}[4/4] Verifying final import...${NC}"

# Get final count
FINAL_COUNT_FILE=$(mktemp)
npx wrangler d1 execute "$TARGET_DB" --remote --command "SELECT COUNT(*) as count FROM funding_rate_history" --json > "$FINAL_COUNT_FILE" 2>/dev/null
FINAL_COUNT=$(cat "$FINAL_COUNT_FILE" | jq -r '.[0].results[0].count' 2>/dev/null || echo "unknown")
rm "$FINAL_COUNT_FILE"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Import Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}Summary:${NC}"
echo "  Total batches: $TOTAL_BATCHES"
echo "  Successful: $SUCCESSFUL_BATCHES"
echo "  Failed: $FAILED_BATCHES"
echo "  Final record count: $FINAL_COUNT"
echo ""

# Show statistics
echo -e "${YELLOW}Statistics by exchange:${NC}"
npx wrangler d1 execute "$TARGET_DB" --remote --command "
  SELECT
    exchange,
    COUNT(*) as records,
    COUNT(DISTINCT symbol) as tokens,
    MIN(datetime(collected_at/1000, 'unixepoch')) as earliest,
    MAX(datetime(collected_at/1000, 'unixepoch')) as latest
  FROM funding_rate_history
  GROUP BY exchange
  ORDER BY records DESC
" 2>/dev/null || echo "Could not fetch statistics"

echo ""
echo -e "${GREEN}✓ Import complete!${NC}"
echo ""
