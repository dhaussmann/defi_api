-- Migration: Add EdgeX Exchange Support
-- Created: 2024-12-19

-- Insert initial status for EdgeX
INSERT OR IGNORE INTO tracker_status (exchange, status) VALUES ('edgex', 'initialized');
