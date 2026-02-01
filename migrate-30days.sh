#!/bin/bash
# Migrate last 30 days of historical data from old DB to DB_READ
set -e

echo "🔄 Migrating last 30 days of historical data..."
echo ""

# Calculate timestamps
THIRTY_DAYS_AGO=$(($(date +%s) - 30 * 24 * 60 * 60))
THIRTY_DAYS_AGO_MS=$((THIRTY_DAYS_AGO * 1000))

echo "Timestamp range:"
echo "  30 days ago: $THIRTY_DAYS_AGO ($(date -r $THIRTY_DAYS_AGO))"
echo "  In milliseconds: $THIRTY_DAYS_AGO_MS"
echo ""

# Get counts
echo "Checking data availability in old DB..."
MH_COUNT=$(wrangler d1 execute defiapi-db --remote --command "SELECT COUNT(*) as count FROM market_history WHERE hour_timestamp >= $THIRTY_DAYS_AGO" --json | jq -r '.[0].results[0].count')
FH_COUNT=$(wrangler d1 execute defiapi-db --remote --command "SELECT COUNT(*) as count FROM funding_rate_history WHERE collected_at >= $THIRTY_DAYS_AGO_MS" --json | jq -r '.[0].results[0].count')

echo "  market_history (last 30d): $MH_COUNT records"
echo "  funding_rate_history (last 30d): $FH_COUNT records"
echo ""

# Migrate market_history in batches
echo "📊 Migrating market_history..."
BATCH_SIZE=2000
MH_BATCHES=$(( (MH_COUNT + BATCH_SIZE - 1) / BATCH_SIZE ))

for ((i=0; i<MH_BATCHES && i<10; i++)); do
  OFFSET=$((i * BATCH_SIZE))
  echo -n "  Batch $((i+1))/$MH_BATCHES (offset $OFFSET)... "
  
  wrangler d1 execute defiapi-db --remote --command \
    "SELECT * FROM market_history WHERE hour_timestamp >= $THIRTY_DAYS_AGO ORDER BY hour_timestamp DESC LIMIT $BATCH_SIZE OFFSET $OFFSET" \
    --json > /tmp/mh_batch_$i.json
  
  BATCH_COUNT=$(jq '.[0].results | length' /tmp/mh_batch_$i.json)
  
  if [ "$BATCH_COUNT" -eq 0 ]; then
    echo "no more data"
    break
  fi
  
  jq -r '.[0].results[] | 
    "INSERT OR IGNORE INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES (\"\(.exchange)\", \"\(.symbol)\", \"\(.normalized_symbol)\", \(.avg_mark_price), \(.avg_index_price), \(.min_price), \(.max_price), \(.price_volatility), \(.volume_base), \(.volume_quote), \(.avg_open_interest), \(.avg_open_interest_usd), \(.max_open_interest_usd), \(.avg_funding_rate), \(.avg_funding_rate_annual), \(.min_funding_rate), \(.max_funding_rate), \(.hour_timestamp), \(.sample_count), \(.aggregated_at));"' \
    /tmp/mh_batch_$i.json > /tmp/mh_insert_$i.sql
  
  wrangler d1 execute defiapi-db-read --remote --file=/tmp/mh_insert_$i.sql > /dev/null 2>&1
  
  echo "✓ ($BATCH_COUNT records)"
  rm -f /tmp/mh_batch_$i.json /tmp/mh_insert_$i.sql
  
  sleep 0.3
done

echo ""
echo "💰 Migrating funding_rate_history..."
FH_BATCHES=$(( (FH_COUNT + BATCH_SIZE - 1) / BATCH_SIZE ))

for ((i=0; i<FH_BATCHES && i<10; i++)); do
  OFFSET=$((i * BATCH_SIZE))
  echo -n "  Batch $((i+1))/$FH_BATCHES (offset $OFFSET)... "
  
  wrangler d1 execute defiapi-db --remote --command \
    "SELECT * FROM funding_rate_history WHERE collected_at >= $THIRTY_DAYS_AGO_MS ORDER BY collected_at DESC LIMIT $BATCH_SIZE OFFSET $OFFSET" \
    --json > /tmp/fh_batch_$i.json
  
  BATCH_COUNT=$(jq '.[0].results | length' /tmp/fh_batch_$i.json)
  
  if [ "$BATCH_COUNT" -eq 0 ]; then
    echo "no more data"
    break
  fi
  
  jq -r '.[0].results[] | 
    "INSERT OR IGNORE INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES (\"\(.exchange)\", \"\(.symbol)\", \"\(.trading_pair)\", \(.funding_rate), \(.funding_rate_percent), \(.annualized_rate), \(.collected_at));"' \
    /tmp/fh_batch_$i.json > /tmp/fh_insert_$i.sql
  
  wrangler d1 execute defiapi-db-read --remote --file=/tmp/fh_insert_$i.sql > /dev/null 2>&1
  
  echo "✓ ($BATCH_COUNT records)"
  rm -f /tmp/fh_batch_$i.json /tmp/fh_insert_$i.sql
  
  sleep 0.3
done

echo ""
echo "🔍 Verifying migration..."
wrangler d1 execute defiapi-db-read --remote --command \
  "SELECT 'market_history' as table_name, COUNT(*) as count, MIN(hour_timestamp) as oldest, MAX(hour_timestamp) as newest FROM market_history 
   UNION ALL 
   SELECT 'funding_rate_history', COUNT(*), MIN(collected_at), MAX(collected_at) FROM funding_rate_history"

echo ""
echo "✅ Migration complete!"
echo ""
echo "Note: Limited to first 10 batches (20k records) per table to avoid timeout."
