-- DB_READ Schema: Optimized for API queries
-- Purpose: Serves all API read requests
-- Updated: Every 5 minutes from market_stats

-- Normalized Tokens Table - Current market data
CREATE TABLE IF NOT EXISTS normalized_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  original_symbol TEXT NOT NULL,
  mark_price REAL NOT NULL,
  index_price REAL NOT NULL,
  open_interest_usd REAL NOT NULL,
  volume_24h REAL NOT NULL,
  funding_rate REAL NOT NULL,
  funding_rate_hourly REAL NOT NULL,
  funding_rate_annual REAL NOT NULL,
  funding_interval_hours INTEGER NOT NULL DEFAULT 1,
  next_funding_time INTEGER,
  price_change_24h REAL NOT NULL DEFAULT 0,
  price_low_24h REAL NOT NULL DEFAULT 0,
  price_high_24h REAL NOT NULL DEFAULT 0,
  volatility_24h REAL,
  volatility_7d REAL,
  atr_14 REAL,
  bb_width REAL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(exchange, symbol)
);

-- Indexes optimized for API queries
CREATE INDEX idx_nt_exchange ON normalized_tokens(exchange);
CREATE INDEX idx_nt_symbol ON normalized_tokens(symbol);
CREATE INDEX idx_nt_exchange_symbol ON normalized_tokens(exchange, symbol);
CREATE INDEX idx_nt_updated_at ON normalized_tokens(updated_at);
CREATE INDEX idx_nt_volume ON normalized_tokens(volume_24h DESC);
CREATE INDEX idx_nt_funding_rate ON normalized_tokens(funding_rate_annual DESC);
