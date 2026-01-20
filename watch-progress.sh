#!/bin/bash

# Watch Progress Script
# Zeigt Fortschritt des parallel imports an

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Finde Temp-Verzeichnis aus Log-Datei
LOG_FILE="/Users/dhaussmann/Projects/defi_api/paradex-import.log"

if [ ! -f "$LOG_FILE" ]; then
  echo "Log-Datei nicht gefunden: $LOG_FILE"
  exit 1
fi

TEMP_DIR=$(grep "Progress tracking enabled" "$LOG_FILE" | tail -1 | sed 's/.*at: //' | tr -d '\n' | sed 's/[[:space:]]*$//')

if [ -z "$TEMP_DIR" ]; then
  echo "Kein Temp-Verzeichnis im Log gefunden"
  echo "Prüfe ob Script läuft:"
  ps aux | grep "import-paradex-historical-parallel" | grep -v grep
  exit 1
fi

if [ ! -d "$TEMP_DIR" ]; then
  echo "Temp-Verzeichnis existiert nicht: $TEMP_DIR"
  exit 1
fi

# Erstelle progress dir falls nicht vorhanden
mkdir -p "$TEMP_DIR/progress" 2>/dev/null

echo -e "${BLUE}Watching Import Progress${NC}"
echo "Temp Dir: $TEMP_DIR"
echo ""

TOTAL=110
START_TIME=$(date +%s)

while true; do
  # Lese Stats
  COMPLETED=$(cat "$TEMP_DIR/stats.txt.completed" 2>/dev/null || echo 0)
  TOTAL_RECS=$(cat "$TEMP_DIR/stats.txt.total_records" 2>/dev/null || echo 0)
  TOTAL_CHNKS=$(cat "$TEMP_DIR/stats.txt.total_chunks" 2>/dev/null || echo 0)
  
  # Berechne Fortschritt
  PERCENT=$((COMPLETED * 100 / TOTAL))
  REMAINING=$((TOTAL - COMPLETED))
  
  # Berechne ETA
  ELAPSED=$(($(date +%s) - START_TIME))
  if [ $COMPLETED -gt 0 ] && [ $ELAPSED -gt 0 ]; then
    RATE=$(echo "scale=2; $COMPLETED / $ELAPSED" | bc)
    ETA_SECONDS=$(echo "scale=0; $REMAINING / $RATE" | bc 2>/dev/null || echo 0)
    ETA_MIN=$((ETA_SECONDS / 60))
    
    # Progress Bar
    BAR_WIDTH=50
    FILLED=$((PERCENT * BAR_WIDTH / 100))
    EMPTY=$((BAR_WIDTH - FILLED))
    BAR=$(printf "█%.0s" $(seq 1 $FILLED) 2>/dev/null)$(printf "░%.0s" $(seq 1 $EMPTY) 2>/dev/null)
    
    # Ausgabe (überschreibt vorherige Zeile)
    printf "\r\033[K${BLUE}Progress:${NC} [%s] %3d%% | Markets: %d/%d | Records: %s | Chunks: %s | Rate: %.1f m/s | ETA: ~%dm" \
      "$BAR" "$PERCENT" "$COMPLETED" "$TOTAL" "$TOTAL_RECS" "$TOTAL_CHNKS" "$RATE" "$ETA_MIN"
  else
    printf "\r\033[K${YELLOW}Waiting for first market to complete...${NC}"
  fi
  
  # Prüfe ob fertig
  if [ $COMPLETED -ge $TOTAL ]; then
    echo ""
    echo ""
    echo -e "${GREEN}✓ Import complete!${NC}"
    echo "Total Markets: $COMPLETED"
    echo "Total Records: $TOTAL_RECS"
    echo "Total Chunks: $TOTAL_CHNKS"
    break
  fi
  
  sleep 2
done
