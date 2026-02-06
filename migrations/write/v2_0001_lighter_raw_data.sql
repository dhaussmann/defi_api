-- V2: Lighter Raw Data Collection (Standalone)
-- Purpose: Separate table for Lighter funding data, not integrated with existing tables
-- This is a parallel data collection system that will eventually replace V1

-- Raw Lighter Funding Data (Hourly)
CREATE TABLE IF NOT EXISTS lighter_raw_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  market_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  
  -- Timestamp (hourly, Unix seconds)
  timestamp INTEGER NOT NULL,
  
  -- Raw Funding Rate Data
  rate REAL NOT NULL,                    -- Raw rate from API (e.g., 0.0012 = 0.12% per hour)
  rate_annual REAL NOT NULL,             -- APR: rate × 24 × 365
  
  -- Direction (who pays)
  direction TEXT NOT NULL,               -- 'long' or 'short'
  
  -- Cumulative Value
  cumulative_value REAL,                 -- Cumulative funding value from API
  
  -- Metadata
  collected_at INTEGER NOT NULL,         -- When this data was collected
  source TEXT DEFAULT 'api',             -- 'api' or 'import'
  
  -- Constraints
  UNIQUE(market_id, timestamp),
  CHECK(direction IN ('long', 'short')),
  CHECK(source IN ('api', 'import'))
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_lighter_raw_symbol_timestamp 
  ON lighter_raw_data(symbol, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_lighter_raw_market_timestamp 
  ON lighter_raw_data(market_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_lighter_raw_timestamp 
  ON lighter_raw_data(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_lighter_raw_collected 
  ON lighter_raw_data(collected_at DESC);

-- Market Metadata
CREATE TABLE IF NOT EXISTS lighter_markets (
  market_id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  last_updated INTEGER NOT NULL,
  
  CHECK(status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_lighter_markets_symbol 
  ON lighter_markets(symbol);

-- Tracker Status
CREATE TABLE IF NOT EXISTS lighter_tracker_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_run INTEGER,
  last_success INTEGER,
  last_error TEXT,
  total_runs INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',
  
  CHECK(status IN ('idle', 'running', 'error'))
);

INSERT OR IGNORE INTO lighter_tracker_status (id, status) VALUES (1, 'idle');

-- Useful Views

-- Latest rates per market
CREATE VIEW IF NOT EXISTS lighter_latest AS
SELECT 
  lr.*,
  lm.symbol as market_symbol,
  datetime(lr.timestamp, 'unixepoch') as time_iso
FROM lighter_raw_data lr
JOIN lighter_markets lm ON lr.market_id = lm.market_id
WHERE lr.timestamp = (
  SELECT MAX(timestamp) 
  FROM lighter_raw_data 
  WHERE market_id = lr.market_id
);

-- Daily statistics
CREATE VIEW IF NOT EXISTS lighter_daily_stats AS
SELECT 
  symbol,
  DATE(timestamp, 'unixepoch') as date,
  AVG(rate_annual) as avg_apr,
  MIN(rate_annual) as min_apr,
  MAX(rate_annual) as max_apr,
  COUNT(*) as sample_count
FROM lighter_raw_data
GROUP BY symbol, DATE(timestamp, 'unixepoch');

-- Hourly statistics (last 24h)
CREATE VIEW IF NOT EXISTS lighter_recent_24h AS
SELECT 
  symbol,
  rate_annual,
  direction,
  datetime(timestamp, 'unixepoch') as time
FROM lighter_raw_data
WHERE timestamp >= strftime('%s', 'now', '-24 hours')
ORDER BY timestamp DESC;
