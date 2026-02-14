-- Arbitrage V3 Table
-- Stores pre-calculated arbitrage opportunities based on Moving Average data

CREATE TABLE IF NOT EXISTS arbitrage_v3 (
  -- Primary identification
  symbol TEXT NOT NULL,
  long_exchange TEXT NOT NULL,
  short_exchange TEXT NOT NULL,
  period TEXT NOT NULL,  -- 1h, 24h, 3d, 7d, 14d, 30d
  
  -- Funding rates (hourly normalized)
  long_rate REAL NOT NULL,      -- MA rate on long exchange (decimal)
  short_rate REAL NOT NULL,     -- MA rate on short exchange (decimal)
  spread REAL NOT NULL,         -- Absolute spread (decimal)
  
  -- APR values
  long_apr REAL NOT NULL,       -- MA APR on long exchange (percentage)
  short_apr REAL NOT NULL,      -- MA APR on short exchange (percentage)
  spread_apr REAL NOT NULL,     -- APR spread (percentage)
  
  -- Stability metrics
  stability_score INTEGER NOT NULL,  -- 0-5 based on consistency across periods
  is_stable INTEGER NOT NULL,        -- 1 if score >= 4, 0 otherwise
  
  -- Metadata
  calculated_at INTEGER NOT NULL,    -- Unix timestamp
  
  -- Composite primary key
  PRIMARY KEY (symbol, long_exchange, short_exchange, period)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_arbitrage_v3_symbol ON arbitrage_v3(symbol);
CREATE INDEX IF NOT EXISTS idx_arbitrage_v3_period ON arbitrage_v3(period);
CREATE INDEX IF NOT EXISTS idx_arbitrage_v3_spread_apr ON arbitrage_v3(spread_apr DESC);
CREATE INDEX IF NOT EXISTS idx_arbitrage_v3_stable ON arbitrage_v3(is_stable, spread_apr DESC);
CREATE INDEX IF NOT EXISTS idx_arbitrage_v3_exchanges ON arbitrage_v3(long_exchange, short_exchange);
CREATE INDEX IF NOT EXISTS idx_arbitrage_v3_calculated ON arbitrage_v3(calculated_at);
