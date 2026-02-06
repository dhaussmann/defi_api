-- Unified Funding Rates Table
-- Konsolidiert alle V3 Funding Rates mit normalisierten Symbolen
-- Ermöglicht Cross-Exchange-Abfragen (z.B. alle BTC Rates über alle Exchanges)

CREATE TABLE IF NOT EXISTS unified_funding_rates (
  -- Primary identifiers
  normalized_symbol TEXT NOT NULL,           -- Normalisiertes Symbol (BTC, ETH, SOL, etc.)
  exchange TEXT NOT NULL,                    -- Quell-Exchange (hyperliquid, paradex, etc.)
  funding_time INTEGER NOT NULL,             -- Unix timestamp (seconds)
  
  -- Original data
  original_symbol TEXT NOT NULL,             -- Original-Symbol aus V3 Tabelle
  base_asset TEXT,                           -- Base Asset (meist = normalized_symbol)
  
  -- Funding rates
  rate_raw REAL NOT NULL,                    -- Raw rate (decimal, z.B. 0.0001)
  rate_raw_percent REAL NOT NULL,            -- Rate in percent (z.B. 0.01%)
  interval_hours REAL NOT NULL,              -- Funding interval (1h, 4h, 8h, 24h)
  rate_1h_percent REAL NOT NULL,             -- Normalisiert auf 1h
  rate_apr REAL,                             -- Annualized rate (APR)
  
  -- Metadata
  collected_at INTEGER NOT NULL,             -- Wann wurde der Datensatz gesammelt
  source TEXT NOT NULL,                      -- Datenquelle (api, import, tracker_export)
  synced_at INTEGER NOT NULL,                -- Wann wurde in unified_funding_rates synchronisiert
  
  -- Composite primary key
  PRIMARY KEY (normalized_symbol, exchange, funding_time)
);

-- Indices für schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_unified_funding_normalized_symbol 
  ON unified_funding_rates(normalized_symbol);

CREATE INDEX IF NOT EXISTS idx_unified_funding_time 
  ON unified_funding_rates(funding_time);

CREATE INDEX IF NOT EXISTS idx_unified_funding_exchange 
  ON unified_funding_rates(exchange);

CREATE INDEX IF NOT EXISTS idx_unified_funding_symbol_time 
  ON unified_funding_rates(normalized_symbol, funding_time);

CREATE INDEX IF NOT EXISTS idx_unified_funding_synced_at 
  ON unified_funding_rates(synced_at);

-- Index für Cross-Exchange-Abfragen (z.B. alle BTC Rates)
CREATE INDEX IF NOT EXISTS idx_unified_funding_symbol_time_exchange 
  ON unified_funding_rates(normalized_symbol, funding_time, exchange);
