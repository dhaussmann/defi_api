#!/bin/bash
# Quick test to manually sync aggregations

echo "Testing aggregation sync..."

# Get recent data from DB_WRITE
echo "1. Checking DB_WRITE..."
wrangler d1 execute defiapi-db-write --remote --command "SELECT COUNT(*) as count FROM market_stats_1m WHERE minute_timestamp >= (strftime('%s', 'now') - 3600)"

# Manually copy 100 recent records
echo ""
echo "2. Copying 100 recent records..."
wrangler d1 execute defiapi-db-write --remote --command "SELECT exchange, symbol, minute_timestamp, avg_mark_price, avg_index_price, avg_open_interest_usd, avg_funding_rate, sum_volume, price_low, price_high, price_change, sample_count, created_at FROM market_stats_1m ORDER BY minute_timestamp DESC LIMIT 100" --json | \
jq -r '.[0].results[] | "INSERT OR REPLACE INTO market_stats_1m (exchange, symbol, minute_timestamp, avg_mark_price, avg_index_price, avg_open_interest_usd, avg_funding_rate, sum_volume, price_low, price_high, price_change, sample_count, created_at) VALUES (\"\(.exchange)\", \"\(.symbol)\", \(.minute_timestamp), \(.avg_mark_price), \(.avg_index_price), \(.avg_open_interest_usd), \(.avg_funding_rate), \(.sum_volume), \(.price_low), \(.price_high), \(.price_change), \(.sample_count), \(.created_at));"' | \
wrangler d1 execute defiapi-db-read --remote

echo ""
echo "3. Checking DB_READ..."
wrangler d1 execute defiapi-db-read --remote --command "SELECT COUNT(*) as count FROM market_stats_1m"

echo ""
echo "4. Testing API..."
curl -s "https://api.fundingrate.de/api/data/24h?symbol=BTC" | jq '.success, .error' 2>&1 | head -3

echo ""
echo "Done!"
