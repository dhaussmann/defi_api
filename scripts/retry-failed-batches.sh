#!/bin/bash

# Retry the 13 failed batches from the initial sync
# Failed batches: 5, 16, 21, 23, 24, 27, 36, 37, 41, 44, 45, 46

START_TS=1767916800
END_TS=1769731199
BATCH_SIZE=5000

FAILED_BATCHES=(5 16 21 23 24 27 36 37 41 44 45 46)

echo "=== Retry Failed Batches ==="
echo ""
echo "Retrying ${#FAILED_BATCHES[@]} failed batches..."
echo ""

SUCCESS=0
FAILED=0

for BATCH in "${FAILED_BATCHES[@]}"; do
  OFFSET=$((BATCH * BATCH_SIZE))
  
  echo "[$((SUCCESS + FAILED + 1))/${#FAILED_BATCHES[@]}] Retrying batch $BATCH (offset: $OFFSET)..."
  
  TEMP_SQL="/tmp/retry_batch_${BATCH}.sql"
  
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
    WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS
    ORDER BY hour_timestamp, exchange, symbol
    LIMIT $BATCH_SIZE OFFSET $OFFSET
  " --json 2>/dev/null | jq -r '.[0].results[].sql_statement' > "$TEMP_SQL"
  
  BATCH_COUNT=$(wc -l < "$TEMP_SQL" | tr -d ' ')
  
  if [ "$BATCH_COUNT" -eq 0 ]; then
    echo "  ⚠ No data exported"
    rm "$TEMP_SQL"
    FAILED=$((FAILED + 1))
    continue
  fi
  
  # Import batch with retry logic
  RETRY_COUNT=0
  MAX_RETRIES=3
  
  while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    npx wrangler d1 execute defiapi-db-read --remote --file="$TEMP_SQL" > /dev/null 2>&1
    
    if [ $? -eq 0 ]; then
      echo "  ✓ Synced $BATCH_COUNT records"
      rm "$TEMP_SQL"
      SUCCESS=$((SUCCESS + 1))
      break
    else
      RETRY_COUNT=$((RETRY_COUNT + 1))
      if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        echo "  ⚠ Retry $RETRY_COUNT/$MAX_RETRIES..."
        sleep 2
      else
        echo "  ❌ Failed after $MAX_RETRIES attempts"
        echo "  SQL file saved at: $TEMP_SQL"
        FAILED=$((FAILED + 1))
      fi
    fi
  done
  
  # Delay between batches
  sleep 1
done

echo ""
echo "=== Retry Complete ==="
echo "Success: $SUCCESS"
echo "Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "✅ All failed batches successfully retried!"
else
  echo "⚠ $FAILED batches still failed"
fi
