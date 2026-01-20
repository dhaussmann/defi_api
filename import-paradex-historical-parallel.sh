#!/bin/bash

# ============================================
# Import Paradex Historical Data with Parallel Processing
# Period: 2025-12-01 00:00 to 2026-01-09 14:00
# Rate Limit: 1400 requests/minute (with safety buffer)
# ============================================

# Zeitraum (in Millisekunden!)
START_TIME=1764543600000  # 2025-12-01 00:00:00 UTC
END_TIME=1767963600000    # 2026-01-09 14:00:00 UTC

# Chunk-Größe: API limit: 100 records
# Bei 1-Minuten-Intervallen = 100 records = 100 Minuten = ~1.67 Stunden
CHUNK_SIZE=6000000        # 100 Minuten = 6000000ms (100 records bei 1min-Intervall)

# Parallelisierung
MAX_PARALLEL=23           # 1400 req/min ÷ 60s = 23.3 req/s → 23 parallel (mit Puffer)
DB_NAME="defiapi-db"

# Farben
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Statistiken
SUCCESS=0
FAILED=0
TOTAL_RECORDS=0
TOTAL_CHUNKS=0

echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}Paradex Historical Data Import (PARALLEL)${NC}"
echo -e "${BLUE}Period: 2025-12-01 00:00 - 2026-01-09 14:00${NC}"
echo -e "${BLUE}=========================================${NC}"
START_DATE=$(date -r $((START_TIME / 1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "@$((START_TIME / 1000))" '+%Y-%m-%d %H:%M:%S')
END_DATE=$(date -r $((END_TIME / 1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "@$((END_TIME / 1000))" '+%Y-%m-%d %H:%M:%S')
echo "Start: $START_DATE"
echo "End: $END_DATE"
echo "Chunk size: 100 minutes (~1.67 hours)"
echo "Parallel workers: $MAX_PARALLEL"
echo "Rate limit: 1400 req/min (~23 req/s)"
echo ""

# ============================================
# Symbole sammeln
# ============================================
echo -e "${YELLOW}Fetching Paradex markets...${NC}"

MARKETS_RESPONSE=$(curl -s "https://api.prod.paradex.trade/v1/markets/summary?market=ALL")

# Erstelle ein Array mit market symbols (nur PERP)
MARKETS=$(echo "$MARKETS_RESPONSE" | jq -r '.results[] | select(.symbol | endswith("-PERP")) | .symbol' | sort -u)

TOTAL_COUNT=$(echo "$MARKETS" | wc -l | tr -d ' ')

echo -e "${GREEN}✓ Found $TOTAL_COUNT perpetual markets${NC}"
echo ""

# Berechne Chunks pro Market
CHUNKS_PER_MARKET=$(( (END_TIME - START_TIME) / CHUNK_SIZE ))
TOTAL_CHUNKS_ESTIMATE=$((TOTAL_COUNT * CHUNKS_PER_MARKET))

echo -e "${YELLOW}Estimated total chunks: $TOTAL_CHUNKS_ESTIMATE${NC}"
echo -e "${YELLOW}Estimated duration: ~$(echo "scale=1; $TOTAL_CHUNKS_ESTIMATE / 23 / 3600" | bc)h (at 23 req/s)${NC}"
echo ""
echo -e "${YELLOW}Starting parallel import...${NC}"
echo ""

# Temporäre Verzeichnisse
TEMP_DIR=$(mktemp -d)
SQL_TEMP="$TEMP_DIR/combined.sql"
PROGRESS_DIR="$TEMP_DIR/progress"
STATS_FILE="$TEMP_DIR/stats.txt"
mkdir -p "$PROGRESS_DIR"

# Initialisiere Stats-Datei
echo "0" > "$STATS_FILE.completed"
echo "0" > "$STATS_FILE.total_records"
echo "0" > "$STATS_FILE.total_chunks"

echo -e "${YELLOW}Progress tracking enabled at: $TEMP_DIR${NC}"
echo ""

# ============================================
# Funktion: Process einzelner Market
# ============================================
process_market() {
  local MARKET=$1
  local MARKET_INDEX=$2
  local TOTAL=$3
  local BASE_ASSET=$(echo "$MARKET" | cut -d'-' -f1)
  
  local MARKET_SQL="$TEMP_DIR/market_${MARKET_INDEX}.sql"
  local MARKET_RECORDS=0
  local MARKET_CHUNKS=0
  
  # Iteriere durch Chunks
  local CHUNK_START=$START_TIME
  
  while [ $CHUNK_START -lt $END_TIME ]; do
    local CHUNK_END=$((CHUNK_START + CHUNK_SIZE))
    if [ $CHUNK_END -gt $END_TIME ]; then
      CHUNK_END=$END_TIME
    fi
    
    # API Call für Chunk
    local RESPONSE=$(curl -s "https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_at=${CHUNK_START}&end_at=${CHUNK_END}")
    
    # Prüfe ob Daten vorhanden sind
    local RECORDS_COUNT=$(echo "$RESPONSE" | jq '.results | length' 2>/dev/null)
    
    if [ "$RECORDS_COUNT" -gt 0 ] 2>/dev/null; then
      # Verarbeite jedes Record
      echo "$RESPONSE" | jq -c '.results[]' | while IFS= read -r RECORD; do
        # Extrahiere Felder
        local CREATED_AT=$(echo "$RECORD" | jq -r '.created_at')
        local FUNDING_RATE=$(echo "$RECORD" | jq -r '.funding_rate')
        local MARK_PRICE=$(echo "$RECORD" | jq -r '.mark_price // 0')
        
        # Konvertiere Millisekunden zu Sekunden
        local CREATED_AT_SEC=$((CREATED_AT / 1000))
        
        # Normalisiere Symbol
        local NORMALIZED_SYMBOL=$(echo "$BASE_ASSET" | tr '[:lower:]' '[:upper:]')
        
        # Berechne annualized funding rate (Paradex: 8h intervals = 3x daily)
        local FUNDING_RATE_ANNUAL=$(LC_NUMERIC=C awk "BEGIN {printf \"%.18f\", $FUNDING_RATE * 3 * 365 * 100}")
        
        # Runde auf Minute
        local MINUTE_TIMESTAMP=$((CREATED_AT_SEC / 60 * 60))
        
        # Schreibe INSERT
        cat >> "$MARKET_SQL" << EOF
INSERT OR REPLACE INTO market_stats_1m (
  exchange, symbol, normalized_symbol,
  avg_mark_price, avg_index_price, min_price, max_price, price_volatility,
  volume_base, volume_quote,
  avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
  avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
  minute_timestamp, sample_count, created_at
) VALUES (
  'paradex', '$MARKET', '$NORMALIZED_SYMBOL',
  $MARK_PRICE, $MARK_PRICE, $MARK_PRICE, $MARK_PRICE, 0,
  0, 0,
  0, 0, 0,
  $FUNDING_RATE, $FUNDING_RATE_ANNUAL, $FUNDING_RATE, $FUNDING_RATE,
  $MINUTE_TIMESTAMP, 1, $CREATED_AT_SEC
);
EOF
      done
      
      MARKET_RECORDS=$((MARKET_RECORDS + RECORDS_COUNT))
      ((MARKET_CHUNKS++))
    fi
    
    # Nächster Chunk
    CHUNK_START=$CHUNK_END
  done
  
  # Schreibe Progress-Info
  echo "$MARKET_RECORDS" > "$PROGRESS_DIR/${MARKET_INDEX}.records"
  echo "$MARKET_CHUNKS" > "$PROGRESS_DIR/${MARKET_INDEX}.chunks"
  echo "done" > "$PROGRESS_DIR/${MARKET_INDEX}.status"
  
  # Update globale Stats (macOS-kompatibel ohne flock)
  # Verwende atomare Datei-Operationen
  local LOCK_FILE="$STATS_FILE.lock.$$"
  while ! mkdir "$LOCK_FILE" 2>/dev/null; do
    sleep 0.01
  done
  
  COMPLETED=$(cat "$STATS_FILE.completed")
  COMPLETED=$((COMPLETED + 1))
  echo "$COMPLETED" > "$STATS_FILE.completed"
  
  TOTAL_RECS=$(cat "$STATS_FILE.total_records")
  TOTAL_RECS=$((TOTAL_RECS + MARKET_RECORDS))
  echo "$TOTAL_RECS" > "$STATS_FILE.total_records"
  
  TOTAL_CHNKS=$(cat "$STATS_FILE.total_chunks")
  TOTAL_CHNKS=$((TOTAL_CHNKS + MARKET_CHUNKS))
  echo "$TOTAL_CHNKS" > "$STATS_FILE.total_chunks"
  
  rmdir "$LOCK_FILE"
  
  # Status ausgeben mit Timestamp
  local TIMESTAMP=$(date '+%H:%M:%S')
  local PERCENT=$((MARKET_INDEX * 100 / TOTAL))
  if [ $MARKET_RECORDS -gt 0 ]; then
    echo -e "[$TIMESTAMP] [${GREEN}✓${NC}] [${PERCENT}%] ($MARKET_INDEX/$TOTAL) $MARKET: $MARKET_RECORDS records ($MARKET_CHUNKS chunks)"
  else
    echo -e "[$TIMESTAMP] [${YELLOW}⚠${NC}] [${PERCENT}%] ($MARKET_INDEX/$TOTAL) $MARKET: No data"
  fi
}

export -f process_market
export START_TIME END_TIME CHUNK_SIZE TEMP_DIR PROGRESS_DIR STATS_FILE
export GREEN RED BLUE YELLOW NC

# ============================================
# Progress Monitor (Background)
# ============================================
monitor_progress() {
  local TOTAL=$1
  local START_TIME=$(date +%s)
  
  while true; do
    sleep 5
    
    # Prüfe ob noch läuft
    if [ ! -f "$STATS_FILE.lock" ] && [ ! -f "$PROGRESS_DIR"/*.status ] 2>/dev/null; then
      break
    fi
    
    # Lese Stats
    local COMPLETED=$(cat "$STATS_FILE.completed" 2>/dev/null || echo 0)
    local TOTAL_RECS=$(cat "$STATS_FILE.total_records" 2>/dev/null || echo 0)
    local TOTAL_CHNKS=$(cat "$STATS_FILE.total_chunks" 2>/dev/null || echo 0)
    
    # Berechne Fortschritt
    local PERCENT=$((COMPLETED * 100 / TOTAL))
    local REMAINING=$((TOTAL - COMPLETED))
    
    # Berechne Geschwindigkeit und ETA
    local ELAPSED=$(($(date +%s) - START_TIME))
    if [ $COMPLETED -gt 0 ] && [ $ELAPSED -gt 0 ]; then
      local RATE=$(echo "scale=2; $COMPLETED / $ELAPSED" | bc)
      local ETA_SECONDS=$(echo "scale=0; $REMAINING / $RATE" | bc)
      local ETA_MIN=$((ETA_SECONDS / 60))
      
      # Progress Bar
      local BAR_WIDTH=50
      local FILLED=$((PERCENT * BAR_WIDTH / 100))
      local EMPTY=$((BAR_WIDTH - FILLED))
      local BAR=$(printf "█%.0s" $(seq 1 $FILLED))$(printf "░%.0s" $(seq 1 $EMPTY))
      
      # Ausgabe (überschreibt vorherige Zeile)
      printf "\r\033[K${BLUE}Progress:${NC} [%s] %3d%% | Markets: %d/%d | Records: %s | Chunks: %s | ETA: ~%dm" \
        "$BAR" "$PERCENT" "$COMPLETED" "$TOTAL" "$TOTAL_RECS" "$TOTAL_CHNKS" "$ETA_MIN"
    fi
  done
  echo ""
}

# ============================================
# Parallele Verarbeitung mit GNU parallel oder xargs
# ============================================

# Prüfe ob GNU parallel verfügbar ist
if command -v parallel &> /dev/null; then
  echo -e "${GREEN}Using GNU parallel for processing${NC}"
  echo ""
  
  # Starte Progress Monitor im Hintergrund
  monitor_progress $TOTAL_COUNT &
  MONITOR_PID=$!
  
  # Erstelle Job-Liste
  MARKET_INDEX=0
  while IFS= read -r MARKET; do
    ((MARKET_INDEX++))
    echo "$MARKET $MARKET_INDEX $TOTAL_COUNT"
  done <<< "$MARKETS" | parallel --will-cite -j $MAX_PARALLEL --colsep ' ' process_market {1} {2} {3}
  
  # Warte auf Monitor
  wait $MONITOR_PID 2>/dev/null
  
else
  echo -e "${YELLOW}GNU parallel not found, using xargs (slower)${NC}"
  echo ""
  
  # Starte Progress Monitor im Hintergrund
  monitor_progress $TOTAL_COUNT &
  MONITOR_PID=$!
  
  # Fallback: xargs mit begrenzter Parallelität
  MARKET_INDEX=0
  echo "$MARKETS" | while IFS= read -r MARKET; do
    ((MARKET_INDEX++))
    echo "$MARKET $MARKET_INDEX $TOTAL_COUNT"
  done | xargs -P $MAX_PARALLEL -n 3 bash -c 'process_market "$0" "$1" "$2"'
  
  # Warte auf Monitor
  wait $MONITOR_PID 2>/dev/null
fi

# ============================================
# Kombiniere alle SQL-Dateien
# ============================================
echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}Combining SQL files...${NC}"
echo -e "${BLUE}=========================================${NC}"

cat "$TEMP_DIR"/market_*.sql > "$SQL_TEMP" 2>/dev/null

# Sammle Statistiken
for records_file in "$PROGRESS_DIR"/*.records; do
  if [ -f "$records_file" ]; then
    RECORDS=$(cat "$records_file")
    TOTAL_RECORDS=$((TOTAL_RECORDS + RECORDS))
    if [ $RECORDS -gt 0 ]; then
      ((SUCCESS++))
    else
      ((FAILED++))
    fi
  fi
done

for chunks_file in "$PROGRESS_DIR"/*.chunks; do
  if [ -f "$chunks_file" ]; then
    CHUNKS=$(cat "$chunks_file")
    TOTAL_CHUNKS=$((TOTAL_CHUNKS + CHUNKS))
  fi
done

# ============================================
# Daten in Datenbank importieren
# ============================================
echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}Importing to Database${NC}"
echo -e "${BLUE}=========================================${NC}"

if [ -s "$SQL_TEMP" ]; then
  SQL_COUNT=$(grep -c "INSERT" "$SQL_TEMP" 2>/dev/null || echo 0)
  echo "Total SQL statements: $SQL_COUNT"
  echo ""
  echo -e "${YELLOW}Executing batch insert (this may take a while)...${NC}"
  
  npx wrangler d1 execute "$DB_NAME" --remote --file="$SQL_TEMP"
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Import successful!${NC}"
  else
    echo -e "${RED}✗ Import failed${NC}"
    echo "SQL file saved at: $SQL_TEMP"
    echo "Temp directory: $TEMP_DIR"
    exit 1
  fi
else
  echo -e "${RED}✗ No data to import${NC}"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Cleanup
rm -rf "$TEMP_DIR"

# ============================================
# Zusammenfassung
# ============================================
echo ""
echo -e "${BLUE}=========================================${NC}"
echo -e "${BLUE}Import Summary${NC}"
echo -e "${BLUE}=========================================${NC}"
echo "Total markets processed: $TOTAL_COUNT"
echo -e "Success: ${GREEN}$SUCCESS${NC}"
echo -e "No data: ${YELLOW}$FAILED${NC}"
echo -e "Total records imported: ${GREEN}$TOTAL_RECORDS${NC}"
echo -e "Total chunks processed: ${GREEN}$TOTAL_CHUNKS${NC}"
echo ""

# ============================================
# Verifizierung
# ============================================
echo -e "${YELLOW}Verifying import...${NC}"
npx wrangler d1 execute "$DB_NAME" --remote --command "
  SELECT 
    COUNT(*) as records,
    COUNT(DISTINCT symbol) as symbols,
    datetime(MIN(minute_timestamp), 'unixepoch') as earliest,
    datetime(MAX(minute_timestamp), 'unixepoch') as latest
  FROM market_stats_1m
  WHERE exchange = 'paradex'
    AND minute_timestamp >= $((START_TIME / 1000))
    AND minute_timestamp < $((END_TIME / 1000))
"

echo ""
echo -e "${YELLOW}Overall Paradex data range:${NC}"
npx wrangler d1 execute "$DB_NAME" --remote --command "
  SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT symbol) as symbols,
    datetime(MIN(minute_timestamp), 'unixepoch') as earliest,
    datetime(MAX(minute_timestamp), 'unixepoch') as latest
  FROM market_stats_1m
  WHERE exchange = 'paradex'
"

echo ""
echo -e "${GREEN}✓ Parallel historical import complete!${NC}"
