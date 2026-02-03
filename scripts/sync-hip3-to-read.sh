#!/bin/bash

# Sync HIP-3 DEX data from DB_WRITE to DB_READ
# Syncs last 30 days of data for flx, vntl, km exchanges

set -e

CURRENT_TIME=$(date +%s)
START_TS=$(( CURRENT_TIME - 30 * 24 * 60 * 60 ))  # 30 days ago
END_TS=$CURRENT_TIME

echo "=== Sync HIP-3 DEX Data to DB_READ ==="
echo ""
echo "Time range: $(date -u -r $START_TS +%Y-%m-%d) to $(date -u +%Y-%m-%d)"
echo ""

# Count records to sync
TOTAL=$(npx wrangler d1 execute defiapi-db-write --remote --command "SELECT COUNT(*) as count FROM market_history WHERE exchange IN ('flx', 'vntl', 'km') AND hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS" --json | jq '.[0].results[0].count')

echo "✓ Found $TOTAL records to sync"
echo ""

if [ "$TOTAL" -eq 0 ]; then
  echo "No data to sync"
  exit 0
fi

BATCH_SIZE=5000
BATCHES=$(( (TOTAL + BATCH_SIZE - 1) / BATCH_SIZE ))

echo "Processing in $BATCHES batches..."
echo ""

SYNCED=0

for ((BATCH=0; BATCH<BATCHES; BATCH++)); do
  OFFSET=$((BATCH * BATCH_SIZE))
  
  echo "[$((BATCH + 1))/$BATCHES] Batch $((BATCH + 1)) (offset: $OFFSET)..."
  
  TEMP_SQL="/tmp/hip3_sync_${BATCH}.sql"
  
  # Export batch
  npx wrangler d1 execute defiapi-db-write --remote --command "
    SELECT 
      'INSERT OR REPLACE INTO market_history (exchange, symbol, normalized_symbol, hour_timestamp, min_price, max_price, avg_mark_price, avg_index_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, sample_count, aggregated_at) VALUES (' ||
      quote(exchange) || ', ' ||
      quote(symbol) || ', ' ||
      quote(COALESCE(normalized_symbol, symbol)) || ', ' ||
      hour_timestamp || ', ' ||
      COALESCE(min_price, 'NULL') || ', ' ||
      COALESCE(max_price, 'NULL') || ', ' ||
      COALESCE(avg_mark_price, 'NULL') || ', ' ||
      COALESCE(avg_index_price, 'NULL') || ', ' ||
      COALESCE(price_volatility, 0) || ', ' ||
      COALESCE(volume_base, 'NULL') || ', ' ||
      COALESCE(volume_quote, 'NULL') || ', ' ||
      COALESCE(avg_open_interest, 'NULL') || ', ' ||
      COALESCE(avg_open_interest_usd, 'NULL') || ', ' ||
      COALESCE(max_open_interest_usd, 'NULL') || ', ' ||
      COALESCE(avg_funding_rate, 'NULL') || ', ' ||
      COALESCE(avg_funding_rate_annual, 'NULL') || ', ' ||
      COALESCE(min_funding_rate, 'NULL') || ', ' ||
      COALESCE(max_funding_rate, 'NULL') || ', ' ||
      COALESCE(sample_count, 1) || ', ' ||
      COALESCE(aggregated_at, unixepoch('now')) || ');' as sql_statement
    FROM market_history 
    WHERE exchange IN ('flx', 'vntl', 'km') 
      AND hour_timestamp >= $START_TS 
      AND hour_timestamp <= $END_TS
    ORDER BY hour_timestamp, exchange, symbol
    LIMIT $BATCH_SIZE OFFSET $OFFSET
  " --json 2>/dev/null | jq -r '.[0].results[].sql_statement' > "$TEMP_SQL"
  
  BATCH_COUNT=$(wc -l < "$TEMP_SQL" | tr -d ' ')
  
  if [ "$BATCH_COUNT" -eq 0 ]; then
    echo "  ⚠ No more data"
    rm "$TEMP_SQL"
    break
  fi
  
  # Import batch with retry
  RETRY=0
  while [ $RETRY -lt 3 ]; do
    if npx wrangler d1 execute defiapi-db-read --remote --file="$TEMP_SQL" > /dev/null 2>&1; then
      SYNCED=$((SYNCED + BATCH_COUNT))
      echo "  ✓ Synced $BATCH_COUNT records (total: $SYNCED/$TOTAL)"
      rm "$TEMP_SQL"
      break
    else
      RETRY=$((RETRY + 1))
      if [ $RETRY -lt 3 ]; then
        echo "  ⚠ Retry $RETRY/3..."
        sleep 2
      else
        echo "  ❌ Failed after 3 attempts"
        echo "  SQL file saved at: $TEMP_SQL"
        exit 1
      fi
    fi
  done
  
  sleep 1
done

echo ""
echo "=== Sync Complete ==="
echo "Total synced: $SYNCED records"
