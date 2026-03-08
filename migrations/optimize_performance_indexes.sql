-- Performance optimization indexes
-- Fixes slow queries for /api/v3/funding/rates/latest and /api/v3/funding/ma/latest/all

-- unified_v3: index for funding_time range scan + GROUP BY (used by /rates/latest)
-- Query: WHERE rate_1h_percent IS NOT NULL AND funding_time > ? GROUP BY normalized_symbol, exchange
CREATE INDEX IF NOT EXISTS idx_unified_v3_time_rate
  ON unified_v3(funding_time, normalized_symbol, exchange)
  WHERE rate_1h_percent IS NOT NULL;

-- unified_v3: covering index for the latest-per-symbol-exchange pattern
CREATE INDEX IF NOT EXISTS idx_unified_v3_sym_exch_time
  ON unified_v3(normalized_symbol, exchange, funding_time DESC);

-- funding_ma: covering index for MAX(calculated_at) per symbol/exchange/period JOIN
-- Query: INNER JOIN (SELECT normalized_symbol, exchange, period, MAX(calculated_at) ... GROUP BY ...)
CREATE INDEX IF NOT EXISTS idx_funding_ma_sym_exch_period_calc
  ON funding_ma(normalized_symbol, exchange, period, calculated_at DESC)
  WHERE ma_rate_1h IS NOT NULL;
