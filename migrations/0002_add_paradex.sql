-- Migration: Add Paradex Exchange Support
-- Created: 2024-12-17

-- Insert initial status for Paradex
INSERT OR IGNORE INTO tracker_status (exchange, status) VALUES ('paradex', 'initialized');
