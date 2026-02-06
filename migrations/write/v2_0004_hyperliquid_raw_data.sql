-- V2 Hyperliquid Raw Data Collection
-- Isolated funding rate data from Hyperliquid
-- 1-hour intervals, stores raw rate and annualized rate

-- Raw funding data table
CREATE TABLE IF NOT EXISTS hyperliquid_raw_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  rate REAL NOT NULL,
  rate_percent REAL NOT NULL,
  rate_annual REAL NOT NULL,
  collected_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  UNIQUE(symbol, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_hyperliquid_raw_symbol ON hyperliquid_raw_data(symbol);
CREATE INDEX IF NOT EXISTS idx_hyperliquid_raw_timestamp ON hyperliquid_raw_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_hyperliquid_raw_symbol_timestamp ON hyperliquid_raw_data(symbol, timestamp);

-- Market metadata table
CREATE TABLE IF NOT EXISTS hyperliquid_markets (
  symbol TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  last_updated INTEGER NOT NULL
);

-- Tracker status table
CREATE TABLE IF NOT EXISTS hyperliquid_tracker_status (
  id INTEGER PRIMARY KEY DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'idle',
  last_run INTEGER,
  last_success INTEGER,
  last_error TEXT,
  total_runs INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  CHECK (id = 1)
);

INSERT OR IGNORE INTO hyperliquid_tracker_status (id, status) VALUES (1, 'idle');

-- View: Latest funding rate per symbol
CREATE VIEW IF NOT EXISTS hyperliquid_latest AS
SELECT 
  h.id,
  h.symbol,
  h.timestamp,
  h.rate,
  h.rate_percent,
  h.rate_annual,
  h.collected_at,
  h.source,
  m.status as market_status,
  datetime(h.timestamp/1000, 'unixepoch') as funding_time
FROM hyperliquid_raw_data h
LEFT JOIN hyperliquid_markets m ON h.symbol = m.symbol
WHERE h.timestamp = (
  SELECT MAX(timestamp)
  FROM hyperliquid_raw_data
  WHERE symbol = h.symbol
)
ORDER BY h.rate_annual DESC;

-- View: Hourly statistics
CREATE VIEW IF NOT EXISTS hyperliquid_hourly_stats AS
SELECT 
  datetime(timestamp/1000, 'unixepoch') as hour,
  COUNT(DISTINCT symbol) as active_markets,
  COUNT(*) as total_records,
  ROUND(AVG(rate_annual), 2) as avg_apr,
  ROUND(MIN(rate_annual), 2) as min_apr,
  ROUND(MAX(rate_annual), 2) as max_apr
FROM hyperliquid_raw_data
GROUP BY datetime(timestamp/1000, 'unixepoch')
ORDER BY timestamp DESC;

-- View: Symbol statistics
CREATE VIEW IF NOT EXISTS hyperliquid_symbol_stats AS
SELECT 
  symbol,
  COUNT(*) as record_count,
  ROUND(AVG(rate_annual), 2) as avg_apr,
  ROUND(MIN(rate_annual), 2) as min_apr,
  ROUND(MAX(rate_annual), 2) as max_apr,
  MIN(datetime(timestamp/1000, 'unixepoch')) as first_record,
  MAX(datetime(timestamp/1000, 'unixepoch')) as last_record
FROM hyperliquid_raw_data
GROUP BY symbol
ORDER BY avg_apr DESC;
