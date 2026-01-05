#!/bin/bash

# Import missing funding rate data from funding-rates-db to defiapi-db
# This script fills gaps in historical funding rate data for:
# - Hyperliquid: 1.1.2025 - 18.12.2025
# - Aster: 1.1.2025 - 21.12.2025
# - Paradex: 9.12.2025 - 18.12.2025

set -e

SOURCE_DB="funding-rates-db"
TARGET_DB="defiapi-db"

echo "=== Funding Rate Data Import ==="
echo "Source DB: $SOURCE_DB"
echo "Target DB: $TARGET_DB"
echo ""

# Function to import data for one exchange
import_exchange_data() {
  local exchange=$1
  local table_name=$2
  local start_ms=$3
  local end_ms=$4
  local description=$5
  local symbol_column=$6  # New parameter: column name for symbol (either 'symbol' or 'coin')

  echo ">>> Processing $exchange ($description)"

  # Export data from source DB
  echo "  1. Exporting data from $SOURCE_DB..."
  npx wrangler d1 execute "$SOURCE_DB" --remote --json \
    --command "SELECT ${symbol_column} as symbol, funding_rate, collected_at FROM ${table_name} WHERE collected_at >= $start_ms AND collected_at < $end_ms ORDER BY collected_at" \
    > /tmp/funding_export_${exchange}.json

  # Check if data was exported
  local count=$(cat /tmp/funding_export_${exchange}.json | jq -r '.[0].results | length')

  if [ "$count" -eq 0 ]; then
    echo "  ⚠️  No data found for $exchange in time range"
    return
  fi

  echo "  ✓ Exported $count records"

  # Convert to SQL INSERT statements
  echo "  2. Converting to SQL format..."
  cat /tmp/funding_export_${exchange}.json | jq -r '
    .[0].results[] |
    "INSERT OR IGNORE INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES (" +
    "\"'"$exchange"'\", " +
    "\"" + .symbol + "\", " +
    "\"" + .symbol + "\", " +
    (.funding_rate | tostring) + ", " +
    ((.funding_rate * 100) | tostring) + ", " +
    ((.funding_rate * 100 * 3 * 365) | tostring) + ", " +
    (.collected_at | tostring) +
    ");"
  ' > /tmp/funding_import_${exchange}.sql

  local sql_lines=$(wc -l < /tmp/funding_import_${exchange}.sql | tr -d ' ')
  echo "  ✓ Generated $sql_lines SQL statements"

  # Split into batches of 1000 with numeric suffixes
  echo "  3. Splitting into batches..."
  split -l 1000 -d /tmp/funding_import_${exchange}.sql /tmp/funding_batch_${exchange}_

  local batch_count=$(ls /tmp/funding_batch_${exchange}_* 2>/dev/null | wc -l | tr -d ' ')
  echo "  ✓ Created $batch_count batches (1000 records each)"

  # Import batches
  echo "  4. Importing batches to $TARGET_DB..."
  local batch_num=0
  local imported=0
  for batch_file in /tmp/funding_batch_${exchange}_*; do
    batch_num=$((batch_num + 1))
    local batch_size=$(wc -l < "$batch_file" | tr -d ' ')
    echo "     Batch $batch_num/$batch_count ($batch_size records)..."

    # Combine all statements into one command
    local sql_batch=$(cat "$batch_file" | tr '\n' ' ')
    npx wrangler d1 execute "$TARGET_DB" --remote --command "$sql_batch" > /dev/null 2>&1

    imported=$((imported + batch_size))
  done

  echo "  ✅ Imported $imported records for $exchange"

  # Cleanup
  rm -f /tmp/funding_export_${exchange}.json
  rm -f /tmp/funding_import_${exchange}.sql
  rm -f /tmp/funding_batch_${exchange}_*

  echo ""
}

# Import Hyperliquid data (1.1.2025 - 16.12.2025 23:59)
# Start: 1.1.2025 00:00 = 1735689600000ms
# End: 17.12.2025 00:00 = 1765929600000ms
# Note: Hyperliquid uses 'coin' column instead of 'symbol'
import_exchange_data "hyperliquid" "hyperliquid_funding_history" 1735689600000 1765929600000 "1.1-16.12.2025" "coin"

# Import Aster data (1.1.2025 - 21.12.2025 14:59)
# Start: 1.1.2025 00:00 = 1735689600000ms
# End: 21.12.2025 15:00 = 1766340000000ms
import_exchange_data "aster" "aster_funding_history" 1735689600000 1766340000000 "1.1-21.12.2025" "symbol"

# Import Paradex data (9.12.2025 - 18.12.2025 07:59)
# Start: 9.12.2025 11:01 = 1765278087794ms (actual earliest data)
# End: 18.12.2025 08:00 = 1766080000000ms
import_exchange_data "paradex" "paradex_funding_history" 1765278087000 1766080000000 "9.12-18.12.2025" "symbol"

echo ""
echo "=== Import Complete ==="
echo ""
echo "Next steps:"
echo "1. Verify imported data:"
echo "   npx wrangler d1 execute $TARGET_DB --remote --command \"SELECT exchange, COUNT(*) as count, datetime(MIN(collected_at)/1000, 'unixepoch') as oldest, datetime(MAX(collected_at)/1000, 'unixepoch') as newest FROM funding_rate_history GROUP BY exchange ORDER BY exchange\""
echo ""
echo "2. Test the /api/funding-history endpoint:"
echo "   curl 'https://defiapi.cloudflareone-demo-account.workers.dev/api/funding-history?symbol=BTC&exchange=hyperliquid&from=1735689600000&to=1735776000000&limit=100'"
echo ""
