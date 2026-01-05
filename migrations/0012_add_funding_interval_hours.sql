-- Migration: Add funding_interval_hours to market_stats
-- This allows dynamic funding interval detection per token (especially for Aster)

ALTER TABLE market_stats ADD COLUMN funding_interval_hours INTEGER DEFAULT NULL;

-- Create index for querying by exchange and symbol
CREATE INDEX IF NOT EXISTS idx_market_stats_exchange_symbol_interval
ON market_stats(exchange, symbol, funding_interval_hours);
