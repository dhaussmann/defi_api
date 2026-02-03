#!/bin/bash

# Simple sync: Export from DB_WRITE and import to DB_READ
# Uses SQL dump approach

START_TS=1767916800  # Jan 9, 2026 00:00:00 UTC
END_TS=1769731199    # Jan 29, 2026 23:59:59 UTC

echo "=== Sync Jan 2026 Data to DB_READ ==="
echo ""

# Count records
echo "Counting records..."
COUNT=$(npx wrangler d1 execute defiapi-db-write --remote --command "SELECT COUNT(*) as count FROM market_history WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS" --json | jq '.[0].results[0].count')

echo "✓ Found $COUNT records to sync"
echo ""

# Export data as SQL INSERT statements
echo "Exporting data from DB_WRITE..."
TEMP_SQL="/tmp/sync_jan2026_$(date +%s).sql"

npx wrangler d1 execute defiapi-db-write --remote --command "
SELECT 
  'INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, hour_timestamp, min_price, max_price, avg_mark_price, avg_index_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, sample_count, aggregated_at) VALUES (' ||
  quote(exchange) || ', ' ||
  quote(symbol) || ', ' ||
  quote(COALESCE(normalized_symbol, symbol)) || ', ' ||
  hour_timestamp || ', ' ||
  COALESCE(min_price, 'NULL') || ', ' ||
  COALESCE(max_price, 'NULL') || ', ' ||
  COALESCE(avg_mark_price, 'NULL') || ', ' ||
  COALESCE(avg_index_price, 'NULL') || ', ' ||
  COALESCE(price_volatility, 0) || ', ' ||
  COALESCE(volume_base, 'NULL') || ', ' ||
  COALESCE(volume_quote, 'NULL') || ', ' ||
  COALESCE(avg_open_interest, 'NULL') || ', ' ||
  COALESCE(avg_open_interest_usd, 'NULL') || ', ' ||
  COALESCE(max_open_interest_usd, 'NULL') || ', ' ||
  COALESCE(avg_funding_rate, 'NULL') || ', ' ||
  COALESCE(avg_funding_rate_annual, 'NULL') || ', ' ||
  COALESCE(min_funding_rate, 'NULL') || ', ' ||
  COALESCE(max_funding_rate, 'NULL') || ', ' ||
  COALESCE(sample_count, 1) || ', ' ||
  COALESCE(aggregated_at, unixepoch('now')) || ');' as sql_statement
FROM market_history 
WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS
ORDER BY hour_timestamp, exchange, symbol
" --json | jq -r '.[0].results[].sql_statement' > "$TEMP_SQL"

EXPORTED=$(wc -l < "$TEMP_SQL" | tr -d ' ')
echo "✓ Exported $EXPORTED SQL statements"
echo ""

if [ "$EXPORTED" -eq 0 ]; then
  echo "❌ No data exported"
  rm "$TEMP_SQL"
  exit 1
fi

# Import to DB_READ
echo "Importing to DB_READ..."
npx wrangler d1 execute defiapi-db-read --remote --file="$TEMP_SQL"

if [ $? -eq 0 ]; then
  echo "✓ Import complete"
  rm "$TEMP_SQL"
else
  echo "❌ Import failed"
  echo "SQL file saved at: $TEMP_SQL"
  exit 1
fi

echo ""
echo "=== Sync Complete ==="
