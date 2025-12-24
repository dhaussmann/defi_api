-- Migration: Add Extended Exchange Tracker
-- This migration initializes the tracker_status table entry for Extended

INSERT OR IGNORE INTO tracker_status (exchange, status) VALUES ('extended', 'initialized');
