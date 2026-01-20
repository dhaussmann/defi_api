#!/bin/bash

# ============================================
# Import Paradex Historical Data with Chunking
# Period: 2025-12-01 00:00 to 2026-01-09 14:00
# ============================================

# Zeitraum (in Millisekunden!)
START_TIME=1764543600000  # 2025-12-01 00:00:00 UTC
END_TIME=1767963600000    # 2026-01-09 14:00:00 UTC

RATE_LIMIT=0.05           # Sekunden zwischen Requests (API hat kein striktes Rate Limit)
DB_NAME="defiapi-db"

# Chunk-Größe: 1 Tag in Millisekunden (API limit: 100 records)
# Bei 5-Sekunden-Intervallen = 17280 records/Tag, also müssen wir kleinere Chunks nehmen
CHUNK_SIZE=3600000        # 1 Stunde = 3600000ms (720 records bei 5s-Intervall)

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
echo -e "${BLUE}Paradex Historical Data Import${NC}"
echo -e "${BLUE}Period: 2025-12-01 00:00 - 2026-01-09 14:00${NC}"
echo -e "${BLUE}=========================================${NC}"
START_DATE=$(date -r $((START_TIME / 1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "@$((START_TIME / 1000))" '+%Y-%m-%d %H:%M:%S')
END_DATE=$(date -r $((END_TIME / 1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "@$((END_TIME / 1000))" '+%Y-%m-%d %H:%M:%S')
echo "Start: $START_DATE"
echo "End: $END_DATE"
echo "Chunk size: 100 minutes (~1.67 hours)"
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
echo -e "${YELLOW}Starting import...${NC}"
echo ""

CURRENT=0

# Temporäre SQL-Datei für Batch-Insert
SQL_TEMP=$(mktemp)

# ============================================
# Für jeden Market historische Daten sammeln
# ============================================
while IFS= read -r MARKET; do
  ((CURRENT++))
  PERCENT=$((CURRENT * 100 / TOTAL_COUNT))
  BASE_ASSET=$(echo "$MARKET" | cut -d'-' -f1)

  printf "[%3d%%] (%3d/%3d) %-20s " "$PERCENT" "$CURRENT" "$TOTAL_COUNT" "$MARKET"

  MARKET_RECORDS=0
  MARKET_CHUNKS=0
  
  # Berechne Anzahl der Chunks
  TOTAL_MARKET_CHUNKS=$(( (END_TIME - START_TIME) / CHUNK_SIZE ))
  
  # Iteriere durch Chunks
  CHUNK_START=$START_TIME
  
  while [ $CHUNK_START -lt $END_TIME ]; do
    CHUNK_END=$((CHUNK_START + CHUNK_SIZE))
    if [ $CHUNK_END -gt $END_TIME ]; then
      CHUNK_END=$END_TIME
    fi
    
    # API Call für Chunk
    RESPONSE=$(curl -s "https://api.prod.paradex.trade/v1/funding/data?market=${MARKET}&start_at=${CHUNK_START}&end_at=${CHUNK_END}")
    
    # Prüfe ob Daten vorhanden sind
    RECORDS_COUNT=$(echo "$RESPONSE" | jq '.results | length' 2>/dev/null)
    
    if [ "$RECORDS_COUNT" -gt 0 ] 2>/dev/null; then
      # Verarbeite jedes Record
      echo "$RESPONSE" | jq -c '.results[]' | while IFS= read -r RECORD; do
        # Extrahiere Felder
        CREATED_AT=$(echo "$RECORD" | jq -r '.created_at')
        FUNDING_RATE=$(echo "$RECORD" | jq -r '.funding_rate')
        MARK_PRICE=$(echo "$RECORD" | jq -r '.mark_price // 0')
        
        # Konvertiere Millisekunden zu Sekunden
        CREATED_AT_SEC=$((CREATED_AT / 1000))
        
        # Normalisiere Symbol
        NORMALIZED_SYMBOL=$(echo "$BASE_ASSET" | tr '[:lower:]' '[:upper:]')
        
        # Berechne annualized funding rate (Paradex: 8h intervals = 3x daily)
        FUNDING_RATE_ANNUAL=$(LC_NUMERIC=C awk "BEGIN {printf \"%.18f\", $FUNDING_RATE * 3 * 365 * 100}")
        
        # Runde auf Minute
        MINUTE_TIMESTAMP=$((CREATED_AT_SEC / 60 * 60))
        
        # Schreibe INSERT
        cat >> "$SQL_TEMP" << EOF
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
    
    # Zeige Fortschritt alle 24 Chunks (= 1 Tag)
    if [ $((MARKET_CHUNKS % 24)) -eq 0 ] && [ $MARKET_CHUNKS -gt 0 ]; then
      CHUNK_PERCENT=$((MARKET_CHUNKS * 100 / TOTAL_MARKET_CHUNKS))
      printf "(%d%% chunks)..." "$CHUNK_PERCENT"
    fi
    
    # Rate limiting
    sleep $RATE_LIMIT
  done
  
  # Lösche Fortschrittszeile
  printf "\r"
  
  if [ $MARKET_RECORDS -gt 0 ]; then
    printf "[%3d%%] (%3d/%3d) %-20s ${GREEN}✓ %d records (%d chunks)${NC}\n" "$PERCENT" "$CURRENT" "$TOTAL_COUNT" "$MARKET" "$MARKET_RECORDS" "$MARKET_CHUNKS"
    ((SUCCESS++))
    TOTAL_RECORDS=$((TOTAL_RECORDS + MARKET_RECORDS))
    TOTAL_CHUNKS=$((TOTAL_CHUNKS + MARKET_CHUNKS))
  else
    printf "[%3d%%] (%3d/%3d) %-20s ${YELLOW}⚠ No data${NC}\n" "$PERCENT" "$CURRENT" "$TOTAL_COUNT" "$MARKET"
    ((FAILED++))
  fi

done <<< "$MARKETS"

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
    exit 1
  fi
else
  echo -e "${RED}✗ No data to import${NC}"
  exit 1
fi

rm -f "$SQL_TEMP"

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
echo -e "${GREEN}✓ Historical import complete!${NC}"
