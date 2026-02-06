#!/bin/bash

# Export Lighter Funding History to SQL
# Fetches hourly funding rates for all active tokens (last 30 days)
# Generates SQL file for import into market_history table

set -e

DAYS_BACK=${1:-30}
OUTPUT_FILE="lighter_history_$(date +%Y%m%d_%H%M%S).sql"
TEMP_DIR="/tmp/lighter_export_$$"

echo "=================================================="
echo "Lighter Funding History Export"
echo "=================================================="
echo "Period: Last ${DAYS_BACK} days"
echo "Output: ${OUTPUT_FILE}"
echo "=================================================="
echo ""

# Create temp directory
mkdir -p "$TEMP_DIR"

# Calculate timestamps
END_TS=$(date -u +%s)
START_TS=$((END_TS - DAYS_BACK * 86400))

echo "Fetching active markets from Lighter..."
MARKETS=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/orderBooks" | jq -r '.order_books[] | select(.status == "active") | "\(.market_id):\(.symbol)"')

if [ -z "$MARKETS" ]; then
  echo "Error: No markets found"
  exit 1
fi

MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "Found ${MARKET_COUNT} active markets"
echo ""

# Initialize SQL file
cat > "$OUTPUT_FILE" << 'EOF'
-- Lighter Funding History Import
-- Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
-- Source: Lighter API (https://mainnet.zklighter.elliot.ai)
-- Resolution: 1 hour
-- Period: Last 30 days

BEGIN TRANSACTION;

-- Create temporary table for import
CREATE TABLE IF NOT EXISTS market_history_import (
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  normalized_symbol TEXT NOT NULL,
  avg_mark_price REAL,
  avg_index_price REAL,
  min_price REAL,
  max_price REAL,
  price_volatility REAL,
  volume_base REAL,
  volume_quote REAL,
  avg_open_interest REAL,
  avg_open_interest_usd REAL,
  max_open_interest_usd REAL,
  avg_funding_rate REAL,
  avg_funding_rate_annual REAL,
  min_funding_rate REAL,
  max_funding_rate REAL,
  hour_timestamp INTEGER NOT NULL,
  sample_count INTEGER DEFAULT 1,
  aggregated_at INTEGER,
  PRIMARY KEY (exchange, symbol, hour_timestamp)
);

EOF

echo "-- Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Process each market
CURRENT=0
TOTAL_RECORDS=0

while IFS=: read -r MARKET_ID SYMBOL; do
  CURRENT=$((CURRENT + 1))
  echo "[${CURRENT}/${MARKET_COUNT}] Processing ${SYMBOL} (market_id: ${MARKET_ID})..."
  
  # Fetch funding data
  FUNDINGS=$(curl -s "https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=${MARKET_ID}&resolution=1h&start_timestamp=${START_TS}&end_timestamp=${END_TS}&count_back=0")
  
  # Check if data exists
  RECORD_COUNT=$(echo "$FUNDINGS" | jq '.fundings | length')
  
  if [ "$RECORD_COUNT" -eq 0 ]; then
    echo "  ⚠️  No data found, skipping..."
    continue
  fi
  
  echo "  ✓ Found ${RECORD_COUNT} hourly records"
  TOTAL_RECORDS=$((TOTAL_RECORDS + RECORD_COUNT))
  
  # Convert to SQL INSERT statements
  echo "$FUNDINGS" | jq -r --arg symbol "$SYMBOL" --arg now "$END_TS" '
    .fundings[] | 
    "INSERT OR REPLACE INTO market_history_import (
      exchange, symbol, normalized_symbol,
      avg_funding_rate, avg_funding_rate_annual,
      hour_timestamp, sample_count, aggregated_at
    ) VALUES (
      \"lighter\",
      \"\($symbol)\",
      \"\($symbol)\",
      \(.rate | tonumber),
      \((.rate | tonumber) * 24 * 365),
      \(.timestamp),
      1,
      \($now)
    );"
  ' >> "$OUTPUT_FILE"
  
  # Rate limiting: small delay between requests
  sleep 0.1
  
done <<< "$MARKETS"

# Finalize SQL file
cat >> "$OUTPUT_FILE" << 'EOF'

-- Copy from temporary table to market_history
INSERT OR REPLACE INTO market_history (
  exchange, symbol, normalized_symbol,
  avg_mark_price, avg_index_price, min_price, max_price, price_volatility,
  volume_base, volume_quote,
  avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
  avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
  hour_timestamp, sample_count, aggregated_at
)
SELECT 
  exchange, symbol, normalized_symbol,
  avg_mark_price, avg_index_price, min_price, max_price, price_volatility,
  volume_base, volume_quote,
  avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
  avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
  hour_timestamp, sample_count, aggregated_at
FROM market_history_import;

-- Cleanup
DROP TABLE market_history_import;

COMMIT;

-- Summary
SELECT 
  'Lighter Import Summary' as info,
  COUNT(*) as total_records,
  COUNT(DISTINCT symbol) as unique_symbols,
  MIN(datetime(hour_timestamp, 'unixepoch')) as earliest_date,
  MAX(datetime(hour_timestamp, 'unixepoch')) as latest_date
FROM market_history
WHERE exchange = 'lighter'
  AND hour_timestamp >= $(date -u -d "30 days ago" +%s 2>/dev/null || date -u -v-30d +%s);
EOF

# Cleanup temp directory
rm -rf "$TEMP_DIR"

echo ""
echo "=================================================="
echo "Export Complete!"
echo "=================================================="
echo "Total records: ${TOTAL_RECORDS}"
echo "Output file: ${OUTPUT_FILE}"
echo "File size: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo ""
echo "To import into database:"
echo "  wrangler d1 execute defiapi-db-write --remote --file=${OUTPUT_FILE}"
echo ""
echo "Or for local testing:"
echo "  sqlite3 test.db < ${OUTPUT_FILE}"
echo "=================================================="
