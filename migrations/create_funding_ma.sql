-- Moving Average Table for Cross-Exchange Funding Rates
-- Stores hourly calculated moving averages for different time periods

CREATE TABLE IF NOT EXISTS funding_ma (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  period TEXT NOT NULL, -- '1h', '24h', '3d', '7d', '14d', '30d'
  
  -- Moving Average values
  ma_rate_1h REAL,
  ma_apr REAL,
  
  -- Statistical metrics
  data_points INTEGER NOT NULL,
  std_dev REAL,
  min_rate REAL,
  max_rate REAL,
  
  -- Timestamps
  calculated_at INTEGER NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  
  UNIQUE(normalized_symbol, exchange, period, calculated_at)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_funding_ma_symbol_period ON funding_ma(normalized_symbol, period, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_ma_exchange_period ON funding_ma(exchange, period, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_ma_symbol_exchange ON funding_ma(normalized_symbol, exchange, period);
CREATE INDEX IF NOT EXISTS idx_funding_ma_calculated ON funding_ma(calculated_at DESC);

-- Cross-Exchange aggregated moving averages
CREATE TABLE IF NOT EXISTS funding_ma_cross (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_symbol TEXT NOT NULL,
  period TEXT NOT NULL,
  
  -- Aggregated values across all exchanges
  avg_ma_rate_1h REAL,
  avg_ma_apr REAL,
  weighted_ma_rate_1h REAL, -- weighted by data points
  weighted_ma_apr REAL,
  
  -- Exchange statistics
  exchange_count INTEGER NOT NULL,
  total_data_points INTEGER NOT NULL,
  
  -- Range across exchanges
  min_exchange_ma REAL,
  max_exchange_ma REAL,
  spread REAL, -- max - min
  
  -- Timestamps
  calculated_at INTEGER NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  
  UNIQUE(normalized_symbol, period, calculated_at)
);

-- Indexes for cross-exchange queries
CREATE INDEX IF NOT EXISTS idx_funding_ma_cross_symbol ON funding_ma_cross(normalized_symbol, period, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_ma_cross_calculated ON funding_ma_cross(calculated_at DESC);
