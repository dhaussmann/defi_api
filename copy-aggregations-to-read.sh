#!/bin/bash
# Copy aggregation data from DB_WRITE to DB_READ

echo "Copying 1-minute aggregations from DB_WRITE to DB_READ..."

# Export from DB_WRITE
wrangler d1 execute defiapi-db-write --remote --command "SELECT * FROM market_stats_1m ORDER BY minute_timestamp DESC LIMIT 10000" --json > /tmp/market_stats_1m.json

# Count records
RECORDS=$(jq '.[0].results | length' /tmp/market_stats_1m.json)
echo "Exported $RECORDS records from DB_WRITE"

# Generate INSERT statements in batches of 100
BATCH_SIZE=100
TOTAL_BATCHES=$(( (RECORDS + BATCH_SIZE - 1) / BATCH_SIZE ))

echo "Importing in $TOTAL_BATCHES batches..."

for ((batch=0; batch<TOTAL_BATCHES; batch++)); do
  START=$((batch * BATCH_SIZE))
  
  echo -n "Batch $((batch + 1))/$TOTAL_BATCHES... "
  
  # Generate SQL for this batch
  echo "BEGIN TRANSACTION;" > /tmp/batch_$batch.sql
  
  jq -r --argjson start $START --argjson size $BATCH_SIZE '
    .[0].results[$start:($start+$size)][] |
    "INSERT OR IGNORE INTO market_stats_1m (exchange, symbol, minute_timestamp, avg_mark_price, avg_index_price, avg_open_interest_usd, avg_funding_rate, sum_volume, price_low, price_high, price_change, sample_count, created_at) VALUES (\"\(.exchange)\", \"\(.symbol)\", \(.minute_timestamp), \(.avg_mark_price), \(.avg_index_price), \(.avg_open_interest_usd), \(.avg_funding_rate), \(.sum_volume), \(.price_low), \(.price_high), \(.price_change), \(.sample_count), \(.created_at));"
  ' /tmp/market_stats_1m.json >> /tmp/batch_$batch.sql
  
  echo "COMMIT;" >> /tmp/batch_$batch.sql
  
  # Execute
  if wrangler d1 execute defiapi-db-read --remote --file=/tmp/batch_$batch.sql > /dev/null 2>&1; then
    echo "✓"
  else
    echo "✗"
  fi
  
  rm -f /tmp/batch_$batch.sql
  sleep 0.3
done

# Verify
FINAL=$(wrangler d1 execute defiapi-db-read --remote --command "SELECT COUNT(*) as count FROM market_stats_1m" --json | jq -r '.[0].results[0].count')
echo ""
echo "Final count in DB_READ: $FINAL records"

rm -f /tmp/market_stats_1m.json

echo "Done!"
