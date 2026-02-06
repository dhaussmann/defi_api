# Variational DEX - Testing Guide

## Quick Tests

### 1. Tracker Status prüfen
```bash
curl -s https://api.fundingrate.de/tracker/variational/status | jq
```

**Erwartete Ausgabe:**
```json
{
  "success": true,
  "data": {
    "running": true,
    "pollCount": 10,
    "bufferSize": 0,
    "lastPollTime": 1769717726371,
    "lastSuccessfulPoll": 1769717727318
  }
}
```

### 2. Market Daten abrufen
```bash
# Alle Variational Markets
curl -s "https://api.fundingrate.de/api/markets?exchange=variational" | jq '.meta.count'

# Spezifisches Symbol
curl -s "https://api.fundingrate.de/api/markets?exchange=variational&symbol=BTC" | jq '.data[0]'
```

### 3. Debug Information
```bash
curl -s https://api.fundingrate.de/tracker/variational/debug | jq
```

## Vollständige Test-Suite

### Test-Script ausführen
```bash
./test_variational_simple.sh
```

### Manuelle Tests

#### Test 1: Tracker Management
```bash
# Status prüfen
curl https://api.fundingrate.de/tracker/variational/status

# Tracker stoppen
curl -X POST https://api.fundingrate.de/tracker/variational/stop

# Tracker starten
curl -X POST https://api.fundingrate.de/tracker/variational/start
```

#### Test 2: Datenqualität
```bash
# BTC Market Details
curl -s "https://api.fundingrate.de/api/markets?exchange=variational&symbol=BTC" | jq '{
  symbol: .data[0].symbol,
  price: .data[0].mark_price,
  funding_rate: .data[0].funding_rate,
  funding_rate_hourly: .data[0].funding_rate_hourly,
  funding_rate_annual: .data[0].funding_rate_annual,
  open_interest: .data[0].open_interest_usd,
  volume: .data[0].volume_24h,
  timestamp: .data[0].timestamp
}'
```

#### Test 3: Funding Rate Normalisierung
```bash
# Prüfe ob 8h Intervall korrekt normalisiert wird
# Formel: hourly = rate / 8
#         annual = hourly * 24 * 365 * 100

curl -s "https://api.fundingrate.de/api/markets?exchange=variational&symbol=BTC" | jq '
  .data[0] | {
    raw_rate: .funding_rate,
    hourly: .funding_rate_hourly,
    annual: .funding_rate_annual,
    calculated_hourly: (.funding_rate / 8),
    calculated_annual: ((.funding_rate / 8) * 24 * 365 * 100)
  }
'
```

#### Test 4: Top Markets
```bash
# Top 10 nach Volumen
curl -s "https://api.fundingrate.de/api/markets?exchange=variational&limit=500" | \
  jq -r '.data | sort_by(-.volume_24h) | .[:10] | .[] | 
  "\(.symbol | ascii_upcase): Vol=$\(.volume_24h | tonumber | round), FR=\(.funding_rate_annual | tonumber | round)% APR"'
```

#### Test 5: Funding Rate Verteilung
```bash
curl -s "https://api.fundingrate.de/api/markets?exchange=variational&limit=500" | \
  jq '.data | map(.funding_rate_annual) | {
    min: min,
    q25: (sort | .[length/4]),
    median: (sort | .[length/2]),
    q75: (sort | .[length*3/4]),
    max: max,
    avg: (add/length)
  }'
```

#### Test 6: API Vergleich
```bash
# Variational API direkt
curl -s 'https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats' | \
  jq '.listings[] | select(.ticker == "BTC") | {ticker, mark_price, funding_rate, volume_24h}'

# Unsere DB
curl -s "https://api.fundingrate.de/api/markets?exchange=variational&symbol=BTC" | \
  jq '.data[0] | {symbol, mark_price, funding_rate, volume_24h}'
```

#### Test 7: Rate Limit Compliance
```bash
# Prüfe Polling-Frequenz
curl -s https://api.fundingrate.de/tracker/variational/debug | jq '{
  pollCount: .debug.pollCount,
  timeSinceLastPoll: (.debug.timeSinceLastPoll / 1000 | tostring + "s"),
  nextPollIn: (.debug.nextPollIn / 1000 | tostring + "s")
}'

# Rate Limit: 10 req/10s = 60 req/min
# Unser Intervall: 15s = 4 req/min ✓
```

#### Test 8: Integration mit anderen Exchanges
```bash
# Vergleiche BTC Funding Rates über alle Exchanges
curl -s "https://api.fundingrate.de/api/markets?symbol=BTC" | \
  jq -r '.data | sort_by(.exchange) | .[] | 
  "\(.exchange | ascii_upcase): \(.funding_rate_annual | tonumber | round)% APR"'
```

## Monitoring

### Kontinuierliches Monitoring
```bash
# Status alle 30 Sekunden
watch -n 30 'curl -s https://api.fundingrate.de/tracker/variational/status | jq ".data | {running, pollCount, lastPoll: (.lastPollTime/1000 | strftime(\"%H:%M:%S\"))}"'
```

### Logs überwachen (Development)
```bash
npx wrangler tail --format pretty
```

### Health Check
```bash
# Prüfe ob Tracker läuft und Daten sammelt
STATUS=$(curl -s https://api.fundingrate.de/tracker/variational/status)
RUNNING=$(echo "$STATUS" | jq -r '.data.running')
POLL_COUNT=$(echo "$STATUS" | jq -r '.data.pollCount')

if [ "$RUNNING" = "true" ] && [ "$POLL_COUNT" -gt 0 ]; then
    echo "✓ Variational Tracker is healthy"
else
    echo "✗ Variational Tracker has issues"
fi
```

## Troubleshooting

### Problem: Keine Daten in DB
```bash
# 1. Prüfe Tracker Status
curl https://api.fundingrate.de/tracker/variational/status

# 2. Prüfe Debug Info
curl https://api.fundingrate.de/tracker/variational/debug

# 3. Restart Tracker
curl -X POST https://api.fundingrate.de/tracker/variational/stop
sleep 2
curl -X POST https://api.fundingrate.de/tracker/variational/start
```

### Problem: Alte Daten
```bash
# Prüfe Timestamp der letzten Daten
curl -s "https://api.fundingrate.de/api/markets?exchange=variational&limit=1" | \
  jq -r '.data[0].timestamp'

# Sollte nicht älter als 1-2 Minuten sein
```

### Problem: Rate Limit Errors
```bash
# Prüfe Polling-Frequenz
curl -s https://api.fundingrate.de/tracker/variational/debug | \
  jq '.debug | {pollCount, timeSinceLastPoll, nextPollIn}'

# Intervall sollte 15s sein (4 req/min)
```

## Performance Metrics

### Erwartete Werte
- **Markets:** ~486
- **Polling-Intervall:** 15 Sekunden
- **Requests/Minute:** 4
- **Buffer Size:** 0 (direkte DB-Speicherung)
- **Poll Success Rate:** >99%

### Benchmark
```bash
# Anzahl Markets
curl -s "https://api.fundingrate.de/api/markets?exchange=variational" | jq '.meta.count'
# Erwartet: 485-486

# Response Time
time curl -s "https://api.fundingrate.de/api/markets?exchange=variational&limit=10" > /dev/null
# Erwartet: <500ms

# Data Freshness
curl -s "https://api.fundingrate.de/api/markets?exchange=variational&limit=1" | \
  jq -r '.data[0].timestamp'
# Erwartet: <2 Minuten alt
```

## API Endpoints

### Tracker Endpoints
- `GET /tracker/variational/status` - Status und Statistiken
- `GET /tracker/variational/debug` - Debug-Informationen
- `POST /tracker/variational/start` - Tracker starten
- `POST /tracker/variational/stop` - Tracker stoppen

### Data Endpoints
- `GET /api/markets?exchange=variational` - Alle Variational Markets
- `GET /api/markets?exchange=variational&symbol=BTC` - Spezifisches Symbol
- `GET /api/markets?exchange=variational&limit=100` - Limit Ergebnisse

## Validation Checklist

- [ ] Tracker läuft (`running: true`)
- [ ] Poll Count steigt kontinuierlich
- [ ] ~486 Markets in DB
- [ ] BTC Market hat aktuelle Daten
- [ ] Funding Rates sind normalisiert (8h → hourly → annual)
- [ ] Open Interest USD ist berechnet
- [ ] Timestamps sind aktuell (<2 Min)
- [ ] Rate Limits werden eingehalten (4 req/min)
- [ ] Integration mit anderen Exchanges funktioniert

## Deployment Verification

Nach jedem Deployment:
```bash
# 1. Prüfe Deployment
curl https://api.fundingrate.de/tracker/variational/status

# 2. Warte 30 Sekunden
sleep 30

# 3. Prüfe Daten
curl "https://api.fundingrate.de/api/markets?exchange=variational&limit=5"

# 4. Prüfe Logs
npx wrangler tail --format pretty
```
