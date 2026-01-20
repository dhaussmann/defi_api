#!/bin/bash
# Paradex Daily Parallel Import
# Fetches data day by day with 24 parallel workers (one per hour)
# Each worker fetches 60 minutes of data

START_DATE="2025-12-01"
END_DATE="2026-01-09"
DB_NAME="defiapi-db"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}Paradex Daily Parallel Import${NC}"
echo -e "${BLUE}=========================================${NC}"
echo "Period: $START_DATE to $END_DATE"
echo "Strategy: 24 parallel workers per day (1 per hour)"
echo "Chunk size: 60 minutes (60 records)"
echo ""

# Temp Dir
MAIN_TEMP=$(mktemp -d)
echo "Temp directory: $MAIN_TEMP"

# Hole Markets
echo "Fetching markets..."
MARKETS=$(curl -s "https://api.prod.paradex.trade/v1/markets/summary?market=ALL" | jq -r '.results[] | select(.symbol | endswith("-PERP")) | .symbol' | sort -u)
TOTAL_MARKETS=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "✓ Found $TOTAL_MARKETS markets"
echo ""

# Worker Function - fetches one hour of data for one market
fetch_hour() {
  local MARKET=$1
  local HOUR_START=$2
  local HOUR_END=$3
  local OUTPUT_FILE=$4
  
  local BASE_ASSET=$(echo "$MARKET" | cut -d'-' -f1)
  local RECORDS=0
  
  # Fetch 60 minutes in one call
  local RESPONSE=$(curl -s "https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_at=${HOUR_START}&end_at=${HOUR_END}")
  local COUNT=$(echo "$RESPONSE" | jq '.results | length' 2>/dev/null)
  
  # Validate COUNT
  if [ -z "$COUNT" ] || ! [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    COUNT=0
  fi
  
  if [ "$COUNT" -gt 0 ]; then
    echo "$RESPONSE" | jq -c '.results[]' | while read -r RECORD; do
      local CREATED_AT=$(echo "$RECORD" | jq -r '.created_at')
      local FUNDING_RATE=$(echo "$RECORD" | jq -r '.funding_rate')
      local MARK_PRICE=$(echo "$RECORD" | jq -r '.mark_price // 0')
      local CREATED_AT_SEC=$((CREATED_AT / 1000))
      local NORMALIZED_SYMBOL=$(echo "$BASE_ASSET" | tr '[:lower:]' '[:upper:]')
      local FUNDING_RATE_ANNUAL=$(LC_NUMERIC=C awk "BEGIN {printf \"%.18f\", $FUNDING_RATE * 3 * 365 * 100}")
      local MINUTE_TIMESTAMP=$((CREATED_AT_SEC / 60 * 60))
      
      echo "INSERT OR REPLACE INTO market_stats_1m (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, minute_timestamp, sample_count, created_at) VALUES ('paradex', '$MARKET', '$NORMALIZED_SYMBOL', $MARK_PRICE, $MARK_PRICE, $MARK_PRICE, $MARK_PRICE, 0, 0, 0, 0, 0, 0, $FUNDING_RATE, $FUNDING_RATE_ANNUAL, $FUNDING_RATE, $FUNDING_RATE, $MINUTE_TIMESTAMP, 1, $CREATED_AT_SEC);" >> "$OUTPUT_FILE"
    done
    RECORDS=$COUNT
  fi
  
  echo "$RECORDS"
}

export -f fetch_hour

# Process one day
process_day() {
  local DATE=$1
  local DAY_TEMP="$MAIN_TEMP/day_$DATE"
  mkdir -p "$DAY_TEMP"
  
  # Convert date to timestamp
  local DAY_START=$(date -j -f "%Y-%m-%d" "$DATE" "+%s" 2>/dev/null || date -d "$DATE" "+%s")
  local DAY_START_MS=$((DAY_START * 1000))
  
  echo -e "${BLUE}Processing $DATE${NC}"
  
  local MARKET_IDX=0
  echo "$MARKETS" | while read -r MARKET; do
    MARKET_IDX=$((MARKET_IDX + 1))
    local MARKET_FILE="$DAY_TEMP/market_${MARKET_IDX}.sql"
    
    # Process 24 hours in parallel
    for HOUR in {0..23}; do
      local HOUR_START=$((DAY_START_MS + HOUR * 3600000))
      local HOUR_END=$((HOUR_START + 3600000))
      
      fetch_hour "$MARKET" "$HOUR_START" "$HOUR_END" "$MARKET_FILE" &
    done
    
    # Wait for all 24 hours to complete for this market
    wait
    
    # Count records for this market
    local MARKET_RECORDS=$(grep -c "INSERT" "$MARKET_FILE" 2>/dev/null || echo 0)
    if [ $MARKET_RECORDS -gt 0 ]; then
      echo "  [$MARKET_IDX/$TOTAL_MARKETS] $MARKET: $MARKET_RECORDS records"
    fi
  done
  
  # Combine all markets for this day
  cat "$DAY_TEMP"/market_*.sql > "$DAY_TEMP/day.sql" 2>/dev/null
  local DAY_RECORDS=$(grep -c "INSERT" "$DAY_TEMP/day.sql" 2>/dev/null || echo 0)
  
  if [ $DAY_RECORDS -gt 0 ]; then
    echo -e "${GREEN}✓ $DATE: $DAY_RECORDS records${NC}"
    
    # Import to database
    npx wrangler d1 execute "$DB_NAME" --remote --file="$DAY_TEMP/day.sql" 2>&1 | grep -E "Executed|rows written|Error" || true
  else
    echo -e "${YELLOW}⚠ $DATE: No data${NC}"
  fi
  
  # Cleanup day temp
  rm -rf "$DAY_TEMP"
}

export -f process_day
export MARKETS TOTAL_MARKETS MAIN_TEMP DB_NAME GREEN BLUE YELLOW NC

# Process each day sequentially (but hours in parallel)
CURRENT_DATE="$START_DATE"
while [ "$(date -j -f "%Y-%m-%d" "$CURRENT_DATE" "+%Y%m%d" 2>/dev/null || date -d "$CURRENT_DATE" "+%Y%m%d")" -le "$(date -j -f "%Y-%m-%d" "$END_DATE" "+%Y%m%d" 2>/dev/null || date -d "$END_DATE" "+%Y%m%d")" ]; do
  process_day "$CURRENT_DATE"
  
  # Next day
  CURRENT_DATE=$(date -j -v+1d -f "%Y-%m-%d" "$CURRENT_DATE" "+%Y-%m-%d" 2>/dev/null || date -d "$CURRENT_DATE + 1 day" "+%Y-%m-%d")
done

# Cleanup
rm -rf "$MAIN_TEMP"

echo ""
echo -e "${GREEN}✓ Import complete!${NC}"
echo ""
echo "Verifying data..."
npx wrangler d1 execute "$DB_NAME" --remote --command "SELECT COUNT(*) as total_records, COUNT(DISTINCT symbol) as unique_markets, MIN(created_at) as earliest, MAX(created_at) as latest FROM market_stats_1m WHERE exchange = 'paradex' AND created_at >= $(date -j -f "%Y-%m-%d" "$START_DATE" "+%s" 2>/dev/null || date -d "$START_DATE" "+%s") AND created_at <= $(date -j -f "%Y-%m-%d" "$END_DATE" "+%s" 2>/dev/null || date -d "$END_DATE" "+%s")"
