#!/bin/bash
set -e

DB_NAME="defiapi-db"
REMOTE="--remote"

echo "=========================================="
echo "Manual Batch Aggregation"
echo "=========================================="
echo ""

# Get the oldest unaggregated data
FIVE_MIN_AGO=$(($(date +%s) - 300))
OLDEST_QUERY=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "SELECT MIN(created_at) as oldest FROM market_stats WHERE created_at < $FIVE_MIN_AGO" 2>/dev/null)
OLDEST=$(echo "$OLDEST_QUERY" | jq -r '.[0].results[0].oldest' 2>/dev/null)

if [ "$OLDEST" = "null" ] || [ -z "$OLDEST" ]; then
  echo "No data to aggregate"
  exit 0
fi

echo "Oldest unaggregated data: $(date -u -r $OLDEST)"
echo "Processing in 1-hour batches..."
echo ""

BATCH_START=$OLDEST
BATCH_SIZE=3600  # 1 hour in seconds
BATCHES_PROCESSED=0
MAX_BATCHES=20  # Process max 20 hours at a time

while [ $BATCH_START -lt $FIVE_MIN_AGO ] && [ $BATCHES_PROCESSED -lt $MAX_BATCHES ]; do
  BATCH_END=$((BATCH_START + BATCH_SIZE))

  if [ $BATCH_END -gt $FIVE_MIN_AGO ]; then
    BATCH_END=$FIVE_MIN_AGO
  fi

  echo "=== Batch $((BATCHES_PROCESSED + 1)): $(date -u -r $BATCH_START '+%Y-%m-%d %H:%M') to $(date -u -r $BATCH_END '+%Y-%m-%d %H:%M') ==="

  # Count records in this batch
  COUNT_QUERY=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "SELECT COUNT(*) as count FROM market_stats WHERE created_at >= $BATCH_START AND created_at < $BATCH_END" 2>/dev/null)
  COUNT=$(echo "$COUNT_QUERY" | jq -r '.[0].results[0].count' 2>/dev/null)

  echo "  Records to aggregate: $COUNT"

  if [ "$COUNT" -gt 0 ]; then
    # Run aggregation for this batch
    NOW=$(date +%s)

    SQL=$(cat <<EOF
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
  CASE
    WHEN AVG(CAST(mark_price AS REAL)) > 0
    THEN ((MAX(CAST(mark_price AS REAL)) - MIN(CAST(mark_price AS REAL))) / AVG(CAST(mark_price AS REAL)) * 100)
    ELSE 0
  END as price_volatility,
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
    WHEN exchange = 'aster' THEN
      CASE
        WHEN AVG(funding_interval_hours) = 1 THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
        WHEN AVG(funding_interval_hours) = 4 THEN AVG(CAST(funding_rate AS REAL)) * 6 * 365 * 100
        WHEN AVG(funding_interval_hours) = 8 THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
        ELSE AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
      END
    WHEN exchange = 'extended' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
    WHEN exchange = 'pacifica' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
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
)

    # Write SQL to temp file
    SQL_FILE=$(mktemp)
    echo "$SQL" > "$SQL_FILE"

    # Execute aggregation
    if npx wrangler d1 execute "$DB_NAME" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1; then
      RESULT_QUERY=$(npx wrangler d1 execute "$DB_NAME" $REMOTE --command "SELECT changes() as changes" 2>/dev/null)
      CHANGES=$(echo "$RESULT_QUERY" | jq -r '.[0].results[0].changes' 2>/dev/null || echo "?")
      echo "  ✅ Aggregated to 1-minute records"

      # Delete aggregated 15s snapshots
      npx wrangler d1 execute "$DB_NAME" $REMOTE --command "DELETE FROM market_stats WHERE created_at >= $BATCH_START AND created_at < $BATCH_END" > /dev/null 2>&1
      echo "  🗑️  Deleted $COUNT 15s snapshots"
    else
      echo "  ⚠️  Aggregation failed"
    fi

    rm -f "$SQL_FILE"
  fi

  echo ""
  BATCH_START=$BATCH_END
  BATCHES_PROCESSED=$((BATCHES_PROCESSED + 1))
  sleep 1
done

echo "=========================================="
echo "Batch aggregation complete"
echo "Processed $BATCHES_PROCESSED batches"
echo "=========================================="
echo ""

# Now run hourly aggregation
echo "Running hourly aggregation..."
curl -s "https://defiapi.cloudflareone-demo-account.workers.dev/debug/aggregate-1h"
echo ""
echo "Done!"
