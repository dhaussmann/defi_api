#!/bin/bash

# Import Hyperliquid funding rates for Jan 9-29, 2026
# Fills the data gap in the normalized-data endpoint

set -e

SOURCE_DB="funding-rates-db"
TARGET_DB="defiapi-db-write"

# Jan 9, 2026 00:00:00 = 1736380800 seconds = 1736380800000 ms
# Jan 29, 2026 23:59:59 = 1738195199 seconds = 1738195199000 ms
START_MS=1736380800000
END_MS=1738195199000

echo "=== Hyperliquid Funding Rate Import ==="
echo ""
echo "Importing Hyperliquid funding rate data for Jan 9-29, 2026"
echo "  Source: $SOURCE_DB (funding-rates-db)"
echo "  Target: $TARGET_DB (defiapi-db-write)"
echo "  Period: Jan 9, 2026 00:00 - Jan 29, 2026 23:59"
echo ""

# Check if source DB exists
echo "Checking source database..."
npx wrangler d1 list | grep -q "$SOURCE_DB" || {
  echo "❌ Error: Source database '$SOURCE_DB' not found"
  exit 1
}

echo "✓ Source database found"
echo ""

# Get count of records to import
echo "Checking available data..."
COUNT=$(npx wrangler d1 execute "$SOURCE_DB" --remote --command \
  "SELECT COUNT(*) as count FROM hyperliquid_funding_history 
   WHERE timestamp >= $START_MS AND timestamp <= $END_MS" --json 2>/dev/null | \
  jq -r '.[0].results[0].count' 2>/dev/null || echo "0")

if [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
  echo "❌ No data found in source database for this period"
  echo ""
  echo "Checking what data is available:"
  npx wrangler d1 execute "$SOURCE_DB" --remote --command \
    "SELECT 
       datetime(MIN(timestamp)/1000, 'unixepoch') as earliest,
       datetime(MAX(timestamp)/1000, 'unixepoch') as latest,
       COUNT(*) as total
     FROM hyperliquid_funding_history"
  exit 1
fi

echo "✓ Found $COUNT records to import"
echo ""

read -p "Continue with import? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Import cancelled."
  exit 1
fi
echo ""

# Export data from source DB
echo "Exporting data from $SOURCE_DB..."
EXPORT_FILE="/tmp/hyperliquid_import_$(date +%s).sql"

npx wrangler d1 execute "$SOURCE_DB" --remote --command \
  "SELECT 
     'INSERT INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES (' ||
     quote('hyperliquid') || ', ' ||
     quote(coin) || ', ' ||
     quote(coin) || ', ' ||
     COALESCE(funding_rate, 0) || ', ' ||
     COALESCE(funding_rate * 100, 0) || ', ' ||
     COALESCE(funding_rate * 365 * 24, 0) || ', ' ||
     collected_at || ');' as sql_insert
   FROM hyperliquid_funding_history
   WHERE collected_at >= $START_MS AND collected_at <= $END_MS
   ORDER BY collected_at" --json 2>/dev/null | \
  jq -r '.[0].results[].sql_insert' > "$EXPORT_FILE"

LINES=$(wc -l < "$EXPORT_FILE" | tr -d ' ')
echo "✓ Generated $LINES SQL INSERT statements"
echo ""

if [ "$LINES" -eq 0 ]; then
  echo "❌ No SQL statements generated"
  rm -f "$EXPORT_FILE"
  exit 1
fi

# Import to target DB
echo "Importing to $TARGET_DB..."
npx wrangler d1 execute "$TARGET_DB" --file "$EXPORT_FILE" --remote

echo "✓ Import complete"
echo ""

# Cleanup
rm -f "$EXPORT_FILE"

# Verify import
echo "Verifying import..."
npx wrangler d1 execute "$TARGET_DB" --remote --command \
  "SELECT 
     COUNT(*) as count,
     datetime(MIN(collected_at)/1000, 'unixepoch') as earliest,
     datetime(MAX(collected_at)/1000, 'unixepoch') as latest
   FROM funding_rate_history
   WHERE exchange = 'hyperliquid'
     AND collected_at >= $START_MS 
     AND collected_at <= $END_MS"

echo ""
echo "=== Import Complete ==="
echo ""
echo "Next steps:"
echo "1. Aggregate the data to market_history:"
echo "   curl -X POST 'https://api.fundingrate.de/api/admin/aggregate-history'"
echo ""
echo "2. Sync to DB_READ:"
echo "   curl -X POST 'https://api.fundingrate.de/api/admin/sync-db?start=1736380800&limit=1000'"
echo ""
