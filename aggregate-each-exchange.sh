#!/bin/bash

echo "=== Aggregating each exchange separately ==="

NOW=$(date +%s)
FIVE_MIN_AGO=$((NOW - 300))

# Simple aggregation for each exchange
for exchange in hyperliquid aster edgex lighter extended pacifica hyena xyz flx vntl km; do
  echo ">>> $exchange"
  
  # Get funding rate multiplier
  case $exchange in
    hyperliquid|extended|pacifica) MULT="24 * 365 * 100" ;;
    aster|hyena|xyz|flx|vntl|km) MULT="3 * 365 * 100" ;;
    edgex) MULT="6 * 365 * 100" ;;
    lighter) MULT="24 * 365" ;;
  esac
  
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
  '$exchange' as exchange,
  symbol,
  UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol, 'hyna:', ''), 'xyz:', ''), 'flx:', ''), 'vntl:', ''), 'km:', ''), 'edgex:', ''), 'aster:', ''), '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')) as normalized_symbol,
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
  AVG(CAST(funding_rate AS REAL)) * $MULT as avg_funding_rate_annual,
  MIN(CAST(funding_rate AS REAL)) as min_funding_rate,
  MAX(CAST(funding_rate AS REAL)) as max_funding_rate,
  (created_at / 60) * 60 as minute_timestamp,
  COUNT(*) as sample_count,
  $NOW as created_at
FROM market_stats
WHERE exchange = '$exchange' 
  AND created_at < $FIVE_MIN_AGO
GROUP BY symbol, minute_timestamp
" 2>&1 | grep "changes" || echo "  Error"
  
  npx wrangler d1 execute defiapi-db --remote --command "
DELETE FROM market_stats WHERE exchange = '$exchange' AND created_at < $FIVE_MIN_AGO
" > /dev/null 2>&1
  
done

echo ""
echo "=== Final Status ==="
npx wrangler d1 execute defiapi-db --remote --command "
SELECT exchange, 
  MAX(minute_timestamp) as latest, 
  datetime(MAX(minute_timestamp), 'unixepoch') as latest_time,
  ($NOW - MAX(minute_timestamp)) as seconds_ago,
  CASE WHEN ($NOW - MAX(minute_timestamp)) > 3600 THEN '❌' ELSE '✅' END as status
FROM market_stats_1m 
GROUP BY exchange 
ORDER BY latest DESC
"
