-- V2: Aster Raw Data Collection (Standalone)
-- Purpose: Separate table for Aster funding data with automatic interval detection
-- Stores: raw rate, normalized hourly rate, and APR

-- Raw Aster Funding Data
CREATE TABLE IF NOT EXISTS aster_raw_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  symbol TEXT NOT NULL,                  -- e.g., 'BTCUSDT'
  base_asset TEXT NOT NULL,              -- e.g., 'BTC'
  
  -- Timestamp (funding time, Unix milliseconds from Aster API)
  funding_time INTEGER NOT NULL,
  
  -- Raw Funding Rate Data
  rate_raw REAL NOT NULL,                -- Raw rate from API (decimal, e.g., 0.0001)
  rate_raw_percent REAL NOT NULL,        -- Raw rate as percent: rate_raw × 100
  
  -- Normalized Hourly Rate (for comparison across different intervals)
  rate_hourly REAL NOT NULL,             -- Normalized to 1h: rate_raw_percent / interval_hours
  
  -- APR Calculation
  rate_annual REAL NOT NULL,             -- APR: rate_raw_percent × events_per_year
  
  -- Interval Detection
  interval_hours INTEGER,                -- Detected funding interval (1, 4, 8, etc.)
  events_per_year REAL,                  -- Calculated funding events per year
  
  -- Metadata
  collected_at INTEGER NOT NULL,         -- When this data was collected (Unix seconds)
  source TEXT DEFAULT 'api',             -- 'api' or 'import'
  
  -- Constraints
  UNIQUE(symbol, funding_time),
  CHECK(source IN ('api', 'import'))
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_aster_raw_symbol_time 
  ON aster_raw_data(symbol, funding_time DESC);

CREATE INDEX IF NOT EXISTS idx_aster_raw_base_time 
  ON aster_raw_data(base_asset, funding_time DESC);

CREATE INDEX IF NOT EXISTS idx_aster_raw_time 
  ON aster_raw_data(funding_time DESC);

CREATE INDEX IF NOT EXISTS idx_aster_raw_collected 
  ON aster_raw_data(collected_at DESC);

-- Aster Markets Metadata
CREATE TABLE IF NOT EXISTS aster_markets (
  symbol TEXT PRIMARY KEY,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  status TEXT NOT NULL,
  
  -- Detected interval info (updated during collection)
  detected_interval_hours INTEGER,
  last_interval_update INTEGER,
  
  last_updated INTEGER NOT NULL,
  
  CHECK(status IN ('TRADING', 'INACTIVE'))
);

CREATE INDEX IF NOT EXISTS idx_aster_markets_base 
  ON aster_markets(base_asset);

CREATE INDEX IF NOT EXISTS idx_aster_markets_status 
  ON aster_markets(status);

-- Tracker Status
CREATE TABLE IF NOT EXISTS aster_tracker_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_run INTEGER,
  last_success INTEGER,
  last_error TEXT,
  total_runs INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',
  
  CHECK(status IN ('idle', 'running', 'error'))
);

INSERT OR IGNORE INTO aster_tracker_status (id, status) VALUES (1, 'idle');

-- Useful Views

-- Latest rates per market
CREATE VIEW IF NOT EXISTS aster_latest AS
SELECT 
  ar.*,
  am.base_asset,
  datetime(ar.funding_time / 1000, 'unixepoch') as time_iso,
  ar.interval_hours || 'h' as interval_label
FROM aster_raw_data ar
JOIN aster_markets am ON ar.symbol = am.symbol
WHERE ar.funding_time = (
  SELECT MAX(funding_time) 
  FROM aster_raw_data 
  WHERE symbol = ar.symbol
);

-- Daily statistics by base asset
CREATE VIEW IF NOT EXISTS aster_daily_stats AS
SELECT 
  base_asset,
  DATE(funding_time / 1000, 'unixepoch') as date,
  AVG(rate_hourly) as avg_hourly,
  AVG(rate_annual) as avg_apr,
  MIN(rate_annual) as min_apr,
  MAX(rate_annual) as max_apr,
  COUNT(*) as sample_count,
  AVG(interval_hours) as avg_interval_hours
FROM aster_raw_data
GROUP BY base_asset, DATE(funding_time / 1000, 'unixepoch');

-- Recent 24h data
CREATE VIEW IF NOT EXISTS aster_recent_24h AS
SELECT 
  symbol,
  base_asset,
  rate_raw_percent,
  rate_hourly,
  rate_annual,
  interval_hours,
  datetime(funding_time / 1000, 'unixepoch') as time
FROM aster_raw_data
WHERE funding_time >= (strftime('%s', 'now') - 86400) * 1000
ORDER BY funding_time DESC;

-- Interval distribution (how many markets use which interval)
CREATE VIEW IF NOT EXISTS aster_interval_distribution AS
SELECT 
  interval_hours,
  COUNT(DISTINCT symbol) as market_count,
  GROUP_CONCAT(DISTINCT base_asset) as base_assets
FROM aster_raw_data
WHERE funding_time >= (strftime('%s', 'now') - 86400) * 1000
GROUP BY interval_hours
ORDER BY interval_hours;
