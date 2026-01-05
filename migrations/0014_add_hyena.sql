-- Migration: Add HyENA tracker
-- Date: 2026-01-03

-- Add HyENA to tracker_status table
INSERT INTO tracker_status (exchange, status, last_message_at, error_message, reconnect_count, updated_at)
VALUES ('hyena', 'stopped', 0, NULL, 0, strftime('%s', 'now'))
ON CONFLICT(exchange) DO NOTHING;
