-- Migration: Create funding_rate_history table for historical data
-- This table stores historical funding rate data imported from funding-rate-collector

CREATE TABLE IF NOT EXISTS funding_rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,                -- Exchange name (hyperliquid, lighter, aster, paradex)
  symbol TEXT NOT NULL,                  -- Normalized symbol (e.g., BTC, ETH)
  trading_pair TEXT NOT NULL,            -- Original trading pair (e.g., BTC-PERP, BTCUSDT)
  funding_rate REAL NOT NULL,            -- Funding rate as decimal (e.g., 0.000125)
  funding_rate_percent REAL NOT NULL,    -- Funding rate as percentage (e.g., 0.0125)
  annualized_rate REAL NOT NULL,         -- Annualized funding rate percentage
  collected_at INTEGER NOT NULL,         -- Collection timestamp in milliseconds

  -- Create index for efficient queries
  UNIQUE(exchange, symbol, collected_at)
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_funding_history_time
  ON funding_rate_history(collected_at);

-- Index for symbol lookups
CREATE INDEX IF NOT EXISTS idx_funding_history_symbol_exchange
  ON funding_rate_history(symbol, exchange);
