#!/bin/bash

# Konfiguration
CONTRACT_ID="10000001"
BASE_URL="https://pro.edgex.exchange/api/v1/public/funding/getFundingRatePage"
START_TS=1735689600000  # 2025-11-01 00:00 UTC
END_TS=1738304000000    # 2025-12-01 00:00 UTC (exklusiv)
CSV_FILE="november_funding_${CONTRACT_ID}.csv"
LOG_FILE="november_fetch.log"
SIZE=100

echo "🚀 EdgeX November 2025 Funding Fetcher gestartet"
echo "📅 Zeitraum: 2025-11-01 00:00 bis 2025-11-30 23:59 UTC"
echo "📊 Contract: $CONTRACT_ID | Output: $CSV_FILE"

# CSV Header
echo "timestamp,fundingRate,contractId,human_time" > "$CSV_FILE"
echo "$(date): Fetch gestartet für $CONTRACT_ID" > "$LOG_FILE"

# Zähler
TOTAL=0
PAGES=0
OFFSET=""

# Pagination Loop
while true; do
    URL="${BASE_URL}?contractId=${CONTRACT_ID}&size=${SIZE}&filterBeginTimeInclusive=${START_TS}&filterEndTimeExclusive=${END_TS}"
    [ -n "$OFFSET" ] && URL="${URL}&offsetData=${OFFSET}"
    
    echo "📄 Page $((${PAGES}+1)): $URL"
    
    DATA=$(curl -s -f "$URL")
    if [ $? -ne 0 ]; then
        echo "❌ API Fehler bei Page $((PAGES+1))" | tee -a "$LOG_FILE"
        break
    fi
    
    # Next Offset extrahieren
    NEXT_OFFSET=$(echo "$DATA" | jq -r '.data.nextPageOffsetData // empty')
    
    # Anzahl neuer Rows zählen
    NEW_ROWS=$(echo "$DATA" | jq '.data.dataList | length')
    
    # Daten parsen und speichern (FIX: date außerhalb von jq!)
    echo "$DATA" | jq -r '.data.dataList[] | "\(.fundingTimestamp),\(.fundingRate),\(.contractId),\(.fundingTimestamp | tonumber | strftime("%Y-%m-%d %H:%M:%S UTC"))"' >> "$CSV_FILE"
    
    TOTAL=$((TOTAL + NEW_ROWS))
    PAGES=$((PAGES + 1))
    
    echo "✅ Page $PAGES: $NEW_ROWS neue Einträge (Total: $TOTAL)"
    echo "📊 Page $PAGES: $NEW_ROWS rows | Total: $TOTAL | Next: ${NEXT_OFFSET:0:10}..." | tee -a "$LOG_FILE"
    
    # Abbruchbedingung
    if [ -z "$NEXT_OFFSET" ] || [ "$NEXT_OFFSET" = "null" ]; then
        echo "✅ Alle Daten abgerufen! Kein weiterer Offset."
        break
    fi
    
    OFFSET="$NEXT_OFFSET"
    sleep 0.5  # Rate limiting
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 FERTIG! $TOTAL Funding Rates für November 2025 gespeichert"
echo "📁 $CSV_FILE | 📝 $LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Statistik
echo "=== NOVEMBER 2025 STATISTIK ===" | tee -a "$LOG_FILE"
echo "Contract ID: $CONTRACT_ID" | tee -a "$LOG_FILE"
echo "Gesamt Einträge: $TOTAL" | tee -a "$LOG_FILE"
echo "Pages abgefragt: $PAGES" | tee -a "$LOG_FILE"

# Vorschau
echo "" && echo "📈 Letzte

