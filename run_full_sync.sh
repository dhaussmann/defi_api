#!/bin/bash
# Full sync of all data from DB_WRITE to DB_READ

START_TS=1769640000
BATCH_SIZE=1000
TOTAL=46431

echo "=== Starting Full Sync ==="
echo "Total records: $TOTAL"
echo "Batch size: $BATCH_SIZE"
echo ""

SYNCED=0
NEXT_START=$START_TS

while [ $SYNCED -lt $TOTAL ]; do
    echo -n "Syncing from timestamp $NEXT_START... "
    
    RESPONSE=$(curl -s -X POST "https://api.fundingrate.de/api/admin/sync-db?start=$NEXT_START&limit=$BATCH_SIZE")
    
    SUCCESS=$(echo $RESPONSE | jq -r '.success')
    if [ "$SUCCESS" != "true" ]; then
        echo "FAILED"
        echo "Error: $(echo $RESPONSE | jq -r '.error')"
        break
    fi
    
    BATCH_SYNCED=$(echo $RESPONSE | jq -r '.synced')
    NEXT_START=$(echo $RESPONSE | jq -r '.nextStart')
    
    SYNCED=$((SYNCED + BATCH_SYNCED))
    echo "✓ $BATCH_SYNCED records (total: $SYNCED/$TOTAL)"
    
    if [ $BATCH_SYNCED -lt $BATCH_SIZE ]; then
        echo "No more data to sync"
        break
    fi
    
    sleep 2
done

echo ""
echo "=== Sync Complete ==="
echo "Total synced: $SYNCED records"

# Verify
echo ""
echo "Verifying..."
COUNT=$(wrangler d1 execute defiapi-db-read --remote --command "SELECT COUNT(*) as count FROM market_history WHERE hour_timestamp >= $START_TS" --json 2>/dev/null | jq -r '.[0].results[0].count')
echo "Records in DB_READ: $COUNT"
echo "Expected: ~$TOTAL"
