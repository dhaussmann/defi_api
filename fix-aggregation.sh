#!/bin/bash

echo "=== Fixing aggregation backlog for /api/normalized-data ==="
echo ""

# Get current time and calculate 5 minutes ago
NOW=$(date +%s)
FIVE_MIN_AGO=$((NOW - 300))
START_TIME=1767961020  # 2026-01-09 12:17:00

echo "Processing data from $(date -r $START_TIME '+%Y-%m-%d %H:%M:%S') to $(date -r $FIVE_MIN_AGO '+%Y-%m-%d %H:%M:%S')"
echo ""

# Process each exchange separately to avoid complex CASE statements
EXCHANGES=("hyperliquid" "paradex" "edgex" "lighter" "aster" "extended" "pacifica" "hyena" "xyz" "flx" "vntl" "km")

for EXCHANGE in "${EXCHANGES[@]}"; do
  echo "Processing $EXCHANGE..."
  
  # Determine funding rate multiplier
  case $EXCHANGE in
    hyperliquid)
      MULTIPLIER="24 * 365 * 100"
      ;;
    paradex)
      MULTIPLIER="3 * 365 * 100"
      ;;
    edgex)
      MULTIPLIER="6 * 365 * 100"
      ;;
    lighter)
      MULTIPLIER="24 * 365"
      ;;
    extended|pacifica)
      MULTIPLIER="24 * 365 * 100"
      ;;
    aster)
      MULTIPLIER="3 * 365 * 100"  # Default for Aster (will be mostly 8h interval)
      ;;
    hyena|xyz|flx|vntl|km)
      MULTIPLIER="3 * 365 * 100"
      ;;
    *)
      MULTIPLIER="3 * 365 * 100"
      ;;
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
  AVG(CAST(funding_rate AS REAL)) * $MULTIPLIER as avg_funding_rate_annual,
  MIN(CAST(funding_rate AS REAL)) as min_funding_rate,
  MAX(CAST(funding_rate AS REAL)) as max_funding_rate,
  (created_at / 60) * 60 as minute_timestamp,
  COUNT(*) as sample_count,
  $NOW as created_at
FROM market_stats
WHERE exchange = '$EXCHANGE' 
  AND created_at >= $START_TIME 
  AND created_at < $FIVE_MIN_AGO
GROUP BY exchange, symbol, minute_timestamp
" 2>&1 | grep -E "changes|error" || echo "  ✓ Aggregated"
  
  # Delete processed data for this exchange
  npx wrangler d1 execute defiapi-db --remote --command "
DELETE FROM market_stats 
WHERE exchange = '$EXCHANGE' 
  AND created_at >= $START_TIME 
  AND created_at < $FIVE_MIN_AGO
" 2>&1 | grep -E "changes|error" || echo "  ✓ Deleted old snapshots"
  
  sleep 1
done

echo ""
echo "=== Verification ==="
npx wrangler d1 execute defiapi-db --remote --command "
SELECT exchange, 
  COUNT(DISTINCT normalized_symbol) as tokens, 
  MAX(minute_timestamp) as last_update, 
  datetime(MAX(minute_timestamp), 'unixepoch') as last_update_time,
  ($NOW - MAX(minute_timestamp)) as seconds_ago
FROM market_stats_1m 
GROUP BY exchange 
ORDER BY last_update DESC
"

echo ""
echo "Remaining backlog:"
npx wrangler d1 execute defiapi-db --remote --command "
SELECT COUNT(*) as remaining 
FROM market_stats 
WHERE created_at < $FIVE_MIN_AGO
"
