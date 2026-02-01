-- Add historical data tables to DB_READ for API access
-- These tables store long-term aggregated data

-- Funding Rate History Table
CREATE TABLE IF NOT EXISTS funding_rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  trading_pair TEXT NOT NULL,
  funding_rate REAL NOT NULL,
  funding_rate_percent REAL NOT NULL,
  annualized_rate REAL NOT NULL,
  collected_at INTEGER NOT NULL,
  UNIQUE(exchange, symbol, collected_at)
);

CREATE INDEX IF NOT EXISTS idx_funding_history_time ON funding_rate_history(collected_at);
CREATE INDEX IF NOT EXISTS idx_funding_history_symbol_exchange ON funding_rate_history(symbol, exchange);

-- Market History Table (Hourly Aggregates)
CREATE TABLE IF NOT EXISTS market_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  normalized_symbol TEXT NOT NULL,
  avg_mark_price REAL,
  avg_index_price REAL,
  min_price REAL,
  max_price REAL,
  price_volatility REAL,
  volume_base REAL,
  volume_quote REAL,
  avg_open_interest REAL,
  avg_open_interest_usd REAL,
  max_open_interest_usd REAL,
  avg_funding_rate REAL,
  avg_funding_rate_annual REAL,
  min_funding_rate REAL,
  max_funding_rate REAL,
  hour_timestamp INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  aggregated_at INTEGER NOT NULL,
  UNIQUE(exchange, symbol, hour_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_market_history_exchange ON market_history(exchange);
CREATE INDEX IF NOT EXISTS idx_market_history_symbol ON market_history(normalized_symbol);
CREATE INDEX IF NOT EXISTS idx_market_history_hour ON market_history(hour_timestamp);
CREATE INDEX IF NOT EXISTS idx_market_history_exchange_symbol ON market_history(exchange, normalized_symbol);
CREATE INDEX IF NOT EXISTS idx_market_history_exchange_hour ON market_history(exchange, hour_timestamp);
