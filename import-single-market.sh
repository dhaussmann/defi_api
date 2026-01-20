#!/bin/bash
# Import Script für einen einzelnen Market

MARKET=$1
IDX=$2
TOTAL=$3
START_TIME=1764543600000
END_TIME=1767963600000
CHUNK_SIZE=6000000
DB_NAME="defiapi-db"
TEMP_DIR=$4

BASE_ASSET=$(echo "$MARKET" | cut -d'-' -f1)
SQL_FILE="$TEMP_DIR/market_${IDX}.sql"
RECORDS=0

# Process chunks
CHUNK_START=$START_TIME
while [ $CHUNK_START -lt $END_TIME ]; do
  CHUNK_END=$((CHUNK_START + CHUNK_SIZE))
  [ $CHUNK_END -gt $END_TIME ] && CHUNK_END=$END_TIME
  
  RESPONSE=$(curl -s "https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_at=${CHUNK_START}&end_at=${CHUNK_END}")
  COUNT=$(echo "$RESPONSE" | jq '.results | length' 2>/dev/null)
  
  # Ensure COUNT is a valid number
  if [ -z "$COUNT" ] || ! [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    COUNT=0
  fi
  
  if [ "$COUNT" -gt 0 ]; then
    echo "$RESPONSE" | jq -c '.results[]' | while read -r RECORD; do
      CREATED_AT=$(echo "$RECORD" | jq -r '.created_at')
      FUNDING_RATE=$(echo "$RECORD" | jq -r '.funding_rate')
      MARK_PRICE=$(echo "$RECORD" | jq -r '.mark_price // 0')
      CREATED_AT_SEC=$((CREATED_AT / 1000))
      NORMALIZED_SYMBOL=$(echo "$BASE_ASSET" | tr '[:lower:]' '[:upper:]')
      FUNDING_RATE_ANNUAL=$(LC_NUMERIC=C awk "BEGIN {printf \"%.18f\", $FUNDING_RATE * 3 * 365 * 100}")
      MINUTE_TIMESTAMP=$((CREATED_AT_SEC / 60 * 60))
      
      echo "INSERT OR REPLACE INTO market_stats_1m (exchange, symbol, normalized_symbol, avg_mark_price, avg_index_price, min_price, max_price, price_volatility, volume_base, volume_quote, avg_open_interest, avg_open_interest_usd, max_open_interest_usd, avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate, minute_timestamp, sample_count, created_at) VALUES ('paradex', '$MARKET', '$NORMALIZED_SYMBOL', $MARK_PRICE, $MARK_PRICE, $MARK_PRICE, $MARK_PRICE, 0, 0, 0, 0, 0, 0, $FUNDING_RATE, $FUNDING_RATE_ANNUAL, $FUNDING_RATE, $FUNDING_RATE, $MINUTE_TIMESTAMP, 1, $CREATED_AT_SEC);" >> "$SQL_FILE"
    done
    RECORDS=$((RECORDS + COUNT))
  fi
  
  CHUNK_START=$CHUNK_END
done

# Status
TS=$(date '+%H:%M:%S')
PCT=$((IDX * 100 / TOTAL))
if [ $RECORDS -gt 0 ]; then
  echo "[$TS] [✓] [$PCT%] ($IDX/$TOTAL) $MARKET: $RECORDS records"
else
  echo "[$TS] [⚠] [$PCT%] ($IDX/$TOTAL) $MARKET: No data"
fi
