#!/bin/bash

echo "Aggregating backlog for all exchanges from 12:17 onwards..."

# Start time: 2026-01-09 12:17:00 (1767961020)
# End time: 5 minutes ago
START_TIME=1767961020
END_TIME=$(($(date +%s) - 300))

echo "Time range: $(date -r $START_TIME '+%Y-%m-%d %H:%M:%S') to $(date -r $END_TIME '+%Y-%m-%d %H:%M:%S')"

# Process in 10-minute batches
BATCH_SIZE=600  # 10 minutes
CURRENT=$START_TIME

while [ $CURRENT -lt $END_TIME ]; do
  BATCH_END=$((CURRENT + BATCH_SIZE))
  if [ $BATCH_END -gt $END_TIME ]; then
    BATCH_END=$END_TIME
  fi
  
  echo "Processing batch: $(date -r $CURRENT '+%H:%M:%S') to $(date -r $BATCH_END '+%H:%M:%S')"
  
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
  UPPER(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      symbol,
      'hyna:', ''), 'xyz:', ''), 'flx:', ''), 'vntl:', ''), 'km:', ''),
      'HYNA:', ''), 'XYZ:', ''), 'FLX:', ''), 'VNTL:', ''), 'KM:', ''),
      'edgex:', ''), 'EDGEX:', ''),
      'aster:', ''), 'ASTER:', ''),
      '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')
  ) as normalized_symbol,
  AVG(CAST(mark_price AS REAL)) as avg_mark_price,
  AVG(CAST(index_price AS REAL)) as avg_index_price,
  MIN(CAST(mark_price AS REAL)) as min_price,
  MAX(CAST(mark_price AS REAL)) as max_price,
  CASE WHEN AVG(CAST(mark_price AS REAL)) > 0 THEN ((MAX(CAST(mark_price AS REAL)) - MIN(CAST(mark_price AS REAL))) / AVG(CAST(mark_price AS REAL)) * 100) ELSE 0 END as price_volatility,
  SUM(daily_base_token_volume) as volume_base,
  SUM(daily_quote_token_volume) as volume_quote,
  AVG(CAST(open_interest AS REAL)) as avg_open_interest,
  AVG(CAST(open_interest_usd AS REAL)) as avg_open_interest_usd,
  MAX(CAST(open_interest_usd AS REAL)) as max_open_interest_usd,
  AVG(CAST(funding_rate AS REAL)) as avg_funding_rate,
  CASE
    WHEN exchange = 'hyperliquid' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
    WHEN exchange = 'paradex' THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
    WHEN exchange = 'edgex' THEN AVG(CAST(funding_rate AS REAL)) * 6 * 365 * 100
    WHEN exchange = 'lighter' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365
    WHEN exchange = 'extended' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
    WHEN exchange = 'pacifica' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
    WHEN exchange IN ('hyena', 'xyz', 'flx', 'vntl', 'km') THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
    ELSE AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
  END as avg_funding_rate_annual,
  MIN(CAST(funding_rate AS REAL)) as min_funding_rate,
  MAX(CAST(funding_rate AS REAL)) as max_funding_rate,
  (created_at / 60) * 60 as minute_timestamp,
  COUNT(*) as sample_count,
  $(date +%s) as created_at
FROM market_stats
WHERE created_at >= $CURRENT AND created_at < $BATCH_END
GROUP BY exchange, symbol, minute_timestamp
" 2>&1 | grep -v "wrangler\|Resource\|Executing\|database\|command\|Logs"
  
  # Delete processed data
  npx wrangler d1 execute defiapi-db --remote --command "DELETE FROM market_stats WHERE created_at >= $CURRENT AND created_at < $BATCH_END" 2>&1 | grep -v "wrangler\|Resource\|Executing\|database\|command\|Logs"
  
  CURRENT=$BATCH_END
  sleep 1
done

echo ""
echo "Aggregation complete! Checking status..."
npx wrangler d1 execute defiapi-db --remote --command "SELECT exchange, COUNT(DISTINCT normalized_symbol) as tokens, MAX(minute_timestamp) as last_update, datetime(MAX(minute_timestamp), 'unixepoch') as last_update_time FROM market_stats_1m GROUP BY exchange ORDER BY last_update DESC LIMIT 5"
