-- Migration: Optimize indexes for normalized-data API endpoint
-- Purpose: Significantly improve query performance for chart data requests
-- Target: 30-day BTC chart should load in <3 seconds instead of 20 seconds

-- Drop old indexes that are not optimal
DROP INDEX IF EXISTS idx_market_history_exchange;
DROP INDEX IF EXISTS idx_market_history_symbol;
DROP INDEX IF EXISTS idx_market_history_hour;

-- Create composite indexes optimized for normalized-data queries
-- These indexes match the exact query patterns used by the API

-- Primary index for symbol + timestamp range queries (most common pattern)
CREATE INDEX IF NOT EXISTS idx_market_history_symbol_timestamp 
  ON market_history(normalized_symbol, hour_timestamp DESC);

-- Composite index for exchange + symbol + timestamp (filtered queries)
CREATE INDEX IF NOT EXISTS idx_market_history_exchange_symbol_timestamp 
  ON market_history(exchange, normalized_symbol, hour_timestamp DESC);

-- Keep existing indexes that are still useful
-- idx_market_history_exchange_symbol - useful for exchange-specific lookups
-- idx_market_history_exchange_hour - useful for time-based aggregations
-- idx_market_history_aggregated_at - useful for sync operations

-- Optimize market_stats_1m for recent data queries
DROP INDEX IF EXISTS idx_market_stats_1m_exchange;
DROP INDEX IF EXISTS idx_market_stats_1m_symbol;

-- Create composite index for market_stats_1m (recent data < 7 days)
CREATE INDEX IF NOT EXISTS idx_market_stats_1m_symbol_timestamp
  ON market_stats_1m(symbol, minute_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_market_stats_1m_exchange_symbol_timestamp
  ON market_stats_1m(exchange, symbol, minute_timestamp DESC);

-- Analyze tables to update query planner statistics
ANALYZE market_history;
ANALYZE market_stats_1m;
