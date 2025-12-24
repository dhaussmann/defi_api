-- Migration: Add Pacifica Exchange Tracker
-- This migration initializes the tracker_status table entry for Pacifica

INSERT OR IGNORE INTO tracker_status (exchange, status) VALUES ('pacifica', 'initialized');
