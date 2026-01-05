#!/bin/bash

# EdgeX Settlement Interval Analysis Script
# ==========================================
# Analyzes settlement patterns for all EdgeX contracts
# to understand the optimal data collection strategy.

set -e

API_BASE="https://pro.edgex.exchange/api/v1/public"
SAMPLE_SIZE=1000

echo "=========================================="
echo "EdgeX Settlement Interval Analysis"
echo "=========================================="
echo ""

# Get all active contracts
echo "[1/2] Fetching EdgeX contracts..."
METADATA=$(curl -s "$API_BASE/meta/getMetaData")
CONTRACTS=$(echo "$METADATA" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')

CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')
echo "Found $CONTRACT_COUNT active contracts"
echo ""

# Create results file
RESULTS_FILE=$(mktemp)
trap "rm -f $RESULTS_FILE" EXIT

echo "[2/2] Analyzing settlement patterns..."
echo "Sample size: $SAMPLE_SIZE records per contract"
echo ""

CURRENT=0
TOTAL_SETTLEMENTS=0
TOTAL_RECORDS=0

# Header
printf "%-30s %-15s %-10s %-15s\n" "Symbol" "Contract ID" "Settlements" "Interval"
echo "--------------------------------------------------------------------------------"

while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  ((CURRENT++))

  # Fetch sample data
  RESPONSE=$(curl -s "$API_BASE/funding/getFundingRatePage?contractId=$CONTRACT_ID&size=$SAMPLE_SIZE" 2>/dev/null)

  # Check if we got valid data
  if [ -z "$RESPONSE" ] || [ "$(echo "$RESPONSE" | jq -r '.code')" != "SUCCESS" ]; then
    printf "%-30s %-15s %-10s %-15s\n" "$CONTRACT_NAME" "$CONTRACT_ID" "ERROR" "N/A"
    continue
  fi

  # Count total and settlement records
  TOTAL=$(echo "$RESPONSE" | jq '.data.dataList | length')
  SETTLEMENTS=$(echo "$RESPONSE" | jq '.data.dataList | map(select(.isSettlement == true)) | length')

  ((TOTAL_RECORDS += TOTAL))
  ((TOTAL_SETTLEMENTS += SETTLEMENTS))

  # Calculate interval if we have settlements
  if [ "$SETTLEMENTS" -gt 1 ]; then
    # Get timestamps of first few settlements and calculate interval manually
    TIMESTAMPS=$(echo "$RESPONSE" | jq -r '.data.dataList[] | select(.isSettlement == true) | .fundingTimestamp' | head -3)

    # Simple calculation: difference between first two settlements
    TS1=$(echo "$TIMESTAMPS" | sed -n '1p')
    TS2=$(echo "$TIMESTAMPS" | sed -n '2p')

    if [ -n "$TS1" ] && [ -n "$TS2" ]; then
      DIFF=$((TS1 - TS2))
      HOURS=$(echo "scale=1; $DIFF / 1000 / 3600" | bc)
      INTERVAL_FORMATTED="${HOURS} hours"
    else
      INTERVAL_FORMATTED="Calc error"
    fi
  elif [ "$SETTLEMENTS" -eq 1 ]; then
    INTERVAL_FORMATTED="Only 1 found"
  else
    INTERVAL_FORMATTED="None found"
  fi

  # Output result
  printf "%-30s %-15s %-10s %-15s\n" "$CONTRACT_NAME" "$CONTRACT_ID" "$SETTLEMENTS" "$INTERVAL_FORMATTED"

  # Save to results file
  echo "$CONTRACT_NAME|$CONTRACT_ID|$SETTLEMENTS|$INTERVAL_FORMATTED" >> "$RESULTS_FILE"

  # Progress indicator every 10 contracts
  if [ $((CURRENT % 10)) -eq 0 ]; then
    echo "  ... processed $CURRENT/$CONTRACT_COUNT contracts ..."
  fi

  # Small delay to avoid overwhelming the API
  sleep 0.1

done <<< "$CONTRACTS"

echo ""
echo "=========================================="
echo "Summary Statistics"
echo "=========================================="
echo ""

# Calculate overall efficiency
if [ "$TOTAL_RECORDS" -gt 0 ]; then
  EFFICIENCY=$(echo "scale=2; ($TOTAL_SETTLEMENTS / $TOTAL_RECORDS) * 100" | bc)
  SPEEDUP=$(echo "scale=0; $TOTAL_RECORDS / $TOTAL_SETTLEMENTS" | bc)
  echo "Total records analyzed: $TOTAL_RECORDS"
  echo "Total settlement records: $TOTAL_SETTLEMENTS"
  echo "Settlement ratio: $EFFICIENCY%"
  echo "Estimated speedup: ${SPEEDUP}x faster using settlements only"
  echo ""
fi

# Find most common interval
echo "Settlement interval distribution:"
grep -v "None found" "$RESULTS_FILE" | grep -v "Only 1 found" | cut -d'|' -f4 | sort | uniq -c | sort -rn

echo ""
echo "=========================================="
echo "Recommendations"
echo "=========================================="
echo ""

# Calculate the most common interval
MOST_COMMON=$(grep -v "None found" "$RESULTS_FILE" | grep -v "Only 1 found" | cut -d'|' -f4 | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')

if [ -n "$MOST_COMMON" ]; then
  echo "Most common settlement interval: $MOST_COMMON"
  echo ""
  echo "Strategy: Use settlement-only import to reduce data by ~${SPEEDUP}x"
  echo "Expected records per contract per year: ~$(echo "8760 / ${MOST_COMMON% *}" | bc) (vs ~520,000 with all data)"
else
  echo "Unable to determine settlement pattern."
  echo "Some contracts may not have settlements, or API may have changed."
fi

echo ""
echo "Analysis completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=========================================="
