#!/bin/bash
# Monitor 2-DB Architecture Status

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     2-DB Architecture Monitoring                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 1. Check Trackers
echo "1. Tracker Status:"
RUNNING=$(curl -s 'https://api.fundingrate.de/api/tracker-status' 2>/dev/null | jq -r '.data[] | select(.status == "running" or .status == "connected") | .exchange' | wc -l | tr -d ' ')
TOTAL=13
if [ "$RUNNING" -eq "$TOTAL" ]; then
  echo -e "   ${GREEN}✓${NC} All $TOTAL trackers running"
else
  echo -e "   ${YELLOW}⚠${NC} $RUNNING/$TOTAL trackers running"
fi

# 2. Check API
echo ""
echo "2. API Status:"
API_COUNT=$(curl -s 'https://api.fundingrate.de/api/markets?limit=1' 2>/dev/null | jq -r '.data | length')
if [ "$API_COUNT" -gt 0 ]; then
  echo -e "   ${GREEN}✓${NC} API returning data ($API_COUNT markets)"
else
  echo -e "   ${YELLOW}⚠${NC} API returns empty data (waiting for cron job)"
fi

# 3. Check for DB Overload errors
echo ""
echo "3. DB Overload Check:"
ERROR=$(curl -s 'https://api.fundingrate.de/api/markets?limit=100' 2>&1 | grep -i "overload" || echo "")
if [ -z "$ERROR" ]; then
  echo -e "   ${GREEN}✓${NC} No DB overload errors"
else
  echo -e "   ${RED}✗${NC} DB overload detected!"
  echo "   $ERROR"
fi

# 4. Check Variational
echo ""
echo "4. Variational Exchange:"
VAR_STATUS=$(curl -s 'https://api.fundingrate.de/tracker/variational/status' 2>/dev/null | jq -r '.data.running')
if [ "$VAR_STATUS" = "true" ]; then
  echo -e "   ${GREEN}✓${NC} Variational tracker running"
  
  VAR_DATA=$(curl -s 'https://api.fundingrate.de/api/markets?exchange=variational&symbol=BTC' 2>/dev/null | jq -r '.data[0].funding_rate_annual // "null"')
  if [ "$VAR_DATA" != "null" ]; then
    echo -e "   ${GREEN}✓${NC} Variational data available (BTC funding: ${VAR_DATA}%)"
  else
    echo -e "   ${YELLOW}⚠${NC} Variational data not yet in API"
  fi
else
  echo -e "   ${RED}✗${NC} Variational tracker not running"
fi

# 5. Sample Data
echo ""
echo "5. Sample Market Data:"
curl -s 'https://api.fundingrate.de/api/markets?limit=3' 2>/dev/null | jq -r '.data[] | "   \(.exchange)/\(.symbol): $\(.mark_price) (funding: \(.funding_rate_annual)%)"' | head -3

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Next Steps                                             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
if [ "$API_COUNT" -gt 0 ]; then
  echo "✓ System is operational!"
  echo ""
  echo "Monitor for DB overload errors over the next hour:"
  echo "  watch -n 30 './monitor-2db.sh'"
else
  echo "⏳ Waiting for cron job to populate DB_READ"
  echo ""
  echo "The cron job runs every 5 minutes. Check again in a few minutes:"
  echo "  watch -n 60 './monitor-2db.sh'"
fi
echo ""
