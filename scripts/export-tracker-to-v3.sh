#!/bin/bash

# Export Tracker Data to V3 Tables
# Exports historical tracker data from market_history to V3 funding tables
# Covers period: 2026-01-30 to 2026-02-05 18:00

set -e

DB_NAME="defiapi-db-write"
END_TIMESTAMP=1770253200  # 2026-02-05 01:00 UTC (18:00 in your timezone was likely meant as 18:00 UTC = 1770264000)
COLLECTED_AT=$(date +%s)

echo "=========================================="
echo "Tracker Data Export to V3 Tables"
echo "=========================================="
echo "Database: $DB_NAME"
echo "End Timestamp: $END_TIMESTAMP ($(date -r $END_TIMESTAMP '+%Y-%m-%d %H:%M:%S'))"
echo "Collected At: $COLLECTED_AT ($(date -r $COLLECTED_AT '+%Y-%m-%d %H:%M:%S'))"
echo ""

# Function to export data for one exchange
export_exchange() {
  local TRACKER_EXCHANGE=$1
  local V3_EXCHANGE=$2
  local V3_TABLE="${V3_EXCHANGE}_funding_v3"
  local INTERVAL_HOURS=$3
  
  echo "----------------------------------------"
  echo "Exporting: $TRACKER_EXCHANGE → $V3_TABLE"
  echo "Interval: ${INTERVAL_HOURS}h"
  
  # Count available records
  AVAILABLE=$(npx wrangler d1 execute $DB_NAME --remote --command="
    SELECT COUNT(*) as count 
    FROM market_history 
    WHERE exchange = '$TRACKER_EXCHANGE' 
      AND hour_timestamp <= $END_TIMESTAMP
      AND sample_count > 0
  " --json | jq -r '.[0].results[0].count')
  
  echo "Available records: $AVAILABLE"
  
  if [ "$AVAILABLE" -eq 0 ]; then
    echo "⚠️  No data found, skipping"
    return
  fi
  
  # Export and insert data
  echo "Inserting data..."
  
  npx wrangler d1 execute $DB_NAME --remote --command="
    INSERT OR IGNORE INTO $V3_TABLE 
    (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, 
     interval_hours, rate_1h_percent, rate_apr, collected_at, source)
    SELECT 
      normalized_symbol as symbol,
      -- Extract base asset
      UPPER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(normalized_symbol,
          '-USD-PERP', ''), '-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')
      ) as base_asset,
      hour_timestamp as funding_time,
      avg_funding_rate as rate_raw,
      avg_funding_rate * 100 as rate_raw_percent,
      $INTERVAL_HOURS as interval_hours,
      (avg_funding_rate * 100) / $INTERVAL_HOURS as rate_1h_percent,
      avg_funding_rate_annual as rate_apr,
      $COLLECTED_AT as collected_at,
      'tracker_export' as source
    FROM market_history
    WHERE exchange = '$TRACKER_EXCHANGE'
      AND hour_timestamp <= $END_TIMESTAMP
      AND sample_count > 0
      AND ABS(avg_funding_rate * 100) <= 10
    ORDER BY hour_timestamp, symbol
  "
  
  # Count inserted records
  INSERTED=$(npx wrangler d1 execute $DB_NAME --remote --command="
    SELECT COUNT(*) as count 
    FROM $V3_TABLE 
    WHERE source = 'tracker_export'
  " --json | jq -r '.[0].results[0].count')
  
  echo "✅ Inserted: $INSERTED records"
  echo ""
}

# Export all exchanges
echo "Starting export for all exchanges..."
echo ""

export_exchange "hyperliquid" "hyperliquid" 8
export_exchange "lighter" "lighter" 1
export_exchange "edgex" "edgex" 4
export_exchange "paradex" "paradex" 8
export_exchange "extended" "extended" 1
export_exchange "variational" "variational" 8
export_exchange "hyena" "hyena" 8
export_exchange "flx" "felix" 8
export_exchange "vntl" "ventuals" 8
export_exchange "xyz" "xyz" 8

echo "=========================================="
echo "Export Summary"
echo "=========================================="

# Generate summary for all V3 tables
for TABLE in hyperliquid_funding_v3 lighter_funding_v3 edgex_funding_v3 paradex_funding_v3 extended_funding_v3 variational_funding_v3 hyena_funding_v3 felix_funding_v3 ventuals_funding_v3 xyz_funding_v3; do
  EXCHANGE=$(echo $TABLE | sed 's/_funding_v3//')
  
  STATS=$(npx wrangler d1 execute $DB_NAME --remote --command="
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN source = 'tracker_export' THEN 1 END) as exported,
      MIN(funding_time) as oldest,
      MAX(funding_time) as newest
    FROM $TABLE
  " --json | jq -r '.[0].results[0] | "\(.total)|\(.exported)|\(.oldest)|\(.newest)"')
  
  IFS='|' read -r TOTAL EXPORTED OLDEST NEWEST <<< "$STATS"
  
  if [ "$EXPORTED" -gt 0 ]; then
    OLDEST_DATE=$(date -r $OLDEST '+%Y-%m-%d %H:%M' 2>/dev/null || echo "N/A")
    NEWEST_DATE=$(date -r $NEWEST '+%Y-%m-%d %H:%M' 2>/dev/null || echo "N/A")
    echo "$EXCHANGE: $TOTAL total ($EXPORTED exported) | $OLDEST_DATE - $NEWEST_DATE"
  fi
done

echo ""
echo "✅ Export completed!"
