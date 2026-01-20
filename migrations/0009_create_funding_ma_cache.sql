-- Migration: Create table for pre-calculated funding rate moving averages
-- This table stores pre-calculated MAs to avoid expensive real-time calculations

CREATE TABLE IF NOT EXISTS funding_ma_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  timeframe TEXT NOT NULL, -- '24h', '3d', '7d', '14d', '30d'
  avg_funding_rate REAL,
  avg_funding_rate_annual REAL,
  sample_count INTEGER,
  calculated_at INTEGER NOT NULL, -- Unix timestamp when this was calculated
  UNIQUE(normalized_symbol, exchange, timeframe)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_funding_ma_cache_lookup 
  ON funding_ma_cache(normalized_symbol, exchange, timeframe);

-- Index for filtering by exchange
CREATE INDEX IF NOT EXISTS idx_funding_ma_cache_exchange 
  ON funding_ma_cache(exchange);

-- Index for filtering by symbol
CREATE INDEX IF NOT EXISTS idx_funding_ma_cache_symbol 
  ON funding_ma_cache(normalized_symbol);

-- Index for checking staleness
CREATE INDEX IF NOT EXISTS idx_funding_ma_cache_calculated 
  ON funding_ma_cache(calculated_at);
