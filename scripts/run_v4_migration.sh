#!/bin/bash
# Drives the V4 migration batch-by-batch from local machine.
# Each /run call processes 5,000 rows. 7.4M rows ≈ 1,480 calls.
# Estimated time at 1 call/2s: ~50 minutes.

WORKER="https://defiapi.cloudflareone-demo-account.workers.dev"
DELAY=3       # seconds between calls — gives D1 time to breathe
STATUS_EVERY=10  # only fetch status every N batches

echo "Starting V4 migration loop..."
echo "Press Ctrl+C to pause. Resume by re-running this script."
echo ""

BATCH=0
STATE="running"
OFFSET=0
TOTAL=0
ELAPSED="0s"
RPS=0

while true; do
  BATCH=$((BATCH + 1))

  curl -s -X POST "$WORKER/api/v4/admin/migrate/run" > /dev/null

  # Only fetch status every STATUS_EVERY batches to reduce KV read rate
  if [ $((BATCH % STATUS_EVERY)) -eq 0 ] || [ "$BATCH" -eq 1 ]; then
    STATUS=$(curl -s "$WORKER/api/v4/admin/migrate/status")
    STATE=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin)['status']; print(d['state'])")
    OFFSET=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin)['status']; print(d['offset'])")
    TOTAL=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin)['status']; print(d['totalMigrated'])")
    ELAPSED=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['elapsed'])")
    RPS=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['rowsPerSec'])")
  fi

  REMAINING=$((7518482 - TOTAL))
  PCT=$(echo "scale=1; $TOTAL * 100 / 7518482" | bc)

  printf "\r[batch %d] %s | offset=%s | migrated=%s | remaining=%s | %s%% | %s | %s rows/s    " \
    "$BATCH" "$STATE" "$OFFSET" "$TOTAL" "$REMAINING" "$PCT" "$ELAPSED" "$RPS"

  if [ "$STATE" = "done" ]; then
    echo ""
    echo "✅ Migration complete! Total migrated: $TOTAL"
    break
  fi

  if [ "$STATE" = "error" ]; then
    echo ""
    ERROR=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin)['status']; print(d.get('error','unknown'))")
    echo "❌ Migration error: $ERROR"
    break
  fi

  sleep $DELAY
done
