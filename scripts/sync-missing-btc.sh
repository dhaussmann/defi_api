#!/bin/bash

# Sync missing BTC data for hyperliquid and lighter
set -e

DB_WRITE="defiapi-db-write"
DB_READ="defiapi-db-read"
REMOTE="--remote"

echo "Syncing missing BTC data for hyperliquid and lighter..."

# Fetch data from DB_WRITE and create SQL
npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "
SELECT * FROM market_history 
WHERE exchange IN ('hyperliquid', 'lighter') 
AND normalized_symbol = 'BTC' 
AND hour_timestamp > 1738310400
ORDER BY hour_timestamp
" --json | jq -r '
.[] | .results[] | 
"INSERT OR REPLACE INTO market_history (
  exchange, symbol, normalized_symbol, hour_timestamp,
  avg_mark_price, avg_index_price, avg_funding_rate, avg_funding_rate_annual,
  min_price, max_price, price_volatility,
  volume_base, volume_quote,
  avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
  min_funding_rate, max_funding_rate,
  sample_count, aggregated_at
) VALUES (
  \"\(.exchange)\", \"\(.symbol)\", \"\(.normalized_symbol)\", \(.hour_timestamp),
  \(.avg_mark_price), \(.avg_index_price), \(.avg_funding_rate), \(.avg_funding_rate_annual),
  \(.min_price), \(.max_price), \(.price_volatility),
  \(.volume_base), \(.volume_quote),
  \(.avg_open_interest), \(.avg_open_interest_usd), \(.max_open_interest_usd),
  \(.min_funding_rate), \(.max_funding_rate),
  \(.sample_count), \(.aggregated_at)
);"
' > /tmp/sync-missing-btc.sql

echo "Generated SQL with $(wc -l < /tmp/sync-missing-btc.sql) statements"

# Execute on DB_READ
echo "Executing sync..."
npx wrangler d1 execute "$DB_READ" $REMOTE --file=/tmp/sync-missing-btc.sql

echo "Sync complete!"

# Verify
echo ""
echo "Verification:"
npx wrangler d1 execute "$DB_READ" $REMOTE --command "
SELECT exchange, COUNT(*) as records, 
       datetime(MAX(hour_timestamp), 'unixepoch') as last_update 
FROM market_history 
WHERE normalized_symbol = 'BTC' 
AND exchange IN ('hyperliquid', 'lighter')
GROUP BY exchange
"

rm -f /tmp/sync-missing-btc.sql
