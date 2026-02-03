#!/bin/bash

# Cleanup old Variational data in batches to avoid CPU timeout

echo "Cleaning up old Variational data from market_stats..."

# Delete in batches of 10000 rows
for i in {1..100}; do
  echo "Batch $i..."
  wrangler d1 execute defiapi-db --remote --command "DELETE FROM market_stats WHERE exchange = 'variational' AND created_at < 1769974000 LIMIT 10000"
  
  # Simple check - just continue for 100 batches
  sleep 2
done

echo "Cleaning up Variational data from market_stats_1m..."

# Delete market_stats_1m in batches
for i in {1..10}; do
  echo "Batch $i..."
  wrangler d1 execute defiapi-db --remote --command "DELETE FROM market_stats_1m WHERE exchange = 'variational' LIMIT 10000"
  
  sleep 2
done

echo "Cleanup complete!"
echo "Verifying remaining data..."
wrangler d1 execute defiapi-db --remote --command "SELECT COUNT(*) as count FROM market_stats WHERE exchange = 'variational' AND created_at < 1769974000"
wrangler d1 execute defiapi-db --remote --command "SELECT COUNT(*) as count FROM market_stats_1m WHERE exchange = 'variational'"
