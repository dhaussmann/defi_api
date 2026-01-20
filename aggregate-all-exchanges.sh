#!/bin/bash

echo "=== Aggregating ALL exchanges to fix 60-minute issue ==="

NOW=$(date +%s)
FIVE_MIN_AGO=$((NOW - 300))

echo "Current time: $(date -r $NOW '+%Y-%m-%d %H:%M:%S')"
echo "Processing data older than: $(date -r $FIVE_MIN_AGO '+%Y-%m-%d %H:%M:%S')"
echo ""

# Process each exchange with correct funding rate multiplier
EXCHANGES=(
  "hyperliquid:24:365:100"
  "aster:3:365:100"
  "edgex:6:365:100"
  "lighter:24:365:1"
  "extended:24:365:100"
  "pacifica:24:365:100"
  "hyena:3:365:100"
  "xyz:3:365:100"
  "flx:3:365:100"
  "vntl:3:365:100"
  "km:3:365:100"
)

for config in "${EXCHANGES[@]}"; do
  IFS=':' read -r exchange h d m <<< "$config"
  
  echo ">>> Processing $exchange (funding: $h * $d * $m)"
  
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
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    symbol,
    'hyna:', ''), 'xyz:', ''), 'flx:', ''), 'vntl:', ''), 'km:', ''),
    'HYNA:', ''), 'XYZ:', ''), 'FLX:', ''), 'VNTL:', ''), 'KM:', ''),
    'edgex:', ''), 'EDGEX:', ''), 'aster:', ''), 'ASTER:', '')
  , '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '') as normalized_symbol,
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
  AVG(CAST(funding_rate AS REAL)) * $h * $d * $m as avg_funding_rate_annual,
  MIN(CAST(funding_rate AS REAL)) as min_funding_rate,
  MAX(CAST(funding_rate AS REAL)) as max_funding_rate,
  (created_at / 60) * 60 as minute_timestamp,
  COUNT(*) as sample_count,
  $NOW as created_at
FROM market_stats
WHERE exchange = '$exchange' 
  AND created_at < $FIVE_MIN_AGO
GROUP BY exchange, symbol, minute_timestamp
" 2>&1 | grep -E "Executed|error" || echo "  ✓ Aggregated"
  
  # Delete processed data
  npx wrangler d1 execute defiapi-db --remote --command "
DELETE FROM market_stats 
WHERE exchange = '$exchange' 
  AND created_at < $FIVE_MIN_AGO
" 2>&1 | grep -v "wrangler\|Resource\|Executing\|database" || true

  echo ""
done

echo "=== Verification ==="
npx wrangler d1 execute defiapi-db --remote --command "
SELECT exchange, 
  MAX(minute_timestamp) as latest, 
  datetime(MAX(minute_timestamp), 'unixepoch') as latest_time,
  ($NOW - MAX(minute_timestamp)) as seconds_ago,
  CASE WHEN ($NOW - MAX(minute_timestamp)) > 3600 THEN '❌ TOO OLD' ELSE '✅ OK' END as status
FROM market_stats_1m 
GROUP BY exchange 
ORDER BY latest DESC
"
