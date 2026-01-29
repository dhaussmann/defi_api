#!/bin/bash

API_BASE="https://api.fundingrate.de"
TRACKER_BASE="$API_BASE/tracker/variational"

echo "=== Variational DEX Tests ==="
echo ""

echo "1. Tracker Status:"
curl -s "$TRACKER_BASE/status" | jq
echo ""

echo "2. Market Count:"
curl -s "$API_BASE/api/markets?exchange=variational" | jq '.meta.count'
echo ""

echo "3. BTC Market:"
curl -s "$API_BASE/api/markets?exchange=variational&symbol=BTC" | jq '.data[0] | {symbol, mark_price, funding_rate_annual, open_interest_usd, volume_24h}'
echo ""

echo "4. Top 5 by Volume:"
curl -s "$API_BASE/api/markets?exchange=variational&limit=500" | jq -r '.data | sort_by(-.volume_24h) | .[:5] | .[] | "\(.symbol): $\(.volume_24h | tonumber | round) vol"'
echo ""

echo "5. Funding Rate Stats:"
curl -s "$API_BASE/api/markets?exchange=variational&limit=500" | jq '.data | map(.funding_rate_annual) | {min: (min | round), avg: ((add/length) | round), max: (max | round)}'
echo ""
