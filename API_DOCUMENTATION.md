# DeFi API - Dokumentation

WebSocket-basierter Tracker für Crypto-Börsen mit Cloudflare Workers & Durable Objects.

## 🎯 Übersicht

Diese API sammelt und speichert Market-Statistiken von verschiedenen dezentralen Börsen in Echtzeit über WebSocket-Verbindungen.

**Unterstützte Börsen:**
- **Lighter** - Dezentraler Perpetual Futures Exchange
- **Paradex** - Dezentraler Derivate Exchange (nur PERP-Märkte)

**Technologie-Stack:**
- Cloudflare Workers (API-Layer)
- Durable Objects (WebSocket-Verbindungen & Buffering)
- D1 Database (Persistente Datenspeicherung)
- 15-Sekunden-Snapshots für Memory-Effizienz

---

## 📡 Base URL

```
https://defiapi.workers.dev
```

(Ersetzen Sie dies mit Ihrer tatsächlichen Worker-URL)

---

## 🔧 Tracker Control Endpoints

Diese Endpoints steuern die WebSocket-Verbindungen zu den Börsen.

### Lighter Exchange

#### Tracker starten
```bash
POST /tracker/lighter/start
```

**Response:**
```json
{
  "success": true,
  "message": "WebSocket connection started",
  "status": "running"
}
```

#### Tracker stoppen
```bash
POST /tracker/lighter/stop
```

**Response:**
```json
{
  "success": true,
  "message": "WebSocket connection stopped",
  "status": "stopped"
}
```

#### Status abrufen
```bash
GET /tracker/lighter/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "reconnectAttempts": 0,
    "bufferSize": 45,
    "bufferedSymbols": ["BTC", "ETH", "SOL", "..."]
  }
}
```

#### Debug-Informationen
```bash
GET /tracker/lighter/debug
```

**Response:**
```json
{
  "success": true,
  "debug": {
    "connected": true,
    "messageCount": 15234,
    "bufferSize": 45,
    "bufferedSymbols": ["BTC", "ETH", "..."],
    "wsReadyState": 1,
    "availableMarketsCount": 45,
    "sampleMarkets": [...]
  }
}
```

### Paradex Exchange

Die gleichen Endpoints sind für Paradex verfügbar:

```bash
POST /tracker/paradex/start
POST /tracker/paradex/stop
GET  /tracker/paradex/status
GET  /tracker/paradex/debug
```

**Hinweis:** Paradex filtert automatisch nur PERP-Märkte (`asset_kind === "PERP"`). PERP_OPTION und andere Märkte werden ausgeschlossen.

### Backward Compatibility

Für Abwärtskompatibilität routen `/tracker/*` Endpoints automatisch zu Lighter:

```bash
POST /tracker/start    # → Lighter
GET  /tracker/status   # → Lighter
```

---

## 📊 Data API Endpoints

Diese Endpoints liefern gespeicherte Market-Daten aus der Datenbank.

### 1. Neueste Market Stats

Liefert die neuesten Daten für jedes Symbol (ein Datensatz pro Symbol).

```bash
GET /api/latest
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Default | Beschreibung |
|-----------|-----|---------|---------|--------------|
| `exchange` | string | Nein | `lighter` | Exchange-Name (`lighter`, `paradex`) |
| `symbol` | string | Nein | - | Filtert nach einem bestimmten Symbol |

**Beispiele:**

```bash
# Neueste Stats von Lighter
curl "https://defiapi.workers.dev/api/latest?exchange=lighter"

# Neueste Stats von Paradex
curl "https://defiapi.workers.dev/api/latest?exchange=paradex"

# Nur BTC-USD-PERP von Paradex
curl "https://defiapi.workers.dev/api/latest?exchange=paradex&symbol=BTC-USD-PERP"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 12345,
      "exchange": "paradex",
      "symbol": "BTC-USD-PERP",
      "market_id": 123456789,
      "index_price": "43250.50",
      "mark_price": "43255.75",
      "open_interest": "125000000",
      "last_trade_price": "43254.00",
      "current_funding_rate": "0.0001",
      "funding_rate": "0.00008",
      "funding_timestamp": 1702912345000,
      "daily_base_token_volume": 1234567.89,
      "daily_quote_token_volume": 53456789.12,
      "daily_price_low": 42800.00,
      "daily_price_high": 43500.00,
      "daily_price_change": 0.0125,
      "recorded_at": 1702912345678,
      "created_at": 1702912345
    },
    // ... weitere Symbole
  ],
  "meta": {
    "count": 110
  }
}
```

### 2. Historische Market Stats

Liefert historische Daten mit Filtermöglichkeiten.

```bash
GET /api/stats
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Default | Beschreibung |
|-----------|-----|---------|---------|--------------|
| `exchange` | string | Nein | `lighter` | Exchange-Name (`lighter`, `paradex`) |
| `symbol` | string | Nein | - | Filtert nach Symbol |
| `from` | number | Nein | - | Start-Timestamp in Millisekunden |
| `to` | number | Nein | - | End-Timestamp in Millisekunden |
| `limit` | number | Nein | `100` | Maximale Anzahl Ergebnisse (1-1000) |

**Beispiele:**

```bash
# Letzte 50 Einträge für BTC-USD-PERP
curl "https://defiapi.workers.dev/api/stats?exchange=paradex&symbol=BTC-USD-PERP&limit=50"

# Alle Paradex-Daten der letzten Stunde
curl "https://defiapi.workers.dev/api/stats?exchange=paradex&from=1702908745000&to=1702912345000"

# Alle Lighter-Daten für ETH
curl "https://defiapi.workers.dev/api/stats?exchange=lighter&symbol=ETH&limit=200"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 12345,
      "exchange": "paradex",
      "symbol": "BTC-USD-PERP",
      // ... alle Felder wie bei /api/latest
    },
    // ... weitere Einträge chronologisch sortiert
  ],
  "meta": {
    "count": 50,
    "query": {
      "exchange": "paradex",
      "symbol": "BTC-USD-PERP",
      "from": null,
      "to": null,
      "limit": 50
    }
  }
}
```

### 3. Tracker Status (Datenbank)

Zeigt den Status aller Tracker aus der Datenbank.

```bash
GET /api/status
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "exchange": "lighter",
      "status": "running",
      "last_message_at": 1702912345,
      "error_message": null,
      "reconnect_count": 0,
      "updated_at": 1702912345
    },
    {
      "id": 2,
      "exchange": "paradex",
      "status": "running",
      "last_message_at": 1702912346,
      "error_message": null,
      "reconnect_count": 0,
      "updated_at": 1702912346
    }
  ]
}
```

---

## 📋 Datenmodell

### Market Stats Record

Jeder Datensatz in der Datenbank enthält folgende Felder:

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `id` | Integer | Eindeutige ID (Auto-Increment) |
| `exchange` | String | Exchange-Name (`lighter`, `paradex`) |
| `symbol` | String | Trading-Paar Symbol (z.B. `BTC-USD-PERP`) |
| `market_id` | Integer | Market-ID (exchange-spezifisch) |
| `index_price` | String | Index-Preis des Underlying Assets |
| `mark_price` | String | Mark-Preis für Margin-Berechnungen |
| `open_interest` | String | Offene Positionen (Total Value) |
| `open_interest_limit` | String | Maximales Open Interest (Lighter only) |
| `funding_clamp_small` | String | Funding Clamp Small (Lighter only) |
| `funding_clamp_big` | String | Funding Clamp Big (Lighter only) |
| `last_trade_price` | String | Preis des letzten Trades |
| `current_funding_rate` | String | Aktueller Funding Rate |
| `funding_rate` | String | Nächster Funding Rate |
| `funding_timestamp` | Integer | Timestamp des Funding Events |
| `daily_base_token_volume` | Real | 24h Volumen in Base Token |
| `daily_quote_token_volume` | Real | 24h Volumen in Quote Token |
| `daily_price_low` | Real | 24h Tiefstkurs |
| `daily_price_high` | Real | 24h Höchstkurs |
| `daily_price_change` | Real | 24h Preisänderung (Prozent) |
| `recorded_at` | Integer | Timestamp der Aufzeichnung (ms) |
| `created_at` | Integer | Timestamp der DB-Erstellung (s) |

**Hinweise:**
- Preise sind als Strings gespeichert für hohe Präzision
- Volumen und Preisänderungen sind als Float/Real gespeichert
- Timestamps: `recorded_at` in Millisekunden, `created_at` in Sekunden
- Felder mit `(Lighter only)` sind bei Paradex auf `"0"` gesetzt

---

## 🚀 Verwendungsbeispiele

### Python

```python
import requests
from datetime import datetime, timedelta

BASE_URL = "https://defiapi.workers.dev"

# 1. Tracker starten
response = requests.post(f"{BASE_URL}/tracker/paradex/start")
print(response.json())

# 2. Neueste Daten abrufen
response = requests.get(f"{BASE_URL}/api/latest", params={
    "exchange": "paradex"
})
data = response.json()
print(f"Found {data['meta']['count']} markets")

# 3. Historische Daten für BTC
now = int(datetime.now().timestamp() * 1000)
one_hour_ago = int((datetime.now() - timedelta(hours=1)).timestamp() * 1000)

response = requests.get(f"{BASE_URL}/api/stats", params={
    "exchange": "paradex",
    "symbol": "BTC-USD-PERP",
    "from": one_hour_ago,
    "to": now,
    "limit": 100
})
btc_data = response.json()
print(f"BTC entries: {len(btc_data['data'])}")

# 4. Funding Rate Analyse
for entry in btc_data['data']:
    print(f"{entry['recorded_at']}: FR={entry['funding_rate']}, Price={entry['mark_price']}")
```

### JavaScript (Node.js)

```javascript
const BASE_URL = "https://defiapi.workers.dev";

// 1. Neueste Paradex-Daten abrufen
async function getLatestData() {
  const response = await fetch(`${BASE_URL}/api/latest?exchange=paradex`);
  const data = await response.json();

  console.log(`Found ${data.meta.count} markets`);

  // Top 5 nach Volumen
  const topByVolume = data.data
    .sort((a, b) => b.daily_quote_token_volume - a.daily_quote_token_volume)
    .slice(0, 5);

  console.log("Top 5 by Volume:");
  topByVolume.forEach(m => {
    console.log(`${m.symbol}: $${m.daily_quote_token_volume.toLocaleString()}`);
  });
}

// 2. Funding Rate Monitor
async function monitorFundingRates() {
  const response = await fetch(`${BASE_URL}/api/latest?exchange=paradex`);
  const data = await response.json();

  // Finde hohe Funding Rates
  const highFunding = data.data
    .filter(m => Math.abs(parseFloat(m.funding_rate)) > 0.0001)
    .map(m => ({
      symbol: m.symbol,
      rate: parseFloat(m.funding_rate),
      annualized: parseFloat(m.funding_rate) * 365 * 3 // 3x täglich
    }));

  console.log("High Funding Rates:");
  highFunding.forEach(m => {
    console.log(`${m.symbol}: ${(m.rate * 100).toFixed(4)}% (${(m.annualized * 100).toFixed(2)}% APR)`);
  });
}

getLatestData();
monitorFundingRates();
```

### cURL

```bash
#!/bin/bash
BASE_URL="https://defiapi.workers.dev"

# Tracker starten
curl -X POST "$BASE_URL/tracker/paradex/start"

# Status prüfen
curl "$BASE_URL/tracker/paradex/status" | jq .

# Neueste Daten
curl "$BASE_URL/api/latest?exchange=paradex" | jq '.data[0:5]'

# BTC Daten der letzten Stunde
FROM=$(date -d '1 hour ago' +%s)000
TO=$(date +%s)000
curl "$BASE_URL/api/stats?exchange=paradex&symbol=BTC-USD-PERP&from=$FROM&to=$TO" | jq .

# Funding Rates exportieren
curl "$BASE_URL/api/latest?exchange=paradex" | \
  jq -r '.data[] | [.symbol, .funding_rate, .mark_price] | @csv' > funding_rates.csv
```

---

## 🔄 Auto-Start Mechanismus

Die Tracker starten **automatisch** bei jedem Request:

- Wenn Sie einen API-Endpoint aufrufen, werden beide Tracker automatisch gestartet (falls nicht bereits aktiv)
- Sie müssen `/tracker/start` nur manuell aufrufen, wenn Sie einen gestoppten Tracker neu starten möchten
- Die Tracker verbinden sich automatisch neu bei Verbindungsabbrüchen (max. 10 Versuche)

**Empfehlung:** Lassen Sie die Tracker einfach laufen. Sie starten automatisch und benötigen keine manuelle Verwaltung.

---

## 📈 Snapshot-Mechanismus

**Wie funktioniert die Datenspeicherung?**

1. **WebSocket → Buffer:** Eingehende Market-Updates werden im RAM gebuffert
2. **Buffer → Database:** Alle 15 Sekunden wird ein Snapshot in die D1-Datenbank geschrieben
3. **Buffer Cleanup:** Nach dem Snapshot wird der Buffer geleert, um Speicher freizugeben

**Vorteile:**
- ✅ Memory-effizient (Buffer wird regelmäßig geleert)
- ✅ Performance-optimiert (Batch-Inserts statt einzelne Inserts)
- ✅ Reduzierte Datenbank-Load

**Konfiguration:**
```toml
# wrangler.toml
[vars]
SNAPSHOT_INTERVAL_MS = "15000"  # 15 Sekunden (Standard)
```

---

## 🛡️ Fehlerbehandlung

### Error Response Format

```json
{
  "success": false,
  "error": "Error message here"
}
```

### HTTP Status Codes

| Code | Bedeutung |
|------|-----------|
| 200 | Erfolgreiche Anfrage |
| 404 | Endpoint nicht gefunden |
| 500 | Interner Server-Fehler |

### Häufige Fehler

**Tracker startet nicht:**
- Prüfen Sie die Logs mit `/tracker/{exchange}/debug`
- Netzwerkprobleme können zu DNS-Fehlern führen (nur bei lokalem Dev)

**Keine Daten in DB:**
- Warten Sie 15 Sekunden (Snapshot-Intervall)
- Prüfen Sie `/api/status` ob Tracker läuft
- Prüfen Sie `/tracker/{exchange}/status` für Buffer-Größe

**PERP_OPTION in Paradex-Daten:**
- Sollte seit dem neuesten Update nicht mehr vorkommen
- Falls doch, führen Sie ein Cleanup durch:
```bash
npx wrangler d1 execute defiapi-db --remote --command \
  "DELETE FROM market_stats WHERE exchange = 'paradex' AND symbol LIKE '%OPTION%'"
```

---

## 🔍 Monitoring & Debugging

### Tracker Health Check

```bash
# Status beider Tracker prüfen
curl https://defiapi.workers.dev/api/status | jq .

# Detaillierte Debug-Info
curl https://defiapi.workers.dev/tracker/paradex/debug | jq .
curl https://defiapi.workers.dev/tracker/lighter/debug | jq .
```

### Datenbank Queries

```bash
# Anzahl Einträge pro Exchange
npx wrangler d1 execute defiapi-db --remote --command \
  "SELECT exchange, COUNT(*) as count FROM market_stats GROUP BY exchange"

# Neueste 10 Einträge
npx wrangler d1 execute defiapi-db --remote --command \
  "SELECT * FROM market_stats ORDER BY id DESC LIMIT 10"

# Unique Symbols pro Exchange
npx wrangler d1 execute defiapi-db --remote --command \
  "SELECT exchange, COUNT(DISTINCT symbol) as unique_symbols FROM market_stats GROUP BY exchange"
```

---

## 📦 Deployment

### Voraussetzungen

1. Cloudflare Account mit Workers aktiviert
2. D1 Datenbank erstellt
3. Wrangler CLI installiert

### Deployment-Schritte

```bash
# 1. Dependencies installieren
npm install

# 2. Datenbank-Migrationen ausführen
npx wrangler d1 execute defiapi-db --remote --file=migrations/0001_initial_schema.sql
npx wrangler d1 execute defiapi-db --remote --file=migrations/0002_add_paradex.sql

# 3. Worker deployen
npx wrangler deploy

# 4. Tracker starten (automatisch beim ersten Request)
curl -X POST https://your-worker.workers.dev/tracker/lighter/start
curl -X POST https://your-worker.workers.dev/tracker/paradex/start
```

---

## 🔐 CORS

Die API unterstützt CORS für alle Origins:

```javascript
{
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
}
```

---

## 📝 Rate Limits

**Aktuell:** Keine Rate Limits implementiert.

**Empfehlungen für Clients:**
- Polling-Intervall: Minimum 5 Sekunden für `/api/latest`
- Batch-Requests: Nutzen Sie `/api/stats` mit `limit` statt mehrere Einzelanfragen
- Caching: Cachen Sie `/api/latest` für 5-10 Sekunden

---

## 🤝 Support & Kontakt

Bei Fragen oder Problemen:
- GitHub Issues: [Repository-URL]
- Email: [Ihre Email]

---

## 📄 Lizenz

[Ihre Lizenz hier einfügen]

---

**Version:** 1.0.0
**Letzte Aktualisierung:** 2024-12-18
