#!/bin/bash

echo "=== Aggregating Paradex data manually ==="

NOW=$(date +%s)
FIVE_MIN_AGO=$((NOW - 300))

echo "Processing Paradex data older than 5 minutes..."

# Aggregate Paradex data with correct funding rate calculation (3 * 365 * 100)
npx wrangler d1 execute defiapi-db --remote --command "
INSERT OR REPLACE INTO market_stats_1m (
  exchange, symbol, normalized_symbol,
  avg_mark_price, avg_index_price, min_price, max_price, price_volatility,
  volume_base, volume_quote,
  avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
  avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
  minute_timestamp, sample_count, created_at
)
SELECT
  exchange,
  symbol,
  REPLACE(REPLACE(REPLACE(symbol, '-USD-PERP', ''), '-USD', ''), 'USDT', '') as normalized_symbol,
  AVG(CAST(mark_price AS REAL)) as avg_mark_price,
  AVG(CAST(index_price AS REAL)) as avg_index_price,
  MIN(CAST(mark_price AS REAL)) as min_price,
  MAX(CAST(mark_price AS REAL)) as max_price,
  CASE WHEN AVG(CAST(mark_price AS REAL)) > 0 
    THEN ((MAX(CAST(mark_price AS REAL)) - MIN(CAST(mark_price AS REAL))) / AVG(CAST(mark_price AS REAL)) * 100) 
    ELSE 0 
  END as price_volatility,
  SUM(daily_base_token_volume) as volume_base,
  SUM(daily_quote_token_volume) as volume_quote,
  AVG(CAST(open_interest AS REAL)) as avg_open_interest,
  AVG(CAST(open_interest_usd AS REAL)) as avg_open_interest_usd,
  MAX(CAST(open_interest_usd AS REAL)) as max_open_interest_usd,
  AVG(CAST(funding_rate AS REAL)) as avg_funding_rate,
  AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100 as avg_funding_rate_annual,
  MIN(CAST(funding_rate AS REAL)) as min_funding_rate,
  MAX(CAST(funding_rate AS REAL)) as max_funding_rate,
  (created_at / 60) * 60 as minute_timestamp,
  COUNT(*) as sample_count,
  $NOW as created_at
FROM market_stats
WHERE exchange = 'paradex' 
  AND created_at < $FIVE_MIN_AGO
GROUP BY exchange, symbol, minute_timestamp
"

echo ""
echo "Deleting processed raw data..."
npx wrangler d1 execute defiapi-db --remote --command "
DELETE FROM market_stats 
WHERE exchange = 'paradex' 
  AND created_at < $FIVE_MIN_AGO
"

echo ""
echo "=== Verification ==="
npx wrangler d1 execute defiapi-db --remote --command "
SELECT COUNT(*) as total, 
  MAX(minute_timestamp) as latest, 
  datetime(MAX(minute_timestamp), 'unixepoch') as latest_time 
FROM market_stats_1m 
WHERE exchange = 'paradex' AND normalized_symbol = 'BTC'
"

echo ""
echo "Testing API endpoint..."
curl -s "https://defiapi.cloudflareone-demo-account.workers.dev/api/normalized-data?symbol=BTC&exchange=paradex&limit=3" | jq '.data[0:2] | .[] | {timestamp_iso, mark_price, data_source}'
