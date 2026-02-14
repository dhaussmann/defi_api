-- V2 Binance Raw Data Collection
-- Isolated funding rate data from Binance
-- Variable intervals (typically 8h), stores raw rate, hourly rate, and annualized rate

-- Raw funding data table
CREATE TABLE IF NOT EXISTS binance_raw_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  rate REAL NOT NULL,
  rate_percent REAL NOT NULL,
  rate_hourly REAL NOT NULL,
  rate_annual REAL NOT NULL,
  funding_interval_hours INTEGER,
  collected_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  UNIQUE(symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_binance_raw_symbol ON binance_raw_data(symbol);
CREATE INDEX IF NOT EXISTS idx_binance_raw_base_asset ON binance_raw_data(base_asset);
CREATE INDEX IF NOT EXISTS idx_binance_raw_timestamp ON binance_raw_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_binance_raw_symbol_timestamp ON binance_raw_data(symbol, timestamp);

-- Market metadata table
CREATE TABLE IF NOT EXISTS binance_markets (
  symbol TEXT PRIMARY KEY,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'TRADING',
  funding_interval_hours INTEGER,
  last_updated INTEGER NOT NULL
);

-- Tracker status table
CREATE TABLE IF NOT EXISTS binance_tracker_status (
  id INTEGER PRIMARY KEY DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'idle',
  last_run INTEGER,
  last_success INTEGER,
  last_error TEXT,
  total_runs INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  CHECK (id = 1)
);

INSERT OR IGNORE INTO binance_tracker_status (id, status) VALUES (1, 'idle');

-- View: Latest funding rate per symbol
CREATE VIEW IF NOT EXISTS binance_latest AS
SELECT 
  b.id,
  b.symbol,
  b.base_asset,
  b.timestamp,
  b.rate,
  b.rate_percent,
  b.rate_hourly,
  b.rate_annual,
  b.funding_interval_hours,
  b.collected_at,
  b.source,
  m.status as market_status,
  datetime(b.timestamp/1000, 'unixepoch') as funding_time
FROM binance_raw_data b
LEFT JOIN binance_markets m ON b.symbol = m.symbol
WHERE b.timestamp = (
  SELECT MAX(timestamp)
  FROM binance_raw_data
  WHERE symbol = b.symbol
)
ORDER BY b.rate_annual DESC;

-- View: Hourly statistics
CREATE VIEW IF NOT EXISTS binance_hourly_stats AS
SELECT 
  datetime(timestamp/1000, 'unixepoch') as hour,
  COUNT(DISTINCT symbol) as active_markets,
  COUNT(*) as total_records,
  ROUND(AVG(rate_annual), 2) as avg_apr,
  ROUND(MIN(rate_annual), 2) as min_apr,
  ROUND(MAX(rate_annual), 2) as max_apr,
  ROUND(AVG(funding_interval_hours), 1) as avg_interval_hours
FROM binance_raw_data
GROUP BY datetime(timestamp/1000, 'unixepoch')
ORDER BY timestamp DESC;

-- View: Symbol statistics
CREATE VIEW IF NOT EXISTS binance_symbol_stats AS
SELECT 
  symbol,
  base_asset,
  COUNT(*) as record_count,
  ROUND(AVG(rate_annual), 2) as avg_apr,
  ROUND(MIN(rate_annual), 2) as min_apr,
  ROUND(MAX(rate_annual), 2) as max_apr,
  AVG(funding_interval_hours) as avg_interval_hours,
  MIN(datetime(timestamp/1000, 'unixepoch')) as first_record,
  MAX(datetime(timestamp/1000, 'unixepoch')) as last_record
FROM binance_raw_data
GROUP BY symbol, base_asset
ORDER BY avg_apr DESC;
