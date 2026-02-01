-- Add aggregation tables to DB_READ for historical data API access
-- These tables will be populated by copying from DB_WRITE aggregations

-- 1-Minute Aggregates (for recent historical data)
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

CREATE INDEX IF NOT EXISTS idx_ms1m_exchange_symbol ON market_stats_1m(exchange, symbol);
CREATE INDEX IF NOT EXISTS idx_ms1m_minute ON market_stats_1m(minute_timestamp);
CREATE INDEX IF NOT EXISTS idx_ms1m_created_at ON market_stats_1m(created_at);

-- Hourly Aggregates (for historical data)
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

CREATE INDEX IF NOT EXISTS idx_ms1h_exchange_symbol ON market_stats_1h(exchange, symbol);
CREATE INDEX IF NOT EXISTS idx_ms1h_hour ON market_stats_1h(hour_timestamp);
CREATE INDEX IF NOT EXISTS idx_ms1h_created_at ON market_stats_1h(created_at);
