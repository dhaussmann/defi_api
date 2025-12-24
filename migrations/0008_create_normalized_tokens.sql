-- Migration: Create normalized_tokens table
-- This table stores aggregated token data with normalized symbols for fast lookups
-- Note: Indexes are created programmatically after table creation to avoid CPU timeout

CREATE TABLE IF NOT EXISTS normalized_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,                    -- Normalized symbol (e.g., BTC)
  exchange TEXT NOT NULL,                  -- Exchange name
  mark_price REAL,                         -- Current mark price
  index_price REAL,                        -- Index price
  open_interest_usd REAL,                  -- Open interest in USD
  volume_24h REAL,                         -- 24h volume in USD
  funding_rate REAL,                       -- Current funding rate (8h)
  funding_rate_annual REAL,                -- Annualized funding rate (%)
  next_funding_time INTEGER,               -- Next funding timestamp (milliseconds)
  price_change_24h REAL,                   -- 24h price change (%)
  price_low_24h REAL,                      -- 24h low price
  price_high_24h REAL,                     -- 24h high price
  original_symbol TEXT,                    -- Original symbol from exchange
  updated_at INTEGER NOT NULL,             -- Timestamp (seconds)

  UNIQUE(symbol, exchange)                 -- One entry per token per exchange
);
