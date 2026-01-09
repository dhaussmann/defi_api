#!/bin/bash
set -e

DB_NAME="defiapi-db"
REMOTE="--remote"

echo "=========================================="
echo "Aggregate Backlog (Simplified)"
echo "=========================================="

# Get oldest data
FIVE_MIN_AGO=$(($(date +%s) - 300))
OLDEST_QUERY=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "SELECT MIN(created_at) as oldest FROM market_stats WHERE created_at < $FIVE_MIN_AGO" 2>&1)
OLDEST=$(echo "$OLDEST_QUERY" | jq -r '.[0].results[0].oldest' 2>/dev/null)

if [ "$OLDEST" = "null" ] || [ -z "$OLDEST" ]; then
  echo "No data to aggregate"
  exit 0
fi

echo "Oldest data: $(date -u -r $OLDEST)"
echo "Processing in 1-hour batches..."
echo ""

BATCH_START=$OLDEST
BATCH_COUNT=0
MAX_BATCHES=20

while [ $BATCH_START -lt $FIVE_MIN_AGO ] && [ $BATCH_COUNT -lt $MAX_BATCHES ]; do
  BATCH_END=$((BATCH_START + 3600))
  if [ $BATCH_END -gt $FIVE_MIN_AGO ]; then
    BATCH_END=$FIVE_MIN_AGO
  fi

  echo "Batch $((BATCH_COUNT + 1)): $(date -u -r $BATCH_START '+%H:%M') - $(date -u -r $BATCH_END '+%H:%M')"

  NOW=$(date +%s)

  cat > /tmp/agg-batch.sql << EOF
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
  UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    symbol,
    'hyna:', ''), 'xyz:', ''), 'flx:', ''), 'vntl:', ''), 'km:', ''),
    'HYNA:', ''), 'XYZ:', ''), 'FLX:', ''), 'VNTL:', ''), 'KM:', '')
  ) as normalized_symbol,
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
    WHEN exchange = 'paradex' THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
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
GROUP BY exchange, symbol, minute_timestamp;
EOF

  RESULT=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --file=/tmp/agg-batch.sql 2>&1)
  CHANGES=$(echo "$RESULT" | grep -o '"changes": [0-9]*' | grep -o '[0-9]*' || echo "0")

  echo "  ✅ Created $CHANGES 1-min records"

  rm -f /tmp/agg-batch.sql

  BATCH_START=$BATCH_END
  BATCH_COUNT=$((BATCH_COUNT + 1))
  sleep 2
done

echo ""
echo "=========================================="
echo "Aggregation complete: $BATCH_COUNT batches"
echo "=========================================="

# Delete aggregated 15s snapshots
echo ""
echo "Deleting aggregated 15s snapshots..."
npx wrangler d1 execute "$DB_NAME" $REMOTE --command "DELETE FROM market_stats WHERE created_at < $FIVE_MIN_AGO"

echo "Done!"
