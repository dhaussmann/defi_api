#!/bin/bash
# Import Aster V3 Historical Funding Rates
# Imports last 30 days of funding rate data into aster_funding_v3 table

set -e

DAYS_BACK="${1:-30}"
API_URL="https://api.fundingrate.de"

echo "=========================================="
echo "Aster V3 Historical Data Import"
echo "=========================================="
echo "Days back: $DAYS_BACK"
echo "Target table: aster_funding_v3"
echo ""

# Trigger import via API endpoint
echo "[1/2] Triggering Aster V3 import..."
RESPONSE=$(curl -s -X POST "$API_URL/debug/v3-aster-import?days=$DAYS_BACK")

echo "$RESPONSE" | jq '.'

# Check result
SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
  RECORDS=$(echo "$RESPONSE" | jq -r '.records')
  echo ""
  echo "✅ Import completed successfully!"
  echo "   Records imported: $RECORDS"
else
  echo ""
  echo "❌ Import failed!"
  ERROR=$(echo "$RESPONSE" | jq -r '.error')
  echo "   Error: $ERROR"
  exit 1
fi

# Verify data
echo ""
echo "[2/2] Verifying imported data..."
npx wrangler d1 execute defiapi-db-write --remote --command="
  SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT symbol) as markets,
    MIN(datetime(funding_time, 'unixepoch')) as earliest,
    MAX(datetime(funding_time, 'unixepoch')) as latest,
    SUM(CASE WHEN source = 'import' THEN 1 ELSE 0 END) as imported_records
  FROM aster_funding_v3
"

echo ""
echo "=========================================="
echo "Aster V3 Import Complete"
echo "=========================================="
