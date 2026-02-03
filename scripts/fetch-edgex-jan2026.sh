#!/bin/bash

# Fetch EdgeX funding rates for Jan 9-29, 2026
# Uses pagination to get all historical data per contract

START_MS=1767916800000  # Jan 9, 2026 00:00:00 UTC
END_MS=1769731199000    # Jan 29, 2026 23:59:59 UTC

echo "=== EdgeX Funding Rate Fetcher ==="
echo ""
echo "Period: Jan 9-29, 2026"
echo ""

# Get all active contracts
echo "Fetching contracts..."
CONTRACTS=$(curl -s "https://pro.edgex.exchange/api/v1/public/meta/getMetaData" | jq -r '.data.contractList[] | select(.enableDisplay == true) | "\(.contractId)|\(.contractName)"')
CONTRACT_COUNT=$(echo "$CONTRACTS" | wc -l | tr -d ' ')

echo "✓ Found $CONTRACT_COUNT contracts"
echo ""

TEMP_SQL="/tmp/edgex_import_$(date +%s).sql"
> "$TEMP_SQL"

# Save contracts to temp file to avoid subshell
CONTRACTS_FILE="/tmp/edgex_contracts_$$.txt"
echo "$CONTRACTS" > "$CONTRACTS_FILE"

TOTAL=0
ERRORS=0
NUM=0

# Read from file instead of pipe to avoid subshell
while IFS='|' read -r CONTRACT_ID CONTRACT_NAME; do
  NUM=$((NUM + 1))
  
  printf "[%d/%d] %-20s " "$NUM" "$CONTRACT_COUNT" "$CONTRACT_NAME"
  
  CONTRACT_TOTAL=0
  OFFSET=""
  
  # Pagination loop - EdgeX returns max 100 records per page
  while true; do
    # Build URL with pagination
    if [ -z "$OFFSET" ]; then
      URL="https://pro.edgex.exchange/api/v1/public/funding/getFundingRatePage?contractId=${CONTRACT_ID}&size=100&filterBeginTimeInclusive=${START_MS}&filterEndTimeExclusive=${END_MS}&filterSettlementFundingRate=true"
    else
      URL="https://pro.edgex.exchange/api/v1/public/funding/getFundingRatePage?contractId=${CONTRACT_ID}&size=100&offsetData=${OFFSET}&filterBeginTimeInclusive=${START_MS}&filterEndTimeExclusive=${END_MS}&filterSettlementFundingRate=true"
    fi
    
    # Fetch data
    RESPONSE=$(curl -s "$URL")
    
    # Check if response is valid
    CODE=$(echo "$RESPONSE" | jq -r '.code' 2>/dev/null || echo "PARSE_ERROR")
    
    if [ "$CODE" != "SUCCESS" ]; then
      if [ "$CONTRACT_TOTAL" -eq 0 ]; then
        echo "⚠ Error"
        ERRORS=$((ERRORS + 1))
      fi
      break
    fi
    
    # Get data list
    DATA_LIST=$(echo "$RESPONSE" | jq -c '.data.dataList[]' 2>/dev/null)
    
    if [ -z "$DATA_LIST" ]; then
      if [ "$CONTRACT_TOTAL" -eq 0 ]; then
        echo "⚠ No data"
        ERRORS=$((ERRORS + 1))
      fi
      break
    fi
    
    # Process each funding rate record
    while IFS= read -r RECORD; do
      FUNDING_TIME=$(echo "$RECORD" | jq -r '.fundingTime')
      FUNDING_TS=$((FUNDING_TIME / 1000))
      ORACLE_PRICE=$(echo "$RECORD" | jq -r '.oraclePrice')
      INDEX_PRICE=$(echo "$RECORD" | jq -r '.indexPrice')
      FUNDING_RATE=$(echo "$RECORD" | jq -r '.fundingRate')
      
      # Skip if data is null
      if [ "$ORACLE_PRICE" = "null" ] || [ "$INDEX_PRICE" = "null" ] || [ "$FUNDING_RATE" = "null" ]; then
        continue
      fi
      
      # EdgeX has 4-hour funding intervals (240 minutes)
      # Annual rate = rate * (24/4) * 365 = rate * 6 * 365 = rate * 2190
      FUNDING_ANNUAL=$(echo "$FUNDING_RATE * 2190" | bc -l)
      
      # Normalize symbol (remove USD suffix)
      NORMALIZED_SYMBOL=$(echo "$CONTRACT_NAME" | sed 's/USD$//')
      
      # Create INSERT statement
      echo "INSERT INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('edgex', '${CONTRACT_NAME}', '${NORMALIZED_SYMBOL}', ${ORACLE_PRICE}, ${INDEX_PRICE}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${FUNDING_RATE}, ${FUNDING_ANNUAL}, ${FUNDING_RATE}, ${FUNDING_RATE}, ${FUNDING_TS}, 1, $(date +%s));" >> "$TEMP_SQL"
      
      CONTRACT_TOTAL=$((CONTRACT_TOTAL + 1))
      TOTAL=$((TOTAL + 1))
    done <<< "$DATA_LIST"
    
    # Check for next page
    NEXT_OFFSET=$(echo "$RESPONSE" | jq -r '.data.nextPageOffsetData' 2>/dev/null)
    
    if [ -z "$NEXT_OFFSET" ] || [ "$NEXT_OFFSET" = "null" ] || [ "$NEXT_OFFSET" = "" ]; then
      break
    fi
    
    OFFSET="$NEXT_OFFSET"
    
    # Rate limiting
    sleep 0.1
  done
  
  if [ "$CONTRACT_TOTAL" -gt 0 ]; then
    echo "✓ $CONTRACT_TOTAL records"
  fi
  
  # Rate limiting between contracts
  sleep 0.2
done < "$CONTRACTS_FILE"

# Cleanup temp file
rm "$CONTRACTS_FILE"

echo ""
echo "=== Fetch Complete ==="
echo "Total records: $TOTAL"
echo "Errors: $ERRORS"
echo ""

if [ "$TOTAL" -eq 0 ]; then
  echo "❌ No data to import"
  rm "$TEMP_SQL"
  exit 1
fi

echo "Importing to defiapi-db-write..."
npx wrangler d1 execute defiapi-db-write --file "$TEMP_SQL" --remote

if [ $? -eq 0 ]; then
  echo "✓ Import complete"
  rm "$TEMP_SQL"
else
  echo "❌ Import failed"
  echo "SQL file saved at: $TEMP_SQL"
  exit 1
fi

echo ""
echo "=== Done ==="
