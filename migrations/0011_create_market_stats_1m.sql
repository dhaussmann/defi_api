-- Migration: 1-Minute Aggregation Table
-- Created: 2025-12-25
-- Purpose: Intermediate aggregation layer to reduce database load
--
-- Data Flow:
-- 15-second snapshots (market_stats) → Aggregated after 5 minutes → Deleted
-- 1-minute aggregates (market_stats_1m) → Aggregated after 1 hour → Deleted
-- Hourly aggregates (market_history) → Kept permanently

CREATE TABLE IF NOT EXISTS market_stats_1m (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Identification
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  normalized_symbol TEXT NOT NULL,

  -- Price Metrics (1-minute aggregation)
  avg_mark_price REAL NOT NULL,
  avg_index_price REAL NOT NULL,
  min_price REAL NOT NULL,
  max_price REAL NOT NULL,
  price_volatility REAL,  -- (max - min) / avg * 100

  -- Volume Metrics (1-minute sum)
  volume_base REAL,
  volume_quote REAL,

  -- Open Interest (1-minute average)
  avg_open_interest REAL,
  avg_open_interest_usd REAL,
  max_open_interest_usd REAL,

  -- Funding Rate (1-minute average)
  avg_funding_rate REAL NOT NULL,
  avg_funding_rate_annual REAL,
  min_funding_rate REAL,
  max_funding_rate REAL,

  -- Metadata
  minute_timestamp INTEGER NOT NULL,  -- Unix timestamp rounded to minute
  sample_count INTEGER NOT NULL,      -- Number of 15s snapshots aggregated (~4)
  created_at INTEGER NOT NULL,        -- When aggregation was performed

  -- Unique constraint: one row per exchange/symbol/minute
  UNIQUE(exchange, symbol, minute_timestamp)
);

-- Indexes for efficient querying
CREATE INDEX idx_market_stats_1m_exchange ON market_stats_1m(exchange);
CREATE INDEX idx_market_stats_1m_symbol ON market_stats_1m(normalized_symbol);
CREATE INDEX idx_market_stats_1m_created_at ON market_stats_1m(created_at);
CREATE INDEX idx_market_stats_1m_minute ON market_stats_1m(minute_timestamp);
CREATE INDEX idx_market_stats_1m_exchange_symbol ON market_stats_1m(exchange, normalized_symbol);
