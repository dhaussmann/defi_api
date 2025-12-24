-- Migration: Add Hyperliquid Exchange Support
-- Created: 2024-12-19

-- Insert initial status for Hyperliquid
INSERT OR IGNORE INTO tracker_status (exchange, status) VALUES ('hyperliquid', 'initialized');
