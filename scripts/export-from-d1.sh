#!/bin/bash
# Export funding rate data from funding-rate-collector D1 database
# and prepare for import into defiapi-db

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Funding Rate D1 to D1 Export ===${NC}"
echo ""

# Check if source database name/ID is provided
if [ -z "$1" ]; then
  echo -e "${RED}Error: Source database name or ID required${NC}"
  echo ""
  echo "Usage: ./scripts/export-from-d1.sh <source-db-name-or-id> [output-file]"
  echo ""
  echo "Example:"
  echo "  ./scripts/export-from-d1.sh funding-rates-db"
  echo "  ./scripts/export-from-d1.sh funding-rates-db custom-output.sql"
  echo ""
  exit 1
fi

SOURCE_DB="$1"
OUTPUT_FILE="${2:-funding-import.sql}"

echo -e "${YELLOW}Source Database:${NC} $SOURCE_DB"
echo -e "${YELLOW}Output File:${NC} $OUTPUT_FILE"
echo ""

# Step 1: Get record count
echo -e "${GREEN}Step 1: Checking data availability...${NC}"
COUNT_QUERY="SELECT COUNT(*) as count FROM unified_funding_rates WHERE exchange IN ('hyperliquid', 'lighter', 'aster', 'paradex') AND collected_at >= 1735689600000"

TEMP_COUNT=$(mktemp)
npx wrangler d1 execute "$SOURCE_DB" --remote --command "$COUNT_QUERY" --json > "$TEMP_COUNT" 2>/dev/null || {
  echo -e "${RED}Error: Failed to query source database${NC}"
  echo "Please check:"
  echo "  1. Database name/ID is correct"
  echo "  2. You have access to the database"
  echo "  3. The unified_funding_rates table exists"
  rm "$TEMP_COUNT"
  exit 1
}

# Parse count from JSON output
RECORD_COUNT=$(cat "$TEMP_COUNT" | jq -r '.[0].results[0].count' 2>/dev/null || echo "0")
rm "$TEMP_COUNT"

if [ "$RECORD_COUNT" = "0" ] || [ -z "$RECORD_COUNT" ]; then
  echo -e "${RED}No records found or failed to parse count${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Found $RECORD_COUNT records${NC}"
echo ""

# Step 2: Export data in batches
echo -e "${GREEN}Step 2: Exporting data...${NC}"

# Start date: 2025-01-01 00:00:00 UTC in milliseconds
START_DATE=1735689600000

# Create SQL header
cat > "$OUTPUT_FILE" << EOF
-- Funding Rate History Import
-- Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
-- Source Database: $SOURCE_DB
-- Target Database: defiapi-db
-- Estimated Records: $RECORD_COUNT
-- Date Range: From 2025-01-01 onwards
-- Exchanges: hyperliquid, lighter, aster, paradex

-- Note: Using INSERT OR IGNORE to skip duplicates
-- This allows safe re-runs without errors

EOF

echo "Exporting data (this may take a few minutes)..."

# Export query - get all data and format as INSERT statements
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
LIMIT 100000;
"

TEMP_EXPORT=$(mktemp)
npx wrangler d1 execute "$SOURCE_DB" --remote --command "$EXPORT_QUERY" --json > "$TEMP_EXPORT" 2>/dev/null || {
  echo -e "${RED}Error: Failed to export data${NC}"
  rm "$TEMP_EXPORT"
  exit 1
}

# Parse and append INSERT statements
cat "$TEMP_EXPORT" | jq -r '.[0].results[].sql_statement' >> "$OUTPUT_FILE" 2>/dev/null || {
  echo -e "${RED}Error: Failed to parse export data${NC}"
  rm "$TEMP_EXPORT"
  exit 1
}
rm "$TEMP_EXPORT"

# Get actual line count
ACTUAL_COUNT=$(grep -c "^INSERT" "$OUTPUT_FILE" || echo "0")

echo -e "${GREEN}✓ Exported $ACTUAL_COUNT INSERT statements${NC}"
echo ""

# Step 3: Show statistics
echo -e "${GREEN}Step 3: Export Summary${NC}"
FILE_SIZE=$(ls -lh "$OUTPUT_FILE" | awk '{print $5}')
echo "  Output file: $OUTPUT_FILE"
echo "  File size: $FILE_SIZE"
echo "  Records: $ACTUAL_COUNT"
echo ""

# Show preview of first few lines
echo -e "${YELLOW}Preview (first 3 inserts):${NC}"
grep "^INSERT" "$OUTPUT_FILE" | head -3
echo "  ..."
echo ""

# Step 4: Next steps
echo -e "${GREEN}=== Export Complete! ===${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Review the generated file:"
echo "     ${GREEN}cat $OUTPUT_FILE | less${NC}"
echo ""
echo "  2. Import into defiapi-db:"
echo "     ${GREEN}npx wrangler d1 execute defiapi-db --remote --file=$OUTPUT_FILE${NC}"
echo ""
echo "  3. Verify import:"
echo "     ${GREEN}npx wrangler d1 execute defiapi-db --remote --command \"SELECT COUNT(*) FROM funding_rate_history\"${NC}"
echo ""
echo -e "${YELLOW}Important Notes:${NC}"
echo "  - Import may take several minutes depending on data size"
echo "  - Database will be unavailable during import"
echo "  - Duplicates are automatically skipped (INSERT OR IGNORE)"
echo "  - You can safely re-run the import if it fails"
echo ""
