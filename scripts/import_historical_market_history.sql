-- Import historical market_history data from DB_READ to DB_WRITE
-- This is a one-time migration to populate DB_WRITE with existing historical data
-- 
-- Purpose: Enable 30-day Moving Average calculations immediately
-- Source: DB_READ.market_history (155,193 records, ~30 days)
-- Target: DB_WRITE.market_history (currently empty)
--
-- Note: This script is designed to be run in batches to avoid timeout

-- Step 1: Get data from last 30 days
-- We'll export this from DB_READ and import to DB_WRITE

-- To execute:
-- 1. Export from DB_READ:
--    wrangler d1 execute defiapi-db-read --remote \
--      --command="SELECT * FROM market_history WHERE hour_timestamp >= strftime('%s', 'now', '-30 days')" \
--      --json > market_history_export.json
--
-- 2. Then use a script to convert JSON to INSERT statements
--    (see import_market_history.js)

-- Alternative: Direct copy via API endpoint
-- Create a new admin endpoint that copies data in batches
