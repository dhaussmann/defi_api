#!/bin/bash

# Fetch hourly Lighter funding rates for BTC
# Usage: ./fetch-lighter-hourly.sh [days_back]

DAYS_BACK=${1:-7}  # Default: 7 days

# Calculate timestamps
END_TS=$(date -u +%s)
START_TS=$((END_TS - DAYS_BACK * 86400))

echo "Fetching Lighter BTC funding rates (hourly resolution)"
echo "Period: $(date -u -r $START_TS '+%Y-%m-%d %H:%M:%S') to $(date -u -r $END_TS '+%Y-%m-%d %H:%M:%S')"
echo ""

# BTC market_id = 1
MARKET_ID=1

# Fetch data
curl -s "https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=${MARKET_ID}&resolution=1h&start_timestamp=${START_TS}&end_timestamp=${END_TS}&count_back=0" \
  | jq '{
    total_hours: (.fundings | length),
    period: {
      start: (.fundings[0].timestamp | strftime("%Y-%m-%d %H:%M:%S")),
      end: (.fundings[-1].timestamp | strftime("%Y-%m-%d %H:%M:%S"))
    },
    statistics: {
      avg_rate: ([.fundings[].rate | tonumber] | add / length),
      min_rate: ([.fundings[].rate | tonumber] | min),
      max_rate: ([.fundings[].rate | tonumber] | max),
      avg_apr: ([.fundings[].rate | tonumber] | add / length * 24 * 365)
    },
    latest_10: .fundings[-10:] | map({
      time: (.timestamp | strftime("%Y-%m-%d %H:%M")),
      rate: .rate,
      direction: .direction,
      apr: ((.rate | tonumber) * 24 * 365 | tostring + "%")
    })
  }'

echo ""
echo "Note: Rates are in decimal format (0.0001 = 0.01% per hour)"
echo "APR = rate × 24 × 365"
