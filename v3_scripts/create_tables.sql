-- V3 Unified Database Schema
-- Create tables for all 4 exchanges with consistent structure

-- Extended Funding V3
CREATE TABLE IF NOT EXISTS extended_funding_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  symbol TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  
  -- Timestamp (Unix seconds)
  funding_time INTEGER NOT NULL,
  
  -- Raw Funding Rate (as received from API)
  rate_raw REAL NOT NULL,
  rate_raw_percent REAL NOT NULL,
  
  -- Interval Information
  interval_hours INTEGER NOT NULL,
  
  -- Normalized Rates
  rate_1h_percent REAL NOT NULL,
  rate_apr REAL NOT NULL,
  
  -- Metadata
  collected_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  
  -- Constraints
  UNIQUE(symbol, funding_time),
  CHECK(source IN ('api', 'import'))
);

CREATE INDEX IF NOT EXISTS idx_extended_v3_symbol ON extended_funding_v3(symbol);
CREATE INDEX IF NOT EXISTS idx_extended_v3_funding_time ON extended_funding_v3(funding_time);
CREATE INDEX IF NOT EXISTS idx_extended_v3_collected_at ON extended_funding_v3(collected_at);

-- Hyperliquid Funding V3
CREATE TABLE IF NOT EXISTS hyperliquid_funding_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  symbol TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  
  -- Timestamp (Unix seconds)
  funding_time INTEGER NOT NULL,
  
  -- Raw Funding Rate (as received from API)
  rate_raw REAL NOT NULL,
  rate_raw_percent REAL NOT NULL,
  
  -- Interval Information
  interval_hours INTEGER NOT NULL,
  
  -- Normalized Rates
  rate_1h_percent REAL NOT NULL,
  rate_apr REAL NOT NULL,
  
  -- Metadata
  collected_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  
  -- Constraints
  UNIQUE(symbol, funding_time),
  CHECK(source IN ('api', 'import'))
);

CREATE INDEX IF NOT EXISTS idx_hyperliquid_v3_symbol ON hyperliquid_funding_v3(symbol);
CREATE INDEX IF NOT EXISTS idx_hyperliquid_v3_funding_time ON hyperliquid_funding_v3(funding_time);
CREATE INDEX IF NOT EXISTS idx_hyperliquid_v3_collected_at ON hyperliquid_funding_v3(collected_at);

-- Lighter Funding V3
CREATE TABLE IF NOT EXISTS lighter_funding_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  symbol TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  market_id INTEGER NOT NULL,
  
  -- Timestamp (Unix seconds)
  funding_time INTEGER NOT NULL,
  
  -- Raw Funding Rate (as received from API)
  rate_raw REAL NOT NULL,
  rate_raw_percent REAL NOT NULL,
  
  -- Interval Information
  interval_hours INTEGER NOT NULL,
  
  -- Normalized Rates
  rate_1h_percent REAL NOT NULL,
  rate_apr REAL NOT NULL,
  
  -- Lighter-specific fields
  direction TEXT NOT NULL,
  cumulative_value REAL,
  
  -- Metadata
  collected_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  
  -- Constraints
  UNIQUE(symbol, funding_time),
  CHECK(source IN ('api', 'import')),
  CHECK(direction IN ('long', 'short'))
);

CREATE INDEX IF NOT EXISTS idx_lighter_v3_symbol ON lighter_funding_v3(symbol);
CREATE INDEX IF NOT EXISTS idx_lighter_v3_funding_time ON lighter_funding_v3(funding_time);
CREATE INDEX IF NOT EXISTS idx_lighter_v3_collected_at ON lighter_funding_v3(collected_at);

-- Aster Funding V3
CREATE TABLE IF NOT EXISTS aster_funding_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  symbol TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  
  -- Timestamp (Unix seconds)
  funding_time INTEGER NOT NULL,
  
  -- Raw Funding Rate (as received from API)
  rate_raw REAL NOT NULL,
  rate_raw_percent REAL NOT NULL,
  
  -- Interval Information
  interval_hours INTEGER NOT NULL,
  
  -- Normalized Rates
  rate_1h_percent REAL NOT NULL,
  rate_apr REAL NOT NULL,
  
  -- Metadata
  collected_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  
  -- Constraints
  UNIQUE(symbol, funding_time),
  CHECK(source IN ('api', 'import'))
);

CREATE INDEX IF NOT EXISTS idx_aster_v3_symbol ON aster_funding_v3(symbol);
CREATE INDEX IF NOT EXISTS idx_aster_v3_funding_time ON aster_funding_v3(funding_time);
CREATE INDEX IF NOT EXISTS idx_aster_v3_collected_at ON aster_funding_v3(collected_at);
