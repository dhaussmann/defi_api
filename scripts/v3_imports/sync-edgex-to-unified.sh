#!/bin/bash

# EdgeX V3 Sync to Unified Table
# ================================
# Syncs imported EdgeX funding rates from DB_WRITE (edgex_funding_v3)
# to DB_UNIFIED (unified_v3) with normalized symbols.
#
# Uses the /debug/sync-imports endpoint which calls syncImportsToUnified()
# from unifiedFundingSync.ts.
#
# Usage:
#   ./sync-edgex-to-unified.sh [DAYS_BACK]
#   Default: Last 30 days

set -e

API_URL="https://api.fundingrate.de"
DB_UNIFIED="defiapi-unified-funding"
DB_WRITE="defiapi-db-write"
REMOTE="--remote"
DAYS_BACK="${1:-30}"

echo "=========================================="
echo "EdgeX V3 Sync to Unified Table"
echo "=========================================="
echo "Days back: $DAYS_BACK"
echo ""

# Check source data in DB_WRITE
echo "[1/4] Checking source data in edgex_funding_v3..."
npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN source = 'import' THEN 1 END) as imported,
    COUNT(CASE WHEN source = 'api' THEN 1 END) as from_api,
    COUNT(DISTINCT symbol) as symbols,
    MIN(datetime(funding_time, 'unixepoch')) as earliest,
    MAX(datetime(funding_time, 'unixepoch')) as latest
  FROM edgex_funding_v3
  WHERE funding_time >= strftime('%s', 'now', '-${DAYS_BACK} days')
" 2>&1 | tail -20

echo ""

# Check existing unified data
echo "[2/4] Checking existing EdgeX data in unified_v3..."
npx wrangler d1 execute "$DB_UNIFIED" $REMOTE --command "
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN source = 'import' THEN 1 END) as imported,
    COUNT(CASE WHEN source = 'api' THEN 1 END) as from_api,
    COUNT(DISTINCT normalized_symbol) as symbols,
    MIN(datetime(funding_time, 'unixepoch')) as earliest,
    MAX(datetime(funding_time, 'unixepoch')) as latest
  FROM unified_v3
  WHERE exchange = 'edgex'
" 2>&1 | tail -20

echo ""

# Trigger sync via API endpoint
echo "[3/4] Triggering sync via /debug/sync-imports..."
echo "  URL: ${API_URL}/debug/sync-imports?exchanges=edgex&days=${DAYS_BACK}"
echo ""

RESPONSE=$(curl -s "${API_URL}/debug/sync-imports?exchanges=edgex&days=${DAYS_BACK}")

# Parse response
SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
MESSAGE=$(echo "$RESPONSE" | jq -r '.message // "unknown"')

if [ "$SUCCESS" = "true" ]; then
  echo "  Sync completed successfully!"
  echo "$RESPONSE" | jq '.'
else
  echo "  Sync failed!"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  
  # If API times out, fall back to direct DB sync
  echo ""
  echo "  API may have timed out. Checking if data was partially synced..."
fi

echo ""

# Verify synced data
echo "[4/4] Verifying unified data after sync..."
npx wrangler d1 execute "$DB_UNIFIED" $REMOTE --command "
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN source = 'import' THEN 1 END) as imported,
    COUNT(CASE WHEN source = 'api' THEN 1 END) as from_api,
    COUNT(DISTINCT normalized_symbol) as symbols,
    MIN(datetime(funding_time, 'unixepoch')) as earliest,
    MAX(datetime(funding_time, 'unixepoch')) as latest
  FROM unified_v3
  WHERE exchange = 'edgex'
" 2>&1 | tail -20

echo ""

# Show sample of synced data
echo "Sample of latest synced EdgeX data:"
npx wrangler d1 execute "$DB_UNIFIED" $REMOTE --command "
  SELECT 
    normalized_symbol,
    original_symbol,
    datetime(funding_time, 'unixepoch') as funding_utc,
    rate_raw_percent,
    rate_1h_percent,
    interval_hours,
    source
  FROM unified_v3
  WHERE exchange = 'edgex'
  ORDER BY funding_time DESC
  LIMIT 10
" 2>&1 | tail -25

echo ""
echo "Sync completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
