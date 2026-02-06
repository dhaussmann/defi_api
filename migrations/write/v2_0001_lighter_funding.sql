-- V2 Schema: Lighter Funding Data
-- Purpose: New data structure for hourly funding rate collection
-- This will eventually replace the current market_history approach

-- Lighter Funding Rates (Hourly Resolution)
CREATE TABLE IF NOT EXISTS lighter_funding_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  market_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  
  -- Timestamp (hourly)
  timestamp INTEGER NOT NULL,
  
  -- Funding Rate Data
  rate REAL NOT NULL,                    -- Raw rate from API (decimal, e.g., 0.0012 = 0.12% per hour)
  rate_hourly REAL NOT NULL,             -- Same as rate (already hourly)
  rate_annual REAL NOT NULL,             -- APR: rate × 24 × 365
  
  -- Direction
  direction TEXT NOT NULL,               -- 'long' or 'short' (who pays)
  
  -- Cumulative Value
  cumulative_value REAL,                 -- Cumulative funding value
  
  -- Metadata
  collected_at INTEGER NOT NULL,         -- When this data was collected
  source TEXT DEFAULT 'api',             -- 'api' or 'import'
  
  -- Constraints
  UNIQUE(market_id, timestamp),
  CHECK(direction IN ('long', 'short'))
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_lighter_funding_v2_symbol_timestamp 
  ON lighter_funding_v2(symbol, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_lighter_funding_v2_market_timestamp 
  ON lighter_funding_v2(market_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_lighter_funding_v2_timestamp 
  ON lighter_funding_v2(timestamp DESC);

-- Market Metadata (for symbol lookups)
CREATE TABLE IF NOT EXISTS lighter_markets_v2 (
  market_id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  last_updated INTEGER NOT NULL,
  
  CHECK(status IN ('active', 'inactive', 'delisted'))
);

-- Index for symbol lookups
CREATE INDEX IF NOT EXISTS idx_lighter_markets_v2_symbol 
  ON lighter_markets_v2(symbol);

-- Tracker Status
CREATE TABLE IF NOT EXISTS lighter_tracker_status_v2 (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Only one row
  last_run INTEGER,
  last_success INTEGER,
  last_error TEXT,
  total_runs INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',
  
  CHECK(status IN ('idle', 'running', 'error'))
);

-- Initialize tracker status
INSERT OR IGNORE INTO lighter_tracker_status_v2 (id, status) VALUES (1, 'idle');

-- Views for easy querying

-- Latest funding rates per market
CREATE VIEW IF NOT EXISTS lighter_funding_latest_v2 AS
SELECT 
  lf.*,
  lm.symbol as market_symbol,
  datetime(lf.timestamp, 'unixepoch') as timestamp_iso
FROM lighter_funding_v2 lf
JOIN lighter_markets_v2 lm ON lf.market_id = lm.market_id
WHERE lf.timestamp = (
  SELECT MAX(timestamp) 
  FROM lighter_funding_v2 
  WHERE market_id = lf.market_id
);

-- Daily statistics per market
CREATE VIEW IF NOT EXISTS lighter_funding_daily_stats_v2 AS
SELECT 
  symbol,
  DATE(timestamp, 'unixepoch') as date,
  AVG(rate_annual) as avg_apr,
  MIN(rate_annual) as min_apr,
  MAX(rate_annual) as max_apr,
  COUNT(*) as sample_count
FROM lighter_funding_v2
GROUP BY symbol, DATE(timestamp, 'unixepoch');

-- Comments
PRAGMA table_info(lighter_funding_v2);
PRAGMA table_info(lighter_markets_v2);
PRAGMA table_info(lighter_tracker_status_v2);
