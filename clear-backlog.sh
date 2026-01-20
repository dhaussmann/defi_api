#!/bin/bash
echo "Clearing aggregation backlog..."

for i in {1..5}; do
  echo "Run $i/5..."
  curl -s -X GET "https://defiapi.cloudflareone-demo-account.workers.dev/api/admin/aggregate-1m" | jq -r '.message'
  sleep 2
done

echo ""
echo "Checking remaining backlog..."
npx wrangler d1 execute defiapi-db --remote --command "SELECT COUNT(*) as remaining FROM market_stats WHERE created_at < ($(date +%s) - 300)"

echo ""
echo "Checking market_stats_1m for BTC..."
npx wrangler d1 execute defiapi-db --remote --command "SELECT exchange, COUNT(*) as count FROM market_stats_1m WHERE normalized_symbol = 'BTC' GROUP BY exchange ORDER BY exchange"
