#!/bin/bash
# Migrate historical data from old DB (defiapi-db) to new DB_READ (defiapi-db-read)
# Old DB: 519k market_history + 1.8M funding_rate_history records

set -e

echo "🔄 Starting historical data migration from old DB to DB_READ..."
echo ""

# Configuration
OLD_DB="defiapi-db"
NEW_DB="defiapi-db-read"
BATCH_SIZE=5000
TEMP_DIR="/tmp/defi_migration"

mkdir -p "$TEMP_DIR"

# Function to migrate market_history in batches
migrate_market_history() {
  echo "📊 Migrating market_history..."
  
  # Get total count
  TOTAL=$(wrangler d1 execute $OLD_DB --remote --command "SELECT COUNT(*) as count FROM market_history" --json | jq -r '.[0].results[0].count')
  echo "Total records to migrate: $TOTAL"
  
  BATCHES=$(( (TOTAL + BATCH_SIZE - 1) / BATCH_SIZE ))
  echo "Processing in $BATCHES batches of $BATCH_SIZE..."
  echo ""
  
  for ((batch=0; batch<BATCHES; batch++)); do
    OFFSET=$((batch * BATCH_SIZE))
    echo -n "Batch $((batch + 1))/$BATCHES (offset $OFFSET)... "
    
    # Export batch from old DB
    wrangler d1 execute $OLD_DB --remote --command \
      "SELECT * FROM market_history ORDER BY hour_timestamp LIMIT $BATCH_SIZE OFFSET $OFFSET" \
      --json > "$TEMP_DIR/market_history_batch_$batch.json"
    
    # Count records in batch
    BATCH_COUNT=$(jq '.[0].results | length' "$TEMP_DIR/market_history_batch_$batch.json")
    
    if [ "$BATCH_COUNT" -eq 0 ]; then
      echo "No more records"
      break
    fi
    
    # Generate INSERT statements
    jq -r '.[0].results[] | 
      "INSERT OR IGNORE INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES (\"\(.exchange)\", \"\(.symbol)\", \"\(.normalized_symbol)\", \(.avg_mark_price), \(.avg_index_price), \(.min_price), \(.max_price), \(.price_volatility), \(.volume_base), \(.volume_quote), \(.avg_open_interest), \(.avg_open_interest_usd), \(.max_open_interest_usd), \(.avg_funding_rate), \(.avg_funding_rate_annual), \(.min_funding_rate), \(.max_funding_rate), \(.hour_timestamp), \(.sample_count), \(.aggregated_at));"' \
      "$TEMP_DIR/market_history_batch_$batch.json" > "$TEMP_DIR/insert_batch_$batch.sql"
    
    # Execute on new DB
    wrangler d1 execute $NEW_DB --remote --file="$TEMP_DIR/insert_batch_$batch.sql" > /dev/null 2>&1
    
    echo "✓ ($BATCH_COUNT records)"
    
    # Cleanup
    rm -f "$TEMP_DIR/market_history_batch_$batch.json" "$TEMP_DIR/insert_batch_$batch.sql"
    
    # Rate limiting
    sleep 0.5
  done
  
  echo ""
  echo "✅ market_history migration complete"
}

# Function to migrate funding_rate_history in batches
migrate_funding_history() {
  echo ""
  echo "💰 Migrating funding_rate_history..."
  
  # Get total count
  TOTAL=$(wrangler d1 execute $OLD_DB --remote --command "SELECT COUNT(*) as count FROM funding_rate_history" --json | jq -r '.[0].results[0].count')
  echo "Total records to migrate: $TOTAL"
  
  # Limit to recent data (last 30 days) to avoid overwhelming DB
  THIRTY_DAYS_AGO=$(($(date +%s) * 1000 - 30 * 24 * 60 * 60 * 1000))
  
  RECENT_COUNT=$(wrangler d1 execute $OLD_DB --remote --command \
    "SELECT COUNT(*) as count FROM funding_rate_history WHERE collected_at >= $THIRTY_DAYS_AGO" \
    --json | jq -r '.[0].results[0].count')
  
  echo "Recent records (last 30 days): $RECENT_COUNT"
  
  BATCHES=$(( (RECENT_COUNT + BATCH_SIZE - 1) / BATCH_SIZE ))
  echo "Processing in $BATCHES batches of $BATCH_SIZE..."
  echo ""
  
  for ((batch=0; batch<BATCHES; batch++)); do
    OFFSET=$((batch * BATCH_SIZE))
    echo -n "Batch $((batch + 1))/$BATCHES (offset $OFFSET)... "
    
    # Export batch from old DB (only recent data)
    wrangler d1 execute $OLD_DB --remote --command \
      "SELECT * FROM funding_rate_history WHERE collected_at >= $THIRTY_DAYS_AGO ORDER BY collected_at LIMIT $BATCH_SIZE OFFSET $OFFSET" \
      --json > "$TEMP_DIR/funding_history_batch_$batch.json"
    
    # Count records in batch
    BATCH_COUNT=$(jq '.[0].results | length' "$TEMP_DIR/funding_history_batch_$batch.json")
    
    if [ "$BATCH_COUNT" -eq 0 ]; then
      echo "No more records"
      break
    fi
    
    # Generate INSERT statements
    jq -r '.[0].results[] | 
      "INSERT OR IGNORE INTO funding_rate_history (exchange, symbol, trading_pair, funding_rate, funding_rate_percent, annualized_rate, collected_at) VALUES (\"\(.exchange)\", \"\(.symbol)\", \"\(.trading_pair)\", \(.funding_rate), \(.funding_rate_percent), \(.annualized_rate), \(.collected_at));"' \
      "$TEMP_DIR/funding_history_batch_$batch.json" > "$TEMP_DIR/insert_funding_$batch.sql"
    
    # Execute on new DB
    wrangler d1 execute $NEW_DB --remote --file="$TEMP_DIR/insert_funding_$batch.sql" > /dev/null 2>&1
    
    echo "✓ ($BATCH_COUNT records)"
    
    # Cleanup
    rm -f "$TEMP_DIR/funding_history_batch_$batch.json" "$TEMP_DIR/insert_funding_$batch.sql"
    
    # Rate limiting
    sleep 0.5
  done
  
  echo ""
  echo "✅ funding_rate_history migration complete"
}

# Verify function
verify_migration() {
  echo ""
  echo "🔍 Verifying migration..."
  echo ""
  
  echo "Old DB counts:"
  wrangler d1 execute $OLD_DB --remote --command \
    "SELECT 'market_history' as table_name, COUNT(*) as count FROM market_history 
     UNION ALL 
     SELECT 'funding_rate_history', COUNT(*) FROM funding_rate_history"
  
  echo ""
  echo "New DB counts:"
  wrangler d1 execute $NEW_DB --remote --command \
    "SELECT 'market_history' as table_name, COUNT(*) as count FROM market_history 
     UNION ALL 
     SELECT 'funding_rate_history', COUNT(*) FROM funding_rate_history"
  
  echo ""
  echo "✅ Verification complete"
}

# Main execution
echo "Starting migration process..."
echo ""

# Migrate market_history (all data)
migrate_market_history

# Migrate funding_rate_history (last 30 days only)
migrate_funding_history

# Verify
verify_migration

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "🎉 Migration complete!"
echo ""
echo "Note: Only the last 30 days of funding_rate_history were migrated to keep DB size manageable."
