-- Fix avg_funding_rate_annual for Variational in market_history
-- Problem: Old data was calculated with wrong assumption (8h intervals instead of actual intervals)
-- This script recalculates based on the avg_funding_rate

-- For Variational, we need to determine the correct interval
-- Most Variational markets use 1h intervals (24 payments/day)
-- Formula: avg_funding_rate * 24 * 365 * 100

UPDATE market_history
SET avg_funding_rate_annual = avg_funding_rate * 24 * 365 * 100
WHERE exchange = 'variational'
  AND avg_funding_rate IS NOT NULL;

-- Verify the update
SELECT 
  exchange,
  symbol,
  hour_timestamp,
  avg_funding_rate,
  avg_funding_rate_annual,
  sample_count
FROM market_history
WHERE exchange = 'variational'
  AND symbol = 'ZK'
ORDER BY hour_timestamp DESC
LIMIT 5;
