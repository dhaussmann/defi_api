-- Migration: Add Aster Exchange Tracker
-- This migration initializes the tracker_status table entry for Aster
-- and adds required columns for Aster data

-- Add new columns for Aster exchange data
ALTER TABLE market_stats ADD COLUMN open_interest_usd TEXT;
ALTER TABLE market_stats ADD COLUMN next_funding_time TEXT;

-- Initialize tracker status
INSERT OR IGNORE INTO tracker_status (exchange, status) VALUES ('aster', 'initialized');
