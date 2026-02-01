-- Add market_history table to DB_WRITE
-- Purpose: Store hourly aggregates locally for MA cache calculation
-- This table will be synced to DB_READ every 5 minutes

CREATE TABLE IF NOT EXISTS market_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Identification
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  normalized_symbol TEXT NOT NULL,

  -- Price Metrics (hourly aggregation)
  avg_mark_price REAL,
  avg_index_price REAL,
  min_price REAL,           -- Lowest price in the hour
  max_price REAL,           -- Highest price in the hour
  price_volatility REAL,    -- Calculated: (max - min) / avg * 100

  -- Volume Metrics (hourly sum)
  volume_base REAL,         -- Sum of base token volume
  volume_quote REAL,        -- Sum of quote token volume (USD)

  -- Open Interest (hourly average)
  avg_open_interest REAL,   -- Average OI in base token
  avg_open_interest_usd REAL, -- Average OI in USD
  max_open_interest_usd REAL, -- Peak OI in the hour

  -- Funding Rate (hourly average)
  avg_funding_rate REAL,
  avg_funding_rate_annual REAL,
  min_funding_rate REAL,
  max_funding_rate REAL,

  -- Metadata
  hour_timestamp INTEGER NOT NULL,  -- Unix timestamp rounded to hour (seconds)
  sample_count INTEGER NOT NULL,    -- Number of records aggregated
  aggregated_at INTEGER NOT NULL,   -- When aggregation was performed

  -- Unique constraint: one row per exchange/symbol/hour
  UNIQUE(exchange, symbol, hour_timestamp)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_market_history_exchange ON market_history(exchange);
CREATE INDEX IF NOT EXISTS idx_market_history_symbol ON market_history(normalized_symbol);
CREATE INDEX IF NOT EXISTS idx_market_history_hour ON market_history(hour_timestamp);
CREATE INDEX IF NOT EXISTS idx_market_history_exchange_symbol ON market_history(exchange, normalized_symbol);
CREATE INDEX IF NOT EXISTS idx_market_history_exchange_hour ON market_history(exchange, hour_timestamp);
CREATE INDEX IF NOT EXISTS idx_market_history_aggregated_at ON market_history(aggregated_at);
