#!/bin/bash

# Fetch Paradex funding rates for Jan 9-29, 2026
# Uses parallel requests for maximum speed (1500 req/min limit)

START_S=1767916800  # Jan 9, 2026 00:00:00 UTC
END_S=1769731199    # Jan 29, 2026 23:59:59 UTC
PARALLEL_JOBS=20    # Number of parallel curl processes

echo "=== Paradex Funding Rate Fetcher (Parallel) ==="
echo ""
echo "Period: Jan 9-29, 2026"
echo "Parallel jobs: $PARALLEL_JOBS"
echo ""

# Get all PERP markets
echo "Fetching markets..."
MARKETS=$(curl -s "https://api.prod.paradex.trade/v1/markets" | jq -r '.results[] | select(.asset_kind == "PERP") | .symbol')
MARKET_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')

echo "✓ Found $MARKET_COUNT PERP markets"
echo ""

# Generate hourly timestamps
HOURLY_TIMESTAMPS=()
CURRENT=$START_S
while [ $CURRENT -le $END_S ]; do
  HOURLY_TIMESTAMPS+=($CURRENT)
  CURRENT=$((CURRENT + 3600))
done

HOUR_COUNT=${#HOURLY_TIMESTAMPS[@]}
echo "✓ Generated $HOUR_COUNT hourly timestamps"
echo ""

TEMP_SQL="/tmp/paradex_parallel_$(date +%s).sql"
> "$TEMP_SQL"

TOTAL=0
NUM=0

# Function to fetch data for one market
fetch_market() {
  local MARKET=$1
  local SYMBOL="${MARKET%-USD-PERP}"
  local TEMP_FILE="/tmp/paradex_${MARKET}_$$.sql"
  > "$TEMP_FILE"
  
  local MARKET_TOTAL=0
  local MARKET_ERRORS=0
  
  # Generate timestamps locally (can't export arrays to subshells)
  local CURRENT=$START_S
  local TIMESTAMPS=()
  while [ $CURRENT -le $END_S ]; do
    TIMESTAMPS+=($CURRENT)
    CURRENT=$((CURRENT + 3600))
  done
  
  # Fetch one value per hour
  for TS in "${TIMESTAMPS[@]}"; do
    TS_MS=$((TS * 1000))
    TS_END_MS=$((TS_MS + 60000))
    
    RESPONSE=$(curl -s "https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_at=${TS_MS}&end_at=${TS_END_MS}&page_size=1")
    
    # Check if we have results
    HAS_RESULTS=$(echo "$RESPONSE" | jq -r '.results | length' 2>/dev/null)
    
    if [ "$HAS_RESULTS" -eq 1 ] 2>/dev/null; then
      FUNDING_RATE=$(echo "$RESPONSE" | jq -r '.results[0].funding_rate | tonumber')
      FUNDING_RATE_ANNUAL=$(echo "$RESPONSE" | jq -r ".results[0].funding_rate | tonumber * 365 * 24")
      AGGREGATED_AT=$(date +%s)
      
      echo "INSERT INTO market_history (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, hour_timestamp, sample_count, aggregated_at) VALUES ('paradex', '${MARKET}', '${SYMBOL}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ${FUNDING_RATE}, ${FUNDING_RATE_ANNUAL}, ${FUNDING_RATE}, ${FUNDING_RATE}, ${TS}, 1, ${AGGREGATED_AT});" >> "$TEMP_FILE"
      
      MARKET_TOTAL=$((MARKET_TOTAL + 1))
    else
      MARKET_ERRORS=$((MARKET_ERRORS + 1))
    fi
  done
  
  # Append to main file
  cat "$TEMP_FILE" >> "$TEMP_SQL"
  rm "$TEMP_FILE"
  
  echo "[$MARKET] ✓ $MARKET_TOTAL records ($MARKET_ERRORS errors)"
}

export -f fetch_market
export HOURLY_TIMESTAMPS
export TEMP_SQL
export START_S
export END_S

# Process markets in parallel
echo "$MARKETS" | xargs -P $PARALLEL_JOBS -I {} bash -c 'fetch_market "$@"' _ {}

echo ""
echo "=== Fetch Complete ==="

TOTAL=$(wc -l < "$TEMP_SQL" | tr -d ' ')
echo "Total records: $TOTAL"
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
