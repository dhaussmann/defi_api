-- Migration: Add volatility metrics to market_stats and market_history
-- Date: 2025-12-30
-- Description: Adds ATR, Bollinger Band Width, and related volatility metrics

-- Add volatility columns to market_stats
ALTER TABLE market_stats ADD COLUMN volatility_24h REAL DEFAULT NULL;
ALTER TABLE market_stats ADD COLUMN volatility_7d REAL DEFAULT NULL;
ALTER TABLE market_stats ADD COLUMN atr_14 REAL DEFAULT NULL;  -- 14-period Average True Range
ALTER TABLE market_stats ADD COLUMN bb_width REAL DEFAULT NULL;  -- Bollinger Band Width %
ALTER TABLE market_stats ADD COLUMN price_std_dev REAL DEFAULT NULL;  -- Standard Deviation

-- Add volatility columns to market_history
ALTER TABLE market_history ADD COLUMN volatility_24h REAL DEFAULT NULL;
ALTER TABLE market_history ADD COLUMN volatility_7d REAL DEFAULT NULL;
ALTER TABLE market_history ADD COLUMN atr_14 REAL DEFAULT NULL;
ALTER TABLE market_history ADD COLUMN bb_width REAL DEFAULT NULL;
ALTER TABLE market_history ADD COLUMN price_std_dev REAL DEFAULT NULL;

-- Add volatility columns to normalized_tokens
ALTER TABLE normalized_tokens ADD COLUMN volatility_24h REAL DEFAULT NULL;
ALTER TABLE normalized_tokens ADD COLUMN volatility_7d REAL DEFAULT NULL;
ALTER TABLE normalized_tokens ADD COLUMN atr_14 REAL DEFAULT NULL;
ALTER TABLE normalized_tokens ADD COLUMN bb_width REAL DEFAULT NULL;

-- Create index for volatility queries
CREATE INDEX IF NOT EXISTS idx_market_stats_volatility
ON market_stats(exchange, symbol, created_at, mark_price);

CREATE INDEX IF NOT EXISTS idx_market_history_volatility
ON market_history(exchange, symbol, timestamp, mark_price);

-- Create materialized view for volatility aggregates (via table)
CREATE TABLE IF NOT EXISTS volatility_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  period TEXT NOT NULL,  -- '1h', '24h', '7d', '30d'
  volatility REAL,       -- Realized volatility (%)
  atr REAL,              -- Average True Range
  bb_width REAL,         -- Bollinger Band Width (%)
  std_dev REAL,          -- Standard Deviation
  high REAL,             -- Period high
  low REAL,              -- Period low
  avg_price REAL,        -- Average price
  calculated_at INTEGER NOT NULL,  -- Unix timestamp
  UNIQUE(exchange, symbol, period)
);

CREATE INDEX IF NOT EXISTS idx_volatility_stats_lookup
ON volatility_stats(exchange, symbol, period);

CREATE INDEX IF NOT EXISTS idx_volatility_stats_time
ON volatility_stats(calculated_at);
