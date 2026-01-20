#!/bin/bash

# Funktionierendes paralleles Import-Script
# Verwendet Background-Jobs statt xargs/parallel

START_TIME=1764543600000  # 2025-12-01 00:00:00 UTC
END_TIME=1767963600000    # 2026-01-09 14:00:00 UTC
CHUNK_SIZE=6000000        # 100 Minuten
MAX_PARALLEL=23
DB_NAME="defiapi-db"

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}Paradex Parallel Import${NC}"
echo -e "${BLUE}=========================================${NC}"
echo "Period: 2025-12-01 to 2026-01-09 14:00"
echo "Parallel workers: $MAX_PARALLEL"
echo ""

# Temp Dir
TEMP_DIR=$(mktemp -d)
PROGRESS_FILE="$TEMP_DIR/progress.txt"
echo "0" > "$PROGRESS_FILE"
echo "Temp directory: $TEMP_DIR"

# Hole Markets
echo "Fetching markets..."
MARKETS_JSON=$(curl -s "https://api.prod.paradex.trade/v1/markets/summary?market=ALL")
MARKETS=$(echo "$MARKETS_JSON" | jq -r '.results[] | select(.symbol | endswith("-PERP")) | .symbol' | sort -u)
TOTAL=$(echo "$MARKETS" | wc -l | tr -d ' ')
echo "✓ Found $TOTAL markets"
echo ""

# Schreibe Markets in Datei
echo "$MARKETS" > "$TEMP_DIR/markets.txt"

# Worker Function
process_market() {
  local MARKET=$1
  local IDX=$2
  local TOTAL=$3
  local TEMP_DIR=$4
  local BASE_ASSET=$(echo "$MARKET" | cut -d'-' -f1)
  local SQL_FILE="$TEMP_DIR/market_${IDX}.sql"
  local RECORDS=0
  
  # Process chunks
  local CHUNK_START=$START_TIME
  while [ $CHUNK_START -lt $END_TIME ]; do
    local CHUNK_END=$((CHUNK_START + CHUNK_SIZE))
    [ $CHUNK_END -gt $END_TIME ] && CHUNK_END=$END_TIME
    
    local RESPONSE=$(curl -s "https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_at=${CHUNK_START}&end_at=${CHUNK_END}")
    local COUNT=$(echo "$RESPONSE" | jq '.results | length' 2>/dev/null || echo 0)
    
    if [ "$COUNT" -gt 0 ]; then
      echo "$RESPONSE" | jq -c '.results[]' | while read -r RECORD; do
        local CREATED_AT=$(echo "$RECORD" | jq -r '.created_at')
        local FUNDING_RATE=$(echo "$RECORD" | jq -r '.funding_rate')
        local MARK_PRICE=$(echo "$RECORD" | jq -r '.mark_price // 0')
        local CREATED_AT_SEC=$((CREATED_AT / 1000))
        local NORMALIZED_SYMBOL=$(echo "$BASE_ASSET" | tr '[:lower:]' '[:upper:]')
        local FUNDING_RATE_ANNUAL=$(LC_NUMERIC=C awk "BEGIN {printf \"%.18f\", $FUNDING_RATE * 3 * 365 * 100}")
        local MINUTE_TIMESTAMP=$((CREATED_AT_SEC / 60 * 60))
        
        echo "INSERT OR REPLACE INTO market_stats_1m (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, minute_timestamp, sample_count, created_at) VALUES ('paradex', '$MARKET', '$NORMALIZED_SYMBOL', $MARK_PRICE, $MARK_PRICE, $MARK_PRICE, $MARK_PRICE, 0, 0, 0, 0, 0, 0, $FUNDING_RATE, $FUNDING_RATE_ANNUAL, $FUNDING_RATE, $FUNDING_RATE, $MINUTE_TIMESTAMP, 1, $CREATED_AT_SEC);" >> "$SQL_FILE"
      done
      RECORDS=$((RECORDS + COUNT))
    fi
    
    CHUNK_START=$CHUNK_END
  done
  
  # Update progress
  local LOCK_DIR="$TEMP_DIR/lock.$$"
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do sleep 0.01; done
  local COMPLETED=$(cat "$TEMP_DIR/progress.txt")
  echo "$((COMPLETED + 1))" > "$TEMP_DIR/progress.txt"
  rmdir "$LOCK_DIR"
  
  # Status
  local TS=$(date '+%H:%M:%S')
  local PERCENT=$(( (IDX * 100) / TOTAL ))
  if [ $RECORDS -gt 0 ]; then
    echo "[$TS] [✓] [$PERCENT%] ($IDX/$TOTAL) $MARKET: $RECORDS records"
  else
    echo "[$TS] [⚠] [$PERCENT%] ($IDX/$TOTAL) $MARKET: No data"
  fi
}

export -f process_market
export START_TIME END_TIME CHUNK_SIZE

echo "Starting parallel processing..."
echo ""

# Start workers
IDX=0
RUNNING=0

while IFS= read -r MARKET; do
  IDX=$((IDX + 1))
  
  # Warte bis Slot frei ist
  while [ $RUNNING -ge $MAX_PARALLEL ]; do
    sleep 0.1
    RUNNING=$(jobs -r | wc -l | tr -d ' ')
  done
  
  # Starte Worker im Hintergrund
  process_market "$MARKET" "$IDX" "$TOTAL" "$TEMP_DIR" &
  RUNNING=$((RUNNING + 1))
  
done < "$TEMP_DIR/markets.txt"

# Warte auf alle Workers
echo ""
echo "Waiting for all workers to complete..."
wait

# Kombiniere SQL
echo ""
echo "Combining SQL files..."
cat "$TEMP_DIR"/market_*.sql > "$TEMP_DIR/combined.sql" 2>/dev/null

SQL_COUNT=$(grep -c "INSERT" "$TEMP_DIR/combined.sql" 2>/dev/null || echo 0)
echo "Total statements: $SQL_COUNT"

if [ $SQL_COUNT -gt 0 ]; then
  echo ""
  echo "Importing to database..."
  npx wrangler d1 execute "$DB_NAME" --remote --file="$TEMP_DIR/combined.sql"
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Import successful!${NC}"
  else
    echo -e "${RED}✗ Import failed${NC}"
    echo "SQL file: $TEMP_DIR/combined.sql"
    exit 1
  fi
fi

rm -rf "$TEMP_DIR"

echo ""
echo -e "${GREEN}✓ Parallel import complete!${NC}"
