-- V4 Unified Market Data — Latest Snapshot Table
-- Stores one row per (symbol, exchange) — replaced on each collection run
-- Time-series history is stored in Analytics Engine (v4_markets dataset)

CREATE TABLE IF NOT EXISTS unified_v4 (
  normalized_symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  collected_at INTEGER NOT NULL,     -- Unix seconds

  -- Funding rate (normalized to APR)
  funding_rate_apr REAL,

  -- Market data (from getMarkets() interface)
  market_price REAL,                 -- Mark price in USD
  open_interest REAL,                -- Open Interest in USD
  max_leverage REAL,                 -- Maximum leverage
  volume_24h REAL,                   -- 24h trading volume in USD
  spread_bid_ask REAL,               -- Bid/ask spread in %
  price_change_24h REAL,             -- 24h price change in %
  market_type TEXT NOT NULL DEFAULT 'crypto',  -- crypto|stock|forex|etf|index|commodity

  -- ONE row per symbol/exchange — updated on each cron run
  PRIMARY KEY (normalized_symbol, exchange)
);

-- Index for market type filtering + APR sorting
CREATE INDEX IF NOT EXISTS idx_unified_v4_type
  ON unified_v4(market_type, funding_rate_apr DESC);

-- Index for freshness checks
CREATE INDEX IF NOT EXISTS idx_unified_v4_collected
  ON unified_v4(collected_at DESC);

-- Index for symbol lookups
CREATE INDEX IF NOT EXISTS idx_unified_v4_symbol
  ON unified_v4(normalized_symbol, exchange);
