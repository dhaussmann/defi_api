-- Migration: Add HIP-3 DEX trackers (XYZ, FLX, VNTL, KM)
-- Date: 2026-01-04

-- Add XYZ (Trade.xyz) to tracker_status table
INSERT INTO tracker_status (exchange, status, last_message_at, error_message, reconnect_count, updated_at)
VALUES ('xyz', 'stopped', 0, NULL, 0, strftime('%s', 'now'))
ON CONFLICT(exchange) DO NOTHING;

-- Add FLX (Felix) to tracker_status table
INSERT INTO tracker_status (exchange, status, last_message_at, error_message, reconnect_count, updated_at)
VALUES ('flx', 'stopped', 0, NULL, 0, strftime('%s', 'now'))
ON CONFLICT(exchange) DO NOTHING;

-- Add VNTL (Ventures) to tracker_status table
INSERT INTO tracker_status (exchange, status, last_message_at, error_message, reconnect_count, updated_at)
VALUES ('vntl', 'stopped', 0, NULL, 0, strftime('%s', 'now'))
ON CONFLICT(exchange) DO NOTHING;

-- Add KM (Kinetiq Markets) to tracker_status table
INSERT INTO tracker_status (exchange, status, last_message_at, error_message, reconnect_count, updated_at)
VALUES ('km', 'stopped', 0, NULL, 0, strftime('%s', 'now'))
ON CONFLICT(exchange) DO NOTHING;
