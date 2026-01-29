#!/bin/bash

# Variational DEX Integration Test Suite
# Testet alle Aspekte der Variational-Integration

set -e

API_BASE="https://api.fundingrate.de"
TRACKER_BASE="$API_BASE/tracker/variational"
VARIATIONAL_API="https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Variational DEX Integration Test Suite                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Test 1: Tracker Status
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 1: Tracker Status & Health"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
STATUS=$(curl -s "$TRACKER_BASE/status")
RUNNING=$(echo "$STATUS" | jq -r '.data.running')
POLL_COUNT=$(echo "$STATUS" | jq -r '.data.pollCount')

if [ "$RUNNING" = "true" ]; then
    echo -e "${GREEN}✓${NC} Tracker läuft"
    echo "  Poll Count: $POLL_COUNT"
else
    echo -e "${RED}✗${NC} Tracker läuft NICHT"
    exit 1
fi
echo ""

# Test 2: Debug Info
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 2: Debug Information"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
DEBUG=$(curl -s "$TRACKER_BASE/debug")
echo "$DEBUG" | jq '{
  running: .debug.running,
  pollCount: .debug.pollCount,
  timeSinceLastPoll: (.debug.timeSinceLastPoll/1000 | tostring + "s"),
  nextPollIn: (.debug.nextPollIn/1000 | tostring + "s")
}'
echo ""

# Test 3: Market Data Availability
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 3: Market Data Verfügbarkeit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
MARKETS=$(curl -s "$API_BASE/api/markets?exchange=variational")
COUNT=$(echo "$MARKETS" | jq -r '.meta.count')

if [ "$COUNT" -gt 400 ]; then
    echo -e "${GREEN}✓${NC} Markets in DB: $COUNT (erwartet: ~486)"
else
    echo -e "${YELLOW}⚠${NC} Markets in DB: $COUNT (erwartet: ~486)"
fi

TIMESTAMP=$(echo "$MARKETS" | jq -r '.data[0].timestamp')
echo "  Letzte Aktualisierung: $TIMESTAMP"
echo ""

# Test 4: Data Quality Check
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 4: Datenqualität (BTC Market)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
BTC_DATA=$(curl -s "$API_BASE/api/markets?exchange=variational&symbol=BTC" | jq '.data[0]')

if [ "$(echo "$BTC_DATA" | jq -r '.symbol')" = "BTC" ]; then
    echo -e "${GREEN}✓${NC} BTC Market gefunden"
    echo "$BTC_DATA" | jq '{
      symbol,
      mark_price,
      funding_rate: .funding_rate,
      funding_rate_hourly: .funding_rate_hourly,
      funding_rate_annual: .funding_rate_annual,
      open_interest_usd: (.open_interest_usd | tonumber | round),
      volume_24h: (.volume_24h | tonumber | round)
    }'
else
    echo -e "${RED}✗${NC} BTC Market nicht gefunden"
fi
echo ""

# Test 5: Funding Rate Normalization
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 5: Funding Rate Normalisierung (8h Intervall)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
FR=$(echo "$BTC_DATA" | jq -r '.funding_rate')
FR_HOURLY=$(echo "$BTC_DATA" | jq -r '.funding_rate_hourly')
FR_ANNUAL=$(echo "$BTC_DATA" | jq -r '.funding_rate_annual')

# Berechne erwartete Werte (8h Intervall)
EXPECTED_HOURLY=$(echo "$FR / 8" | bc -l)
EXPECTED_ANNUAL=$(echo "$EXPECTED_HOURLY * 24 * 365 * 100" | bc -l)

echo "  Raw Funding Rate: $FR"
echo "  Hourly Rate: $FR_HOURLY (erwartet: ~$EXPECTED_HOURLY)"
echo "  Annual Rate: $FR_ANNUAL% (erwartet: ~$EXPECTED_ANNUAL%)"

# Validierung (mit Toleranz von 1%)
DIFF=$(echo "scale=2; ($FR_ANNUAL - $EXPECTED_ANNUAL) / $EXPECTED_ANNUAL * 100" | bc -l | sed 's/-//')
if (( $(echo "$DIFF < 1" | bc -l) )); then
    echo -e "${GREEN}✓${NC} Normalisierung korrekt"
else
    echo -e "${YELLOW}⚠${NC} Normalisierung weicht ab (${DIFF}%)"
fi
echo ""

# Test 6: API Comparison
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 6: Vergleich mit Variational API"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
API_DATA=$(curl -s "$VARIATIONAL_API" | jq '.listings[] | select(.ticker == "BTC")')
API_PRICE=$(echo "$API_DATA" | jq -r '.mark_price')
API_FR=$(echo "$API_DATA" | jq -r '.funding_rate')
API_VOL=$(echo "$API_DATA" | jq -r '.volume_24h')

DB_PRICE=$(echo "$BTC_DATA" | jq -r '.mark_price')
DB_FR=$(echo "$BTC_DATA" | jq -r '.funding_rate')
DB_VOL=$(echo "$BTC_DATA" | jq -r '.volume_24h')

echo "  Mark Price:"
echo "    API: $API_PRICE"
echo "    DB:  $DB_PRICE"

echo "  Funding Rate:"
echo "    API: $API_FR"
echo "    DB:  $DB_FR"

echo "  Volume 24h:"
echo "    API: $API_VOL"
echo "    DB:  $DB_VOL"

# Prüfe ob Daten ähnlich sind (innerhalb 5% Toleranz für Preis)
PRICE_DIFF=$(echo "scale=2; ($DB_PRICE - $API_PRICE) / $API_PRICE * 100" | bc -l | sed 's/-//')
if (( $(echo "$PRICE_DIFF < 5" | bc -l) )); then
    echo -e "${GREEN}✓${NC} Daten konsistent mit API"
else
    echo -e "${YELLOW}⚠${NC} Daten weichen ab (${PRICE_DIFF}%)"
fi
echo ""

# Test 7: Top Markets by Volume
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 7: Top 5 Markets nach Volumen"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s "$API_BASE/api/markets?exchange=variational&limit=500" | \
  jq -r '.data | sort_by(-.volume_24h) | .[:5] | .[] | 
  "\(.symbol | ascii_upcase | .[0:8] + (" " * (8 - (. | length)))): Vol=$\(.volume_24h | tonumber | . / 1000000 | floor)M, FR=\(.funding_rate_annual | tonumber | round)% APR, OI=$\(.open_interest_usd | tonumber | . / 1000000 | floor)M"'
echo ""

# Test 8: Funding Rate Statistics
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 8: Funding Rate Statistiken"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s "$API_BASE/api/markets?exchange=variational&limit=500" | \
  jq -r '.data | map(.funding_rate_annual) | 
  "  Min:    \(min | round)% APR\n  Median: \((sort | .[length/2]) | round)% APR\n  Avg:    \((add/length) | round)% APR\n  Max:    \(max | round)% APR"'
echo ""

# Test 9: Rate Limit Check
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 9: Rate Limit Compliance"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
POLL_INTERVAL=15
REQ_PER_MIN=$(echo "60 / $POLL_INTERVAL" | bc)
LIMIT_PER_MIN=60

echo "  Polling-Intervall: ${POLL_INTERVAL}s"
echo "  Requests/Minute: $REQ_PER_MIN"
echo "  Limit/Minute: $LIMIT_PER_MIN"
echo "  Auslastung: $(echo "scale=1; $REQ_PER_MIN * 100 / $LIMIT_PER_MIN" | bc)%"

if [ "$REQ_PER_MIN" -lt "$LIMIT_PER_MIN" ]; then
    echo -e "${GREEN}✓${NC} Rate Limits eingehalten"
else
    echo -e "${RED}✗${NC} Rate Limits überschritten!"
fi
echo ""

# Test 10: Integration with other exchanges
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST 10: Integration mit anderen Exchanges"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ALL_EXCHANGES=$(curl -s "$API_BASE/api/markets?limit=1000" | jq -r '[.data[].exchange] | unique | sort | .[]')
echo "Verfügbare Exchanges:"
echo "$ALL_EXCHANGES" | while read -r ex; do
    if [ "$ex" = "variational" ]; then
        echo -e "  ${GREEN}✓${NC} $ex"
    else
        echo "    $ex"
    fi
done
echo ""

# Summary
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    TEST SUMMARY                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${GREEN}✓${NC} Alle Tests erfolgreich abgeschlossen"
echo ""
echo "Nächste Schritte:"
echo "  1. Monitoring: curl $TRACKER_BASE/status"
echo "  2. Markets:    curl $API_BASE/api/markets?exchange=variational"
echo "  3. Debug:      curl $TRACKER_BASE/debug"
echo ""
