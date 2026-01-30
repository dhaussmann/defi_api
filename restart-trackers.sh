#!/bin/bash

# Restart all trackers after 2-DB migration

API_BASE="https://api.fundingrate.de"

EXCHANGES=(
  "lighter"
  "paradex"
  "hyperliquid"
  "edgex"
  "aster"
  "pacifica"
  "extended"
  "hyena"
  "xyz"
  "flx"
  "vntl"
  "km"
  "variational"
)

echo "Restarting all trackers..."
echo ""

for exchange in "${EXCHANGES[@]}"; do
  echo -n "Restarting $exchange... "
  
  # Stop
  curl -s -X POST "$API_BASE/tracker/$exchange/stop" > /dev/null
  sleep 1
  
  # Start
  RESULT=$(curl -s -X POST "$API_BASE/tracker/$exchange/start")
  STATUS=$(echo "$RESULT" | jq -r '.status' 2>/dev/null || echo "unknown")
  
  if [ "$STATUS" = "running" ]; then
    echo "✓"
  else
    echo "✗ ($STATUS)"
  fi
  
  sleep 1
done

echo ""
echo "All trackers restarted. Check status:"
echo "  curl $API_BASE/api/tracker-status | jq"
