-- DB_WRITE Schema: Hot data from trackers
-- Purpose: Receives all tracker writes, aggregation source
-- TTL: Data older than 1 hour gets aggregated and deleted

-- Market Statistics Table - 15-second snapshots
CREATE TABLE IF NOT EXISTS market_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_id TEXT NOT NULL,
  index_price TEXT NOT NULL,
  mark_price TEXT NOT NULL,
  open_interest TEXT NOT NULL,
  open_interest_usd TEXT NOT NULL,
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

-- Indexes optimized for writes and aggregation queries
CREATE INDEX idx_ms_exchange_symbol ON market_stats(exchange, symbol);
CREATE INDEX idx_ms_recorded_at ON market_stats(recorded_at);
CREATE INDEX idx_ms_created_at ON market_stats(created_at);

-- 1-Minute Aggregates
CREATE TABLE IF NOT EXISTS market_stats_1m (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  minute_timestamp INTEGER NOT NULL,
  avg_mark_price REAL NOT NULL,
  avg_index_price REAL NOT NULL,
  avg_open_interest_usd REAL NOT NULL,
  avg_funding_rate REAL NOT NULL,
  sum_volume REAL NOT NULL,
  price_low REAL NOT NULL,
  price_high REAL NOT NULL,
  price_change REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_ms1m_exchange_symbol ON market_stats_1m(exchange, symbol);
CREATE INDEX idx_ms1m_minute ON market_stats_1m(minute_timestamp);
CREATE INDEX idx_ms1m_created_at ON market_stats_1m(created_at);

-- Hourly Aggregates
CREATE TABLE IF NOT EXISTS market_stats_1h (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  hour_timestamp INTEGER NOT NULL,
  avg_mark_price REAL NOT NULL,
  avg_index_price REAL NOT NULL,
  avg_open_interest_usd REAL NOT NULL,
  avg_funding_rate REAL NOT NULL,
  sum_volume REAL NOT NULL,
  price_low REAL NOT NULL,
  price_high REAL NOT NULL,
  price_change REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_ms1h_exchange_symbol ON market_stats_1h(exchange, symbol);
CREATE INDEX idx_ms1h_hour ON market_stats_1h(hour_timestamp);
CREATE INDEX idx_ms1h_created_at ON market_stats_1h(created_at);

-- Tracker Status Table
CREATE TABLE IF NOT EXISTS tracker_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  last_message_at INTEGER,
  error_message TEXT,
  reconnect_count INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Insert initial status for all exchanges
INSERT OR IGNORE INTO tracker_status (exchange, status) VALUES 
  ('lighter', 'initialized'),
  ('paradex', 'initialized'),
  ('hyperliquid', 'initialized'),
  ('edgex', 'initialized'),
  ('aster', 'initialized'),
  ('pacifica', 'initialized'),
  ('extended', 'initialized'),
  ('hyena', 'initialized'),
  ('xyz', 'initialized'),
  ('flx', 'initialized'),
  ('vntl', 'initialized'),
  ('km', 'initialized'),
  ('variational', 'initialized');
