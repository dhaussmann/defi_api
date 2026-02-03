#!/bin/bash
# Sync missing data from DB_WRITE to DB_READ (Jan 30 - Feb 2, 2026)
# Using SQL dump and restore approach

echo "=== Syncing market_history from DB_WRITE to DB_READ ==="
echo "Period: Jan 30 - Feb 2, 2026"
echo ""

START_TS=1769640000
BATCH_SIZE=1000
OFFSET=0

# Get total count
echo "Counting records to sync..."
TOTAL=$(wrangler d1 execute defiapi-db-write --remote --command "SELECT COUNT(*) as count FROM market_history WHERE hour_timestamp >= $START_TS" --json 2>/dev/null | jq -r '.[0].results[0].count')

echo "Total records: $TOTAL"
echo "Batch size: $BATCH_SIZE"
echo "Estimated batches: $((TOTAL / BATCH_SIZE + 1))"
echo ""

BATCH=1
SUCCESS_COUNT=0

while [ $OFFSET -lt $TOTAL ]; do
    echo -n "Batch $BATCH (offset $OFFSET)... "
    
    # Export batch from DB_WRITE
    wrangler d1 execute defiapi-db-write --remote --command "
        SELECT 
            'INSERT OR REPLACE INTO market_history VALUES (' ||
            quote(exchange) || ',' ||
            quote(symbol) || ',' ||
            hour_timestamp || ',' ||
            COALESCE(min_price, 'NULL') || ',' ||
            COALESCE(max_price, 'NULL') || ',' ||
            COALESCE(mark_price, 'NULL') || ',' ||
            COALESCE(index_price, 'NULL') || ',' ||
            COALESCE(volume_base, 'NULL') || ',' ||
            COALESCE(volume_quote, 'NULL') || ',' ||
            COALESCE(open_interest, 'NULL') || ',' ||
            COALESCE(open_interest_usd, 'NULL') || ',' ||
            COALESCE(max_open_interest_usd, 'NULL') || ',' ||
            COALESCE(avg_funding_rate, 'NULL') || ',' ||
            COALESCE(avg_funding_rate_annual, 'NULL') || ',' ||
            COALESCE(min_funding_rate, 'NULL') || ',' ||
            COALESCE(max_funding_rate, 'NULL') || ',' ||
            COALESCE(sample_count, 'NULL') || ',' ||
            COALESCE(volatility, 0) || ');' as sql_stmt
        FROM market_history 
        WHERE hour_timestamp >= $START_TS
        ORDER BY hour_timestamp, exchange, symbol
        LIMIT $BATCH_SIZE OFFSET $OFFSET
    " --json 2>/dev/null > /tmp/batch_$BATCH.json
    
    # Check if export succeeded
    if [ ! -s /tmp/batch_$BATCH.json ]; then
        echo "FAILED (export)"
        break
    fi
    
    # Extract SQL statements
    jq -r '.[0].results[].sql_stmt' /tmp/batch_$BATCH.json > /tmp/batch_$BATCH.sql
    
    # Check if we have statements
    STMT_COUNT=$(wc -l < /tmp/batch_$BATCH.sql | tr -d ' ')
    if [ "$STMT_COUNT" -eq "0" ]; then
        echo "No more data"
        break
    fi
    
    # Import into DB_READ
    wrangler d1 execute defiapi-db-read --remote --file=/tmp/batch_$BATCH.sql >/dev/null 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✓ $STMT_COUNT records"
        SUCCESS_COUNT=$((SUCCESS_COUNT + STMT_COUNT))
    else
        echo "✗ FAILED (import)"
        break
    fi
    
    OFFSET=$((OFFSET + BATCH_SIZE))
    BATCH=$((BATCH + 1))
    
    # Cleanup temp files
    rm -f /tmp/batch_$((BATCH - 1)).json /tmp/batch_$((BATCH - 1)).sql
    
    # Rate limiting
    sleep 1
done

echo ""
echo "=== Sync Complete ==="
echo "Successfully synced: $SUCCESS_COUNT records"
echo ""

# Verify
echo "Verifying sync..."
VERIFY_COUNT=$(wrangler d1 execute defiapi-db-read --remote --command "SELECT COUNT(*) as count FROM market_history WHERE hour_timestamp >= $START_TS" --json 2>/dev/null | jq -r '.[0].results[0].count')

echo "Records in DB_READ: $VERIFY_COUNT"
echo "Expected: $TOTAL"

if [ "$VERIFY_COUNT" -ge "$SUCCESS_COUNT" ]; then
    echo "✓ Sync successful!"
else
    echo "⚠ Warning: Count mismatch"
fi
