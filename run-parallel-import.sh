#!/bin/bash
# Master script - startet Worker-Prozesse

MAX_WORKERS=23
START_TIME=1764543600000
END_TIME=1767963600000
CHUNK_SIZE=6000000
DB_NAME="defiapi-db"

TEMP_DIR=$(mktemp -d)
echo "Temp: $TEMP_DIR"

# Hole Markets
curl -s "https://api.prod.paradex.trade/v1/markets/summary?market=ALL" | jq -r '.results[] | select(.symbol | endswith("-PERP")) | .symbol' | sort -u > "$TEMP_DIR/markets.txt"
TOTAL=$(wc -l < "$TEMP_DIR/markets.txt" | tr -d ' ')
echo "Markets: $TOTAL"

# Worker Script
cat > "$TEMP_DIR/worker.sh" << 'WORKEREOF'
#!/bin/bash
MARKET=$1
IDX=$2
TOTAL=$3
TEMP_DIR=$4
START_TIME=$5
END_TIME=$6
CHUNK_SIZE=$7

BASE=$(echo "$MARKET" | cut -d'-' -f1)
SQL="$TEMP_DIR/m_${IDX}.sql"
RECS=0

CS=$START_TIME
while [ $CS -lt $END_TIME ]; do
  CE=$((CS + CHUNK_SIZE))
  [ $CE -gt $END_TIME ] && CE=$END_TIME
  
  R=$(curl -s "https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_at=${CS}&end_at=${CE}")
  C=$(echo "$R" | jq '.results|length' 2>/dev/null || echo 0)
  
  if [ "$C" -gt 0 ]; then
    echo "$R" | jq -c '.results[]' | while read L; do
      CA=$(echo "$L" | jq -r '.created_at')
      FR=$(echo "$L" | jq -r '.funding_rate')
      MP=$(echo "$L" | jq -r '.mark_price//0')
      CS=$((CA/1000))
      NS=$(echo "$BASE" | tr '[:lower:]' '[:upper:]')
      FA=$(LC_NUMERIC=C awk "BEGIN {printf \"%.18f\", $FR*3*365*100}")
      MT=$((CS/60*60))
      echo "INSERT OR REPLACE INTO market_stats_1m (exchange,symbol,normalized_symbol,avg_mark_price,avg_index_price,min_price,max_price,price_volatility,volume_base,volume_quote,avg_open_interest,avg_open_interest_usd,max_open_interest_usd,avg_funding_rate,avg_funding_rate_annual,min_funding_rate,max_funding_rate,minute_timestamp,sample_count,created_at) VALUES ('paradex','$MARKET','$NS',$MP,$MP,$MP,$MP,0,0,0,0,0,0,$FR,$FA,$FR,$FR,$MT,1,$CS);" >> "$SQL"
    done
    RECS=$((RECS+C))
  fi
  CS=$CE
done

TS=$(date '+%H:%M:%S')
PCT=$((IDX*100/TOTAL))
if [ $RECS -gt 0 ]; then
  echo "[$TS] [✓] [$PCT%] ($IDX/$TOTAL) $MARKET: $RECS records"
else
  echo "[$TS] [⚠] [$PCT%] ($IDX/$TOTAL) $MARKET: No data"
fi
WORKEREOF

chmod +x "$TEMP_DIR/worker.sh"

# Starte Workers
echo "Starting $MAX_WORKERS workers..."
IDX=0
cat "$TEMP_DIR/markets.txt" | while read M; do
  IDX=$((IDX+1))
  echo "$M $IDX $TOTAL"
done | xargs -P $MAX_WORKERS -n 3 "$TEMP_DIR/worker.sh" {} "$TEMP_DIR" "$START_TIME" "$END_TIME" "$CHUNK_SIZE"

echo ""
echo "Combining SQL..."
cat "$TEMP_DIR"/m_*.sql > "$TEMP_DIR/all.sql" 2>/dev/null
CNT=$(grep -c INSERT "$TEMP_DIR/all.sql" 2>/dev/null || echo 0)
echo "Statements: $CNT"

if [ $CNT -gt 0 ]; then
  echo "Importing..."
  npx wrangler d1 execute "$DB_NAME" --remote --file="$TEMP_DIR/all.sql"
  echo "✓ Done"
fi

rm -rf "$TEMP_DIR"
