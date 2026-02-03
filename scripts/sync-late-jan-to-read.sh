#!/bin/bash

# Sync late Jan data (27.01-02.02) from DB_WRITE to DB_READ

DB_WRITE="defiapi-db-write"
DB_READ="defiapi-db-read"
REMOTE="--remote"

START_TS=1769493600  # Jan 27, 2026 07:00:00 UTC
END_TS=1770000000    # Feb 2, 2026 20:00:00 UTC

echo "=========================================="
echo "Sync Late Jan Data: DB_WRITE → DB_READ"
echo "=========================================="
echo "Period: Jan 27 07:00 - Feb 2 20:00, 2026"
echo ""

echo "[1/2] Checking data in DB_WRITE..."
SOURCE_COUNT=$(npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "
SELECT COUNT(*) as cnt FROM market_history 
WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS
" --json 2>/dev/null | jq -r '.[] | .results[0].cnt' || echo "0")
echo "Records to sync: $SOURCE_COUNT"

if [ "$SOURCE_COUNT" -eq 0 ]; then
  echo "No data to sync. Exiting."
  exit 0
fi

echo ""
echo "[2/2] Syncing data in batches..."

BATCH_SIZE=5000
TOTAL_SYNCED=0
BATCH_NUM=0

while [ $TOTAL_SYNCED -lt $SOURCE_COUNT ]; do
  ((BATCH_NUM++))
  OFFSET=$TOTAL_SYNCED
  
  echo "  Batch $BATCH_NUM: Syncing records $OFFSET to $((OFFSET + BATCH_SIZE))..."
  
  # Fetch batch from DB_WRITE
  BATCH_DATA=$(npx wrangler d1 execute "$DB_WRITE" $REMOTE --command "
  SELECT * FROM market_history 
  WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS
  ORDER BY hour_timestamp, exchange, symbol
  LIMIT $BATCH_SIZE OFFSET $OFFSET
  " --json 2>/dev/null)
  
  # Count records in batch
  BATCH_COUNT=$(echo "$BATCH_DATA" | jq -r '.[] | .results | length' || echo "0")
  
  if [ "$BATCH_COUNT" -eq 0 ]; then
    echo "    No more data to sync."
    break
  fi
  
  echo "    Fetched $BATCH_COUNT records from DB_WRITE"
  
  # Create SQL file for batch
  SQL_FILE=$(mktemp)
  
  # Generate INSERT statements
  echo "$BATCH_DATA" | jq -r '.[] | .results[] | 
  "INSERT OR REPLACE INTO market_history (
    exchange, symbol, normalized_symbol, hour_timestamp,
    avg_mark_price, avg_index_price, avg_funding_rate, avg_funding_rate_annual,
    min_price, max_price, price_volatility,
    volume_base, volume_quote,
    avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
    min_funding_rate, max_funding_rate,
    sample_count, aggregated_at
  ) VALUES (
    \"\(.exchange)\", \"\(.symbol)\", \"\(.normalized_symbol)\", \(.hour_timestamp),
    \(.avg_mark_price), \(.avg_index_price), \(.avg_funding_rate), \(.avg_funding_rate_annual),
    \(.min_price), \(.max_price), \(.price_volatility),
    \(.volume_base), \(.volume_quote),
    \(.avg_open_interest), \(.avg_open_interest_usd), \(.max_open_interest_usd),
    \(.min_funding_rate), \(.max_funding_rate),
    \(.sample_count), \(.aggregated_at)
  );"
  ' > "$SQL_FILE"
  
  # Execute batch insert
  if [ -s "$SQL_FILE" ]; then
    npx wrangler d1 execute "$DB_READ" $REMOTE --file="$SQL_FILE" > /dev/null 2>&1
    echo "    ✓ Synced $BATCH_COUNT records to DB_READ"
    ((TOTAL_SYNCED += BATCH_COUNT))
  else
    echo "    ✗ Failed to generate SQL for batch"
    rm -f "$SQL_FILE"
    break
  fi
  
  # Cleanup
  rm -f "$SQL_FILE"
  
  # Small delay to avoid rate limiting
  sleep 2
done

echo ""
echo "=========================================="
echo "Sync Summary"
echo "=========================================="
echo "Total records synced: $TOTAL_SYNCED"
echo "Sync completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""
echo "Verifying sync..."
npx wrangler d1 execute "$DB_READ" $REMOTE --command "
SELECT exchange, COUNT(*) as records, 
       datetime(MIN(hour_timestamp), 'unixepoch') as first_date,
       datetime(MAX(hour_timestamp), 'unixepoch') as last_date
FROM market_history 
WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS
GROUP BY exchange 
ORDER BY exchange
" 2>/dev/null
echo "=========================================="
