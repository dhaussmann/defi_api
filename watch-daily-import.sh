#!/bin/bash
# Monitor daily import progress

LOG_FILE="/Users/dhaussmann/Projects/defi_api/paradex-optimized-import.log"

if [ ! -f "$LOG_FILE" ]; then
  echo "Log file not found: $LOG_FILE"
  exit 1
fi

echo "Monitoring Paradex Daily Import"
echo "================================"
echo ""

while true; do
  clear
  echo "Paradex Daily Import - Live Monitor"
  echo "===================================="
  echo ""
  
  # Show current day being processed
  CURRENT_DAY=$(grep "Processing" "$LOG_FILE" | tail -1)
  if [ -n "$CURRENT_DAY" ]; then
    echo "$CURRENT_DAY"
  else
    echo "Initializing..."
  fi
  
  echo ""
  
  # Count completed days
  COMPLETED=$(grep -c "✓.*records" "$LOG_FILE" 2>/dev/null || echo 0)
  echo "Completed days: $COMPLETED"
  
  # Show last 10 completed days
  echo ""
  echo "Recent completions:"
  grep "✓.*records" "$LOG_FILE" | tail -10
  
  echo ""
  echo "Active processes: $(ps aux | grep -E "fetch_hour|import-paradex-daily" | grep -v grep | wc -l | tr -d ' ')"
  
  echo ""
  echo "Press Ctrl+C to exit"
  echo ""
  echo "Last log update: $(date)"
  
  sleep 5
done
