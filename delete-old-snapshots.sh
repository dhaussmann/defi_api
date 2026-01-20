#!/bin/bash
set -e

DB_NAME="defiapi-db"
REMOTE="--remote"

echo "Deleting old snapshots in batches..."

# Delete in 2-hour batches to avoid CPU limit
OLDEST=1767892603
END_TIME=1767961041  # End of aggregated data

BATCH_START=$OLDEST
BATCH_SIZE=7200  # 2 hours

while [ $BATCH_START -lt $END_TIME ]; do
  BATCH_END=$((BATCH_START + BATCH_SIZE))
  if [ $BATCH_END -gt $END_TIME ]; then
    BATCH_END=$END_TIME
  fi
  
  echo "Deleting: $(date -r $BATCH_START '+%m-%d %H:%M') - $(date -r $BATCH_END '+%m-%d %H:%M')"
  
  npx wrangler d1 execute "$DB_NAME" $REMOTE --command "DELETE FROM market_stats WHERE created_at >= $BATCH_START AND created_at < $BATCH_END" > /dev/null 2>&1
  
  echo "  ✓ Deleted"
  
  BATCH_START=$BATCH_END
  sleep 1
done

echo "Done!"
