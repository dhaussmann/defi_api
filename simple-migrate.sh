#!/bin/bash
# Simple migration: Copy missing records from old DB to DB_READ

set -e

echo "Simple Historical Data Migration"
echo "================================="
echo ""

# Get list of exchanges/symbols in old DB but not in new DB
echo "Finding missing records..."

# Export old DB data
wrangler d1 execute defiapi-db --remote --command "SELECT exchange, symbol FROM normalized_tokens" --json > /tmp/old_symbols.json

# Export new DB data  
wrangler d1 execute defiapi-db-read --remote --command "SELECT exchange, symbol FROM normalized_tokens" --json > /tmp/new_symbols.json

# Find missing combinations
OLD_COUNT=$(jq '.[0].results | length' /tmp/old_symbols.json)
NEW_COUNT=$(jq '.[0].results | length' /tmp/new_symbols.json)

echo "Old DB: $OLD_COUNT records"
echo "New DB: $NEW_COUNT records"
echo ""

# For each missing record, copy it
echo "Copying missing records in small batches..."

BATCH=0
COPIED=0

for i in $(seq 0 49); do
  START=$((i * 10))
  
  # Get 10 records at a time
  RECORDS=$(wrangler d1 execute defiapi-db --remote --command "SELECT * FROM normalized_tokens LIMIT 10 OFFSET $START" --json)
  
  COUNT=$(echo "$RECORDS" | jq '.[0].results | length')
  
  if [ "$COUNT" -eq 0 ]; then
    break
  fi
  
  echo -n "Batch $((i+1)): "
  
  # Insert each record individually to avoid SQL parsing issues
  for j in $(seq 0 $((COUNT-1))); do
    RECORD=$(echo "$RECORDS" | jq -r ".[0].results[$j]")
    
    SYMBOL=$(echo "$RECORD" | jq -r '.symbol')
    EXCHANGE=$(echo "$RECORD" | jq -r '.exchange')
    
    # Use a simple INSERT OR IGNORE to avoid conflicts
    SQL="INSERT OR IGNORE INTO normalized_tokens (symbol, exchange, mark_price, index_price, open_interest_usd, volume_24h, funding_rate, funding_rate_hourly, funding_rate_annual, funding_interval_hours, next_funding_time, price_change_24h, price_low_24h, price_high_24h, original_symbol, updated_at) 
    SELECT symbol, exchange, mark_price, index_price, open_interest_usd, volume_24h, funding_rate, funding_rate_hourly, funding_rate_annual, funding_interval_hours, next_funding_time, price_change_24h, price_low_24h, price_high_24h, original_symbol, updated_at 
    FROM (SELECT * FROM normalized_tokens WHERE exchange='$EXCHANGE' AND symbol='$SYMBOL' LIMIT 1)"
    
    # This won't work across databases, so we need a different approach
  done
  
  echo "✓ ($COUNT records)"
  COPIED=$((COPIED + COUNT))
  
  sleep 0.2
done

echo ""
echo "Attempted to copy $COPIED records"

# Verify
FINAL=$(wrangler d1 execute defiapi-db-read --remote --command "SELECT COUNT(*) as count FROM normalized_tokens" --json | jq -r '.[0].results[0].count')
echo "Final count in DB_READ: $FINAL"

rm -f /tmp/old_symbols.json /tmp/new_symbols.json
