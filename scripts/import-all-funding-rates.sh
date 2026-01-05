#!/bin/bash

# Import recent funding rates from funding-rates-db (fills gaps from Dec 1, 2025 onwards)
# Set FUNDING_IMPORT_AUTO=1 to run non-interactively

SOURCE_DB="funding-rates-db"
TARGET_DB="defiapi-db"

# Dec 1, 2025 09:00:00 = 1764579600000ms (start of gap)
# Dec 26, 2025 23:59:59 = 1766908799000ms (end of today)
START_MS=1764579600000
END_MS=1766908799000

echo "=== Funding Rate Data Import ==="
echo ""
echo "Importing recent funding rate data (Dec 1 - Dec 26, 2025)"
echo "  Source: $SOURCE_DB"
echo "  Target: $TARGET_DB"
echo ""

if [ -z "$FUNDING_IMPORT_AUTO" ]; then
  echo "This will import funding rate data for:"
  echo "  - Hyperliquid"
  echo "  - Aster"
  echo "  - Paradex"
  echo ""
  echo "Time range: Dec 1, 2025 09:00 to Dec 26, 2025 (today)"
  echo ""
  read -p "Continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Import cancelled."
    exit 1
  fi
  echo ""
fi

set -e

# Import each exchange
for config in \
  "hyperliquid:hyperliquid_funding_history:coin" \
  "aster:aster_funding_history:symbol" \
  "paradex:paradex_funding_history:symbol"
do
  IFS=':' read -r exchange table symbol_col <<< "$config"

  echo ">>> Importing $exchange"
  echo "    Exporting from $SOURCE_DB..."

  ./scripts/export-from-d1.sh "$exchange" "$table" "$symbol_col" "$START_MS" "$END_MS" \
    > funding-import.sql

  LINES=$(wc -l < funding-import.sql | tr -d ' ')
  echo "    Generated $LINES SQL INSERT statements"

  if [ "$LINES" -eq 0 ]; then
    echo "    ⚠️  No new data to import"
  else
    echo "    Importing $LINES records to $TARGET_DB..."
    npx wrangler d1 execute "$TARGET_DB" --file funding-import.sql --remote > /dev/null 2>&1
    echo "    ✅ Done"
  fi

  echo ""
done

rm -f funding-import.sql

echo "=== Import Complete ==="
echo ""
echo "Verify data:"
echo "  npx wrangler d1 execute $TARGET_DB --remote --command \"SELECT exchange, COUNT(*) as count, datetime(MIN(collected_at)/1000, 'unixepoch') as oldest, datetime(MAX(collected_at)/1000, 'unixepoch') as newest FROM funding_rate_history GROUP BY exchange ORDER BY exchange\""
echo ""
