#!/bin/bash

# Migration script to copy market_history data from old DB to new DB
# Gap period: Jan 2-8, 2026 (timestamps 1767348000 to 1767891600)

START_TS=1767348000
END_TS=1767891600
BATCH_SIZE=1000

echo "Starting migration of market_history data..."
echo "Period: $(date -r $START_TS) to $(date -r $END_TS)"
echo "Total records to migrate: ~133,341"
echo ""

# Get total count
TOTAL=$(wrangler d1 execute defiapi-db --remote --command "SELECT COUNT(*) as count FROM market_history WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS" --json | jq -r '.[0].results[0].count')

echo "Total records: $TOTAL"
echo "Batch size: $BATCH_SIZE"
echo "Estimated batches: $((TOTAL / BATCH_SIZE + 1))"
echo ""

# Export data in batches and import
OFFSET=0
BATCH_NUM=1

while [ $OFFSET -lt $TOTAL ]; do
    echo "Processing batch $BATCH_NUM (offset: $OFFSET)..."
    
    # Export batch from old DB
    wrangler d1 execute defiapi-db --remote --command \
        "SELECT * FROM market_history 
         WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS 
         ORDER BY hour_timestamp, exchange, symbol 
         LIMIT $BATCH_SIZE OFFSET $OFFSET" \
        --json > /tmp/migration_batch_$BATCH_NUM.json
    
    # Parse and create INSERT statements
    cat /tmp/migration_batch_$BATCH_NUM.json | jq -r '.[0].results[] | 
        "INSERT OR IGNORE INTO market_history (
            exchange, symbol, hour_timestamp, 
            min_price, max_price, mark_price, index_price,
            volume_base, volume_quote, open_interest, open_interest_usd, max_open_interest_usd,
            avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
            sample_count, volatility
        ) VALUES (
            \"\(.exchange)\", \"\(.symbol)\", \(.hour_timestamp),
            \(.min_price), \(.max_price), \(.mark_price), \(.index_price),
            \(.volume_base), \(.volume_quote), \(.open_interest), \(.open_interest_usd), \(.max_open_interest_usd),
            \(.avg_funding_rate), \(.avg_funding_rate_annual), \(.min_funding_rate), \(.max_funding_rate),
            \(.sample_count), \(.volatility // 0)
        );"' > /tmp/migration_insert_$BATCH_NUM.sql
    
    # Import into new DB
    wrangler d1 execute defiapi-db-write --remote --file=/tmp/migration_insert_$BATCH_NUM.sql
    
    if [ $? -eq 0 ]; then
        echo "✓ Batch $BATCH_NUM completed successfully"
    else
        echo "✗ Batch $BATCH_NUM failed"
        exit 1
    fi
    
    OFFSET=$((OFFSET + BATCH_SIZE))
    BATCH_NUM=$((BATCH_NUM + 1))
    
    # Small delay to avoid rate limiting
    sleep 2
done

echo ""
echo "Migration completed!"
echo "Verifying..."

# Verify migration
NEW_COUNT=$(wrangler d1 execute defiapi-db-write --remote --command "SELECT COUNT(*) as count FROM market_history WHERE hour_timestamp >= $START_TS AND hour_timestamp <= $END_TS" --json | jq -r '.[0].results[0].count')

echo "Records in new DB: $NEW_COUNT"
echo "Expected: $TOTAL"

if [ "$NEW_COUNT" -eq "$TOTAL" ]; then
    echo "✓ Migration successful!"
else
    echo "⚠ Warning: Record count mismatch"
fi
