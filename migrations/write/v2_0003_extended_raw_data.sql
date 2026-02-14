-- V2: Extended Raw Data Collection (Standalone)
-- Purpose: Separate table for Extended funding data (1h intervals like Lighter)
-- Stores: raw rate, normalized hourly rate (same as raw for 1h), and APR

-- Raw Extended Funding Data (Hourly)
CREATE TABLE IF NOT EXISTS extended_raw_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  symbol TEXT NOT NULL,                  -- e.g., 'BTC-USD'
  base_asset TEXT NOT NULL,              -- e.g., 'BTC'
  
  -- Timestamp (Unix milliseconds from Extended API)
  timestamp INTEGER NOT NULL,
  
  -- Raw Funding Rate Data
  rate REAL NOT NULL,                    -- Raw rate from API (decimal, e.g., 0.0001)
  rate_percent REAL NOT NULL,            -- Rate as percent: rate × 100
  rate_annual REAL NOT NULL,             -- APR: rate × 24 × 365
  
  -- Metadata
  collected_at INTEGER NOT NULL,         -- When this data was collected (Unix seconds)
  source TEXT DEFAULT 'api',             -- 'api' or 'import'
  
  -- Constraints
  UNIQUE(symbol, timestamp),
  CHECK(source IN ('api', 'import'))
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_extended_raw_symbol_time 
  ON extended_raw_data(symbol, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_extended_raw_base_time 
  ON extended_raw_data(base_asset, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_extended_raw_time 
  ON extended_raw_data(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_extended_raw_collected 
  ON extended_raw_data(collected_at DESC);

-- Extended Markets Metadata
CREATE TABLE IF NOT EXISTS extended_markets (
  symbol TEXT PRIMARY KEY,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active',
  last_updated INTEGER NOT NULL,
  
  CHECK(status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_extended_markets_base 
  ON extended_markets(base_asset);

CREATE INDEX IF NOT EXISTS idx_extended_markets_status 
  ON extended_markets(status);

-- Tracker Status
CREATE TABLE IF NOT EXISTS extended_tracker_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_run INTEGER,
  last_success INTEGER,
  last_error TEXT,
  total_runs INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',
  
  CHECK(status IN ('idle', 'running', 'error'))
);

INSERT OR IGNORE INTO extended_tracker_status (id, status) VALUES (1, 'idle');

-- Useful Views

-- Latest rates per market
CREATE VIEW IF NOT EXISTS extended_latest AS
SELECT 
  er.*,
  em.base_asset,
  datetime(er.timestamp / 1000, 'unixepoch') as time_iso
FROM extended_raw_data er
JOIN extended_markets em ON er.symbol = em.symbol
WHERE er.timestamp = (
  SELECT MAX(timestamp) 
  FROM extended_raw_data 
  WHERE symbol = er.symbol
);

-- Daily statistics by base asset
CREATE VIEW IF NOT EXISTS extended_daily_stats AS
SELECT 
  base_asset,
  DATE(timestamp / 1000, 'unixepoch') as date,
  AVG(rate_percent) as avg_rate_percent,
  AVG(rate_annual) as avg_apr,
  MIN(rate_annual) as min_apr,
  MAX(rate_annual) as max_apr,
  COUNT(*) as sample_count
FROM extended_raw_data
GROUP BY base_asset, DATE(timestamp / 1000, 'unixepoch');

-- Recent 24h data
CREATE VIEW IF NOT EXISTS extended_recent_24h AS
SELECT 
  symbol,
  base_asset,
  rate_percent,
  rate_annual,
  datetime(timestamp / 1000, 'unixepoch') as time
FROM extended_raw_data
WHERE timestamp >= (strftime('%s', 'now') - 86400) * 1000
ORDER BY timestamp DESC;
