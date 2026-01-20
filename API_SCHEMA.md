# DeFi Funding Rate API - Schema Documentation

## 📋 Übersicht

**Base URL:** `https://defiapi.cloudflareone-demo-account.workers.dev`  
**Custom Domain:** `https://api.fundingrate.de`

**OpenAPI Spec:** [`openapi.yaml`](./openapi.yaml)

---

## 🔑 Wichtige Konzepte

### Funding Rate Normalisierung

Die API liefert **drei verschiedene Funding Rate Werte**:

1. **`funding_rate`** - Original-Rate vom Exchange (exchange-spezifisches Intervall)
2. **`funding_rate_hourly`** - Normalisiert auf 1-Stunden-Basis (vergleichbar)
3. **`funding_rate_annual`** - Annualisierter APR in Prozent

**Beispiel:**
```json
{
  "funding_rate": 0.0000125,        // Original 8h-Rate (Hyena)
  "funding_rate_hourly": 0.0000015625,  // Normalisiert: 0.0000125 / 8
  "funding_rate_annual": 1.36875    // APR: 1.37%
}
```

### Exchange-spezifische Intervalle

| Exchange | Intervall | Zahlungen/Tag | Berechnung |
|----------|-----------|---------------|------------|
| Hyperliquid | 8h | 3 | `rate / 8 × 24 × 365 × 100` |
| Hyena | 8h | 3 | `rate / 8 × 24 × 365 × 100` |
| EdgeX | 4h | 6 | `rate / 4 × 24 × 365 × 100` |
| Extended | 1h | 24 | `rate × 24 × 365 × 100` |
| Pacifica | 1h | 24 | `rate × 24 × 365 × 100` |
| Lighter | 1h | 24 | `rate × 24 × 365` (bereits in %) |
| Aster | 1h/4h/8h | variabel | Token-abhängig |

---

## 📡 API Endpoints

### 1. Market Data

#### `GET /api/markets`
Aktuelle Marktdaten für alle Exchanges und Tokens.

**Query Parameters:**
- `exchange` (optional) - Filter nach Exchange
- `symbol` (optional) - Filter nach normalisiertem Symbol
- `limit` (optional, default: 100) - Max. Anzahl Ergebnisse

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "symbol": "BTC",
      "exchange": "hyperliquid",
      "original_symbol": "BTC",
      "mark_price": 93167.5,
      "index_price": 93150.2,
      "open_interest_usd": 1234567890.5,
      "volume_24h": 987654321.0,
      "funding_rate": 0.0000054075,
      "funding_rate_hourly": 0.00000067594,
      "funding_rate_annual": 0.59212125,
      "next_funding_time": null,
      "price_change_24h": -0.0234,
      "price_low_24h": 92500.0,
      "price_high_24h": 94000.0,
      "volatility_24h": 2.5,
      "volatility_7d": 5.8,
      "atr_14": 1500.0,
      "bb_width": 0.025,
      "timestamp": "2026-01-19 10:06:41"
    }
  ],
  "meta": {
    "count": 1,
    "filters": {
      "exchange": null,
      "symbol": null,
      "limit": 100
    }
  }
}
```

**Beispiele:**
```bash
# Alle BTC-Märkte
curl 'https://api.fundingrate.de/api/markets?symbol=BTC'

# Alle Hyperliquid-Märkte
curl 'https://api.fundingrate.de/api/markets?exchange=hyperliquid'

# Spezifischer Markt
curl 'https://api.fundingrate.de/api/markets?exchange=hyena&symbol=BTC'
```

---

#### `GET /api/compare`
Vergleicht einen Token über alle Exchanges.

**Query Parameters:**
- `symbol` (required) - Normalisiertes Symbol

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "symbol": "BTC",
      "exchange": "edgex",
      "funding_rate_annual": 12.64,
      ...
    },
    {
      "symbol": "BTC",
      "exchange": "extended",
      "funding_rate_annual": 11.39,
      ...
    }
  ],
  "meta": {
    "symbol": "BTC",
    "exchanges_count": 9
  }
}
```

**Beispiel:**
```bash
curl 'https://api.fundingrate.de/api/compare?symbol=BTC'
```

---

#### `GET /api/tokens`
Liste aller verfügbaren normalisierten Token-Symbole.

**Response:**
```json
{
  "success": true,
  "data": ["BTC", "ETH", "SOL", "HYPE", "DOGE", ...],
  "meta": {
    "count": 825
  }
}
```

---

### 2. Historical Data

#### `GET /api/normalized-data`
Flexible historische Datenabfrage mit verschiedenen Intervallen.

**Query Parameters:**
- `exchange` (optional) - Filter nach Exchange
- `symbol` (optional) - Normalisiertes Symbol
- `interval` (optional, default: `1h`) - Intervall: `15s`, `1m`, `1h`
- `from` (optional) - Start-Timestamp (Unix epoch)
- `to` (optional) - End-Timestamp (Unix epoch)
- `limit` (optional, default: 168) - Max. Anzahl Ergebnisse

**Features:**
- ✅ Smart Symbol Resolution (findet automatisch Variationen wie `1000PEPE`, `kPEPE`)
- ✅ Mehrere Exchanges gleichzeitig
- ✅ Flexible Zeiträume

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "exchange": "hyperliquid",
      "symbol": "BTC",
      "timestamp": 1768813200,
      "avg_mark_price": 93167.5,
      "avg_funding_rate": 0.0000054075,
      "funding_rate_annual": 0.59212125,
      "avg_open_interest_usd": 1234567890.5,
      "volume_base": 12345.67,
      "volume_quote": 1150000000.0,
      "price_volatility": 2.5
    }
  ],
  "meta": {
    "interval": "1h",
    "count": 168,
    "from": 1768200000,
    "to": 1768813200
  }
}
```

**Beispiele:**
```bash
# Letzte 24h für BTC (alle Exchanges)
curl 'https://api.fundingrate.de/api/normalized-data?symbol=BTC&interval=1h&limit=24'

# Letzte Woche für ETH auf Hyperliquid
curl 'https://api.fundingrate.de/api/normalized-data?exchange=hyperliquid&symbol=ETH&limit=168'

# 15-Sekunden-Daten (letzte 100 Snapshots)
curl 'https://api.fundingrate.de/api/normalized-data?symbol=BTC&interval=15s&limit=100'
```

---

#### `GET /api/market-history`
Stündliche historische Marktdaten für einen spezifischen Exchange und Symbol.

**Query Parameters:**
- `exchange` (required) - Exchange Name
- `symbol` (required) - Original Symbol (exchange-spezifisch)
- `from` (optional) - Start-Timestamp
- `to` (optional) - End-Timestamp
- `limit` (optional, default: 168) - Max. Anzahl

**Beispiel:**
```bash
curl 'https://api.fundingrate.de/api/market-history?exchange=aster&symbol=HYPEUSDT&limit=24'
```

---

#### `GET /api/funding-history`
Historische Funding Rate Daten.

**Query Parameters:**
- `exchange` (required)
- `symbol` (required)
- `from` (optional)
- `to` (optional)
- `limit` (optional, default: 168)

---

### 3. Quick Access Endpoints

#### `GET /api/data/24h`
Letzte 24 Stunden (24 Datenpunkte).

#### `GET /api/data/7d`
Letzte 7 Tage (168 Datenpunkte).

#### `GET /api/data/30d`
Letzte 30 Tage (720 Datenpunkte).

**Query Parameters (alle):**
- `exchange` (optional)
- `symbol` (optional)

**Beispiele:**
```bash
# BTC letzte 24h
curl 'https://api.fundingrate.de/api/data/24h?symbol=BTC'

# Hyperliquid letzte 7 Tage
curl 'https://api.fundingrate.de/api/data/7d?exchange=hyperliquid'
```

---

### 4. Volatility & Analytics

#### `GET /api/volatility`
Volatilitäts-Metriken (24h, 7d, ATR-14, Bollinger Band Width).

**Query Parameters:**
- `exchange` (optional)
- `symbol` (optional)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "symbol": "BTC",
      "exchange": "hyperliquid",
      "volatility_24h": 2.5,
      "volatility_7d": 5.8,
      "atr_14": 1500.0,
      "bb_width": 0.025
    }
  ]
}
```

---

#### `GET /api/funding/ma`
Moving Averages für Funding Rates.

**Query Parameters:**
- `exchange` (required)
- `symbol` (required)
- `period` (optional, default: 24) - MA-Periode in Stunden

---

### 5. Status & Monitoring

#### `GET /api/status`
Health Status aller WebSocket-Tracker.

**Response:**
```json
{
  "success": true,
  "data": {
    "hyperliquid": {
      "status": "running",
      "last_update": 1768813200,
      "message": null
    },
    "edgex": {
      "status": "running",
      "last_update": 1768813180,
      "message": null
    }
  }
}
```

---

#### `GET /api/trackers`
Detaillierte Status-Informationen aller Tracker.

---

#### `GET /tracker/{exchange}/status`
Status eines spezifischen Trackers.

**Exchanges:** `lighter`, `paradex`, `hyperliquid`, `edgex`, `aster`, `pacifica`, `extended`, `hyena`, `xyz`, `flx`, `vntl`, `km`

**Beispiel:**
```bash
curl 'https://api.fundingrate.de/tracker/hyperliquid/status'
```

---

## 🔧 Frontend Integration

### Empfohlene Verwendung

**Für Funding Rate Anzeige:**
```javascript
// ❌ FALSCH - Zeigt unterschiedliche Intervalle gleich an
const displayRate = data.funding_rate * 100;

// ✅ RICHTIG - Zeigt normalisierte Hourly Rate
const displayRate = data.funding_rate_hourly * 100;
```

**Für APR Berechnung:**
```javascript
// ✅ Direkt vom Backend verwenden
const apr = data.funding_rate_annual;
```

**Beispiel-Anzeige:**
```
Extended: +0.0013%/h → APR: 11.39%
Hyena:    +0.00016%/h → APR: 1.37%
```

---

## 📊 Datenmodell

### MarketData Object

```typescript
interface MarketData {
  symbol: string;              // Normalisiertes Symbol (z.B. "BTC")
  exchange: string;            // Exchange Name
  original_symbol: string;     // Original Exchange-Symbol
  mark_price: number;          // Aktueller Mark Price
  index_price: number;         // Index Price
  open_interest_usd: number;   // Open Interest in USD
  volume_24h: number;          // 24h Handelsvolumen
  funding_rate: number;        // Original Funding Rate
  funding_rate_hourly: number; // Normalisiert auf 1h
  funding_rate_annual: number; // APR in %
  next_funding_time: number | null; // Nächste Funding-Zeit (ms)
  price_change_24h: number;    // 24h Preisänderung (%)
  price_low_24h: number;       // 24h Tief
  price_high_24h: number;      // 24h Hoch
  volatility_24h: number | null; // 24h Volatilität (%)
  volatility_7d: number | null;  // 7d Volatilität (%)
  atr_14: number | null;       // 14-Period ATR
  bb_width: number | null;     // Bollinger Band Width
  timestamp: string;           // ISO 8601 Timestamp
}
```

---

## 🌐 CORS

Alle Endpoints unterstützen CORS:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

---

## ⚡ Rate Limits

Aktuell keine Rate Limits implementiert.

---

## 📚 Weitere Dokumentation

- **OpenAPI Spec:** [`openapi.yaml`](./openapi.yaml)
- **Quick Reference:** [`API_QUICK_REFERENCE.md`](./API_QUICK_REFERENCE.md)
- **Detailed Docs:** [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md)

---

## 🔗 Swagger UI

Die OpenAPI-Spezifikation kann mit Swagger UI visualisiert werden:

```bash
# Lokal mit Docker
docker run -p 8080:8080 -e SWAGGER_JSON=/openapi.yaml -v $(pwd):/usr/share/nginx/html swaggerapi/swagger-ui

# Oder online: https://editor.swagger.io/
# Datei openapi.yaml hochladen
```
