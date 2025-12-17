-- Migration: Initial Schema for Crypto Exchange Tracker
-- Created: 2024-12-17

-- Market Statistics Table for Lighter Exchange
CREATE TABLE IF NOT EXISTS market_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL DEFAULT 'lighter',
  symbol TEXT NOT NULL,
  market_id INTEGER NOT NULL,
  index_price TEXT NOT NULL,
  mark_price TEXT NOT NULL,
  open_interest TEXT NOT NULL,
  open_interest_limit TEXT NOT NULL,
  funding_clamp_small TEXT NOT NULL,
  funding_clamp_big TEXT NOT NULL,
  last_trade_price TEXT NOT NULL,
  current_funding_rate TEXT NOT NULL,
  funding_rate TEXT NOT NULL,
  funding_timestamp INTEGER NOT NULL,
  daily_base_token_volume REAL NOT NULL,
  daily_quote_token_volume REAL NOT NULL,
  daily_price_low REAL NOT NULL,
  daily_price_high REAL NOT NULL,
  daily_price_change REAL NOT NULL,
  recorded_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Indexes for efficient querying
CREATE INDEX idx_market_stats_exchange ON market_stats(exchange);
CREATE INDEX idx_market_stats_symbol ON market_stats(symbol);
CREATE INDEX idx_market_stats_recorded_at ON market_stats(recorded_at);
CREATE INDEX idx_market_stats_exchange_symbol ON market_stats(exchange, symbol);
CREATE INDEX idx_market_stats_created_at ON market_stats(created_at);

-- Table for tracking WebSocket connections and status
CREATE TABLE IF NOT EXISTS tracker_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  last_message_at INTEGER,
  error_message TEXT,
  reconnect_count INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Insert initial status for Lighter
INSERT OR IGNORE INTO tracker_status (exchange, status) VALUES ('lighter', 'initialized');
