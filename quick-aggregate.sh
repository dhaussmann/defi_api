#!/bin/bash
set -e

DB_NAME="defiapi-db"
REMOTE="--remote"

echo "Quick Aggregation - Processing 20 batches"
FIVE_MIN_AGO=$(($(date +%s) - 300))
OLDEST=1767892603  # Known oldest timestamp

BATCH_START=$OLDEST
BATCH_SIZE=3600  # 1 hour
NOW=$(date +%s)

for i in {1..20}; do
  BATCH_END=$((BATCH_START + BATCH_SIZE))
  if [ $BATCH_END -gt $FIVE_MIN_AGO ]; then
    BATCH_END=$FIVE_MIN_AGO
  fi
  
  echo "Batch $i: $(date -r $BATCH_START '+%m-%d %H:%M') - $(date -r $BATCH_END '+%m-%d %H:%M')"
  
  # Aggregate
  npx wrangler d1 execute "$DB_NAME" $REMOTE --command "
    INSERT OR REPLACE INTO market_stats_1m (
      exchange, symbol, normalized_symbol,
      avg_mark_price, avg_index_price, min_price, max_price, price_volatility,
      volume_base, volume_quote,
      avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
      avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
      minute_timestamp, sample_count, created_at
    )
    SELECT
      exchange, symbol,
      UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol, 'hyna:', ''), 'xyz:', ''), 'flx:', ''), 'vntl:', ''), 'km:', '')) as normalized_symbol,
      AVG(CAST(mark_price AS REAL)) as avg_mark_price,
      AVG(CAST(index_price AS REAL)) as avg_index_price,
      MIN(CAST(mark_price AS REAL)) as min_price,
      MAX(CAST(mark_price AS REAL)) as max_price,
      CASE WHEN AVG(CAST(mark_price AS REAL)) > 0
        THEN ((MAX(CAST(mark_price AS REAL)) - MIN(CAST(mark_price AS REAL))) / AVG(CAST(mark_price AS REAL)) * 100)
        ELSE 0 END as price_volatility,
      SUM(daily_base_token_volume) as volume_base,
      SUM(daily_quote_token_volume) as volume_quote,
      AVG(CAST(open_interest AS REAL)) as avg_open_interest,
      AVG(CAST(open_interest_usd AS REAL)) as avg_open_interest_usd,
      MAX(CAST(open_interest_usd AS REAL)) as max_open_interest_usd,
      AVG(CAST(funding_rate AS REAL)) as avg_funding_rate,
      CASE
        WHEN exchange = 'hyperliquid' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
        WHEN exchange IN ('hyena', 'xyz', 'flx', 'vntl', 'km') THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
        ELSE AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
      END as avg_funding_rate_annual,
      MIN(CAST(funding_rate AS REAL)) as min_funding_rate,
      MAX(CAST(funding_rate AS REAL)) as max_funding_rate,
      (created_at / 60) * 60 as minute_timestamp,
      COUNT(*) as sample_count,
      $NOW as created_at
    FROM market_stats
    WHERE created_at >= $BATCH_START AND created_at < $BATCH_END
    GROUP BY exchange, symbol, minute_timestamp
  " > /dev/null 2>&1
  
  echo "  ✓ Aggregated"
  
  BATCH_START=$BATCH_END
  
  if [ $BATCH_START -ge $FIVE_MIN_AGO ]; then
    break
  fi
done

echo ""
echo "Deleting aggregated snapshots..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "DELETE FROM market_stats WHERE created_at < $BATCH_END"

echo "Done! Processed $i batches"
