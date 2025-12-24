-- Test manual aggregation of old data
-- This aggregates data older than 7 days from market_stats into market_history

-- First, let's see how much data we have to aggregate
SELECT
  COUNT(*) as records_to_aggregate,
  datetime(MIN(created_at), 'unixepoch') as oldest,
  datetime(MAX(created_at), 'unixepoch') as newest
FROM market_stats
WHERE created_at < (strftime('%s', 'now') - (7 * 24 * 60 * 60));
