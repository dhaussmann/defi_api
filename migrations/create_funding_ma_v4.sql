-- V4 Moving Average table in DB_V4 (defiapi-v4-markets)
-- Latest MA per (symbol, exchange, period) — one row per combination
-- History stored in Analytics Engine v4_ma dataset

CREATE TABLE IF NOT EXISTS funding_ma_v4 (
  normalized_symbol TEXT NOT NULL,
  exchange          TEXT NOT NULL,  -- exchange name or '_all' for cross-exchange aggregate
  period            TEXT NOT NULL,  -- '1h','4h','8h','12h','1d','3d','7d','30d'
  ma_apr            REAL,           -- moving average of funding_rate_apr
  data_points       INTEGER NOT NULL,
  period_start      INTEGER NOT NULL, -- unix seconds: oldest data point included
  calculated_at     INTEGER NOT NULL, -- unix seconds: when this MA was last calculated
  PRIMARY KEY (normalized_symbol, exchange, period)
);

CREATE INDEX IF NOT EXISTS idx_ma_v4_symbol_period
  ON funding_ma_v4(normalized_symbol, period);
CREATE INDEX IF NOT EXISTS idx_ma_v4_period_apr
  ON funding_ma_v4(period, ma_apr DESC);
CREATE INDEX IF NOT EXISTS idx_ma_v4_calculated
  ON funding_ma_v4(calculated_at DESC);
