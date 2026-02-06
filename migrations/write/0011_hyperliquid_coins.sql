-- Migration: Create hyperliquid_coins table for tracking active coins
-- This table stores metadata about which coins are actively traded on Hyperliquid

CREATE TABLE IF NOT EXISTS hyperliquid_coins (
  coin TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  last_updated INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hyperliquid_coins_status ON hyperliquid_coins(status);
CREATE INDEX IF NOT EXISTS idx_hyperliquid_coins_updated ON hyperliquid_coins(last_updated);
