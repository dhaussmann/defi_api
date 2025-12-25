# DeFi API - Dokumentation

Echtzeit-Tracker für Crypto-Börsen mit Cloudflare Workers & Durable Objects.

## 🎯 Übersicht

Diese API sammelt und speichert Market-Statistiken von verschiedenen dezentralen Börsen in Echtzeit.

**Unterstützte Börsen:**
- **Lighter** - Dezentraler Perpetual Futures Exchange (WebSocket)
- **Paradex** - Dezentraler Derivate Exchange (WebSocket, nur PERP-Märkte)
- **Hyperliquid** - Dezentraler Perpetual Futures Exchange (API Polling)
- **EdgeX** - Dezentraler Perpetual Futures Exchange (WebSocket)
- **Aster** - Dezentraler Perpetual Futures Exchange (API Polling)
- **Pacifica** - Dezentraler Perpetual Futures Exchange (WebSocket)
- **Extended** - Dezentraler Perpetual Futures Exchange (API Polling)

**Technologie-Stack:**
- Cloudflare Workers (API-Layer)
- Durable Objects (WebSocket-Verbindungen & API Polling)
- D1 Database (Persistente Datenspeicherung)
- 15-Sekunden-Snapshots/Polling für Memory-Effizienz

---

## 📡 Base URL

```
https://defiapi.cloudflareone-demo-account.workers.dev
```

---

## 🚀 Quick Start - Verfügbare API-Endpunkte

### Haupt-Endpunkte

| Endpunkt | Methode | Beschreibung |
|----------|---------|--------------|
| `/api/trackers` | GET | Status aller Exchange-Tracker |
| `/api/tokens` | GET | Liste aller verfügbaren Token (normalisiert) |
| `/api/compare?token=BTC` | GET | Token-Vergleich über alle Börsen |
| **`/api/normalized-data?symbol=BTC&interval=1h`** | **GET** | **🆕 Vereinheitlichter Endpunkt für alle Metriken** |
| **`/api/data/24h?symbol=HYPE`** | **GET** | **🆕 24 Stunden Daten (stündlich)** |
| **`/api/data/7d?symbol=HYPE`** | **GET** | **🆕 7 Tage Daten (stündlich)** |
| **`/api/data/30d?symbol=HYPE`** | **GET** | **🆕 30 Tage Daten (stündlich)** |
| `/api/funding-history?symbol=BTC` | GET | Historische Funding Rates (ab Jan 2025) |
| `/api/market-history?symbol=BTC` | GET | Historische Market-Daten (Preise, Volume, OI, Funding) |
| `/api/volatility?symbol=BTC&interval=1h` | GET | Echtzeit-Volatilität (letzte 7 Tage) |
| `/api/stats?exchange=hyperliquid` | GET | Market-Statistiken einer Börse |
| `/api/stats?symbol=BTC` | GET | Statistiken für ein bestimmtes Symbol |
| `/api/stats?exchange=lighter&symbol=ETH` | GET | Statistiken für Symbol auf spezifischer Börse |

### Beispiel-Anfragen

**1. Status aller Tracker abfragen:**
```bash
curl https://defiapi.cloudflareone-demo-account.workers.dev/api/trackers
```

**2. Alle verfügbaren Token auflisten:**
```bash
curl https://defiapi.cloudflareone-demo-account.workers.dev/api/tokens
```

**3. BTC über alle Börsen vergleichen:**
```bash
curl https://defiapi.cloudflareone-demo-account.workers.dev/api/compare?token=BTC
```

**4. Alle Märkte von Hyperliquid:**
```bash
curl https://defiapi.cloudflareone-demo-account.workers.dev/api/stats?exchange=hyperliquid
```

**5. ETH-Statistiken von allen Börsen:**
```bash
curl https://defiapi.cloudflareone-demo-account.workers.dev/api/stats?symbol=ETH
```

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

### Hyperliquid Exchange

Die gleichen Endpoints sind für Hyperliquid verfügbar:

```bash
POST /tracker/hyperliquid/start
POST /tracker/hyperliquid/stop
GET  /tracker/hyperliquid/status
GET  /tracker/hyperliquid/debug
```

**Technische Details:**
- **Polling-Intervall:** 15 Sekunden (synchronisiert auf :00, :15, :30, :45)
- **API-Endpoint:** `https://api.hyperliquid.xyz/info` (POST mit `{"type":"metaAndAssetCtxs"}`)
- **Daten-Mapping:** `universe`-Array (Symbole) wird mit `assetCtxs`-Array (Werte) über Index gemappt
- **Automatisches Speichern:** Daten werden sofort nach jedem Poll in die Datenbank geschrieben

### EdgeX Exchange

Die gleichen Endpoints sind für EdgeX verfügbar:

```bash
POST /tracker/edgex/start
POST /tracker/edgex/stop
GET  /tracker/edgex/status
GET  /tracker/edgex/debug
```

**Technische Details:**
- **WebSocket-URL:** `wss://quote.edgex.exchange/api/v1/public/ws`
- **Metadata-API:** `https://pro.edgex.exchange/api/v1/public/meta/getMetaData`
- **Subscription-Format:** Jeder Contract wird einzeln im Channel `ticker.{contractId}` subscribt
- **Contract-Anzahl:** ~232 aktive Contracts

### Aster Exchange

Die gleichen Endpoints sind für Aster verfügbar:

```bash
POST /tracker/aster/start
POST /tracker/aster/stop
GET  /tracker/aster/status
GET  /tracker/aster/data
```

**Technische Details:**
- **API-Base:** `https://fapi.asterdex.com/fapi/v1`
- **Polling-Intervall:** 60 Sekunden
- **Endpoints:** exchangeInfo, premiumIndex, fundingInfo, openInterest, klines
- **Contract-Type:** Nur PERPETUAL Contracts
- **Open Interest Berechnung:** OI * Preis (zum OI-Timestamp) * 2

### Pacifica Exchange

Die gleichen Endpoints sind für Pacifica verfügbar:

```bash
POST /tracker/pacifica/start
POST /tracker/pacifica/stop
GET  /tracker/pacifica/status
GET  /tracker/pacifica/data
```

**Technische Details:**
- **WebSocket-URL:** `wss://ws.pacifica.fi/ws`
- **Subscription:** `{"method": "subscribe", "params": {"source": "prices"}}`
- **Heartbeat:** Alle 30 Sekunden (Connection timeout nach 60s Inaktivität)
- **Open Interest Berechnung:** OI * Mark Price
- **Volume:** 24h Volume bereits in USD

### Extended Exchange

Die gleichen Endpoints sind für Extended verfügbar:

```bash
POST /tracker/extended/start
POST /tracker/extended/stop
GET  /tracker/extended/status
GET  /tracker/extended/data
```

**Technische Details:**
- **API-Base:** `https://api.starknet.extended.exchange/api/v1`
- **Polling-Intervall:** 15 Sekunden (API Polling)
- **Snapshot-Intervall:** 60 Sekunden (Speicherung in DB)
- **Endpoint:** `/info/markets`
- **User-Agent:** Browser-UA erforderlich (API blockt Cloudflare Workers standardmäßig)
- **Filter:** Nur ACTIVE Markets (status: "ACTIVE" && active: true)
- **Open Interest:** Bereits in USD (keine Berechnung erforderlich)
- **Volume:** dailyVolume bereits in USD
- **Symbol-Format:** `BTC-USD`, `ETH-USD`, etc.

### Backward Compatibility

Für Abwärtskompatibilität routen `/tracker/*` Endpoints automatisch zu Lighter:

```bash
POST /tracker/start    # → Lighter
GET  /tracker/status   # → Lighter
```

---

## 📊 Data API Endpoints

Diese Endpoints liefern gespeicherte Market-Daten aus der Datenbank.

### 1. Cross-Exchange Token-Vergleich

**NEU:** Vergleichen Sie einen Token über alle unterstützten Börsen hinweg.

```bash
GET /api/compare?token=<TOKEN>
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Beschreibung |
|-----------|-----|---------|--------------|
| `token` | string | Ja | Base Asset Symbol (z.B. `BTC`, `ETH`, `SOL`) |

**Beispiele:**

```bash
# BTC über alle Börsen vergleichen
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/compare?token=BTC"

# ETH über alle Börsen vergleichen
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/compare?token=ETH"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "BTC",
    "exchanges_count": 7,
    "exchanges": [
      {
        "exchange": "aster",
        "original_symbol": "BTCUSDT",
        "normalized_symbol": "BTC",
        "mark_price": 87494.2,
        "index_price": 87525.5,
        "open_interest": 5979.679,
        "open_interest_usd": 1048821848.486,
        "funding_rate": 0.00006133,
        "funding_rate_annual": 6.72,
        "next_funding_time": "1766419200000",
        "volume_24h": 0,
        "price_low_24h": 0,
        "price_high_24h": 0,
        "price_change_24h": 0,
        "timestamp": "2025-12-23 07:47:57"
      },
      {
        "exchange": "extended",
        "original_symbol": "BTC-USD",
        "normalized_symbol": "BTC",
        "mark_price": 87440.32,
        "index_price": 87482.75,
        "open_interest": 48139617.83,
        "open_interest_usd": 48139617.83,
        "funding_rate": 0.000006,
        "funding_rate_annual": 0.657,
        "next_funding_time": "1766419200000",
        "volume_24h": 504307335.62,
        "price_low_24h": 87826,
        "price_high_24h": 90496,
        "price_change_24h": 1227,
        "timestamp": "2025-12-23 07:47:29"
      }
      // ... weitere Börsen (hyperliquid, lighter, edgex, pacifica, paradex)
    ],
    "aggregated": {
      "total_open_interest_usd": 4362746369.72,
      "avg_price": 87503.29,
      "min_price": 87307.74,
      "max_price": 87541.6,
      "price_spread_pct": 0.27,
      "avg_funding_rate": 0.000176,
      "avg_funding_rate_annual_pct": 19.27
    }
  }
}
```

**Besonderheiten:**
- Normalisiert automatisch verschiedene Symbol-Namen (BTC, BTCUSDT, BTC-USD, BTC-USD-PERP → BTC)
- Berechnet aggregierte Statistiken über alle Börsen
- Zeigt Preis-Spread und durchschnittliche Funding Rates
- Nur die neuesten Daten für jede Börse (SQL Window Function)

**Symbol-Normalisierung:**
Die API erkennt automatisch folgende Varianten:
- `BTCUSDT` (Aster) → `BTC`
- `BTCUSD` (EdgeX) → `BTC`
- `BTC-USD` (Extended) → `BTC`
- `BTC-USD-PERP` (Paradex) → `BTC`
- `BTC` (Hyperliquid, Lighter, Pacifica) → `BTC`
- Präfixe wie `1000PEPE` → `PEPE` oder `kBONK` → `BONK`

---

### 2. Zeitbasierte Schnell-Endpunkte (24h, 7d, 30d)

**🆕 EMPFOHLEN für schnellen Zugriff:** Vorkonfigurierte Endpunkte für häufige Zeiträume mit stündlicher Aggregation.

```bash
GET /api/data/24h?symbol=<SYMBOL>
GET /api/data/7d?symbol=<SYMBOL>
GET /api/data/30d?symbol=<SYMBOL>
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Beschreibung |
|-----------|-----|---------|--------------|
| `symbol` | string | **Ja** | Normalisiertes Token-Symbol (z.B. `BTC`, `ETH`, `HYPE`) |
| `exchange` | string | Nein | Optional: Filtert nach spezifischer Börse |

**Beispiele:**

```bash
# HYPE letzte 24 Stunden (24 Datenpunkte à 1 Stunde)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/data/24h?symbol=HYPE"

# BTC letzte 7 Tage (168 Datenpunkte à 1 Stunde)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/data/7d?symbol=BTC"

# ETH letzte 30 Tage (720 Datenpunkte à 1 Stunde)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/data/30d?symbol=ETH"

# HYPE nur auf Hyperliquid (letzte 7 Tage)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/data/7d?symbol=HYPE&exchange=hyperliquid"

# Mehrere Symbole parallel abfragen
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/data/24h?symbol=BTC" &
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/data/24h?symbol=ETH" &
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/data/24h?symbol=HYPE" &
wait
```

**Response:**

Identisch mit `/api/normalized-data` - siehe Abschnitt 5 für Details.

**Vorkonfigurierte Werte:**

| Endpunkt | Zeitraum | Datenpunkte | Interval | Limit |
|----------|----------|-------------|----------|-------|
| `/api/data/24h` | Letzte 24 Stunden | 24 | 1h | 24 |
| `/api/data/7d` | Letzte 7 Tage | 168 | 1h | 168 |
| `/api/data/30d` | Letzte 30 Tage | 720 | 1h | 720 |

**Vorteile:**

✅ **Einfachste Verwendung** - Nur Symbol erforderlich
✅ **Optimiert für häufige Use Cases** - 24h, 7d, 30d Analysen
✅ **Konsistente stündliche Daten** - Immer 1h Aggregation
✅ **Keine Parameter-Verwirrung** - Vorkonfiguriert und getestet

**Anwendungsfälle:**

- **24h**: Intraday-Trading, aktuelle Funding Rate Trends
- **7d**: Wochenanalyse, mittelfristige Strategien
- **30d**: Monatsanalyse, langfristige Trends

---

### 3. Historische Funding Rates

**NEU:** Abfrage historischer Funding Rate Daten (ab 1. Januar 2025).

```bash
GET /api/funding-history?symbol=<SYMBOL>
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Default | Beschreibung |
|-----------|-----|---------|---------|--------------|
| `symbol` | string | Ja | - | Normalisiertes Token-Symbol (z.B. `BTC`, `ETH`, `SOL`) |
| `exchange` | string | Nein | - | Filtert nach spezifischer Börse |
| `from` | number | Nein | - | Start-Timestamp in Millisekunden |
| `to` | number | Nein | - | End-Timestamp in Millisekunden |
| `limit` | number | Nein | `1000` | Maximale Anzahl Ergebnisse (1-10000) |

**Beispiele:**

```bash
# BTC Funding Rate History (neueste 100 Einträge)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/funding-history?symbol=BTC&limit=100"

# BTC auf Hyperliquid
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/funding-history?symbol=BTC&exchange=hyperliquid&limit=500"

# ETH für einen bestimmten Zeitraum (Januar 2025)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/funding-history?symbol=ETH&from=1735689600000&to=1738368000000"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "exchange": "hyperliquid",
      "symbol": "BTC",
      "trading_pair": "BTC",
      "funding_rate": 0.0000125,
      "funding_rate_percent": 0.00125,
      "annualized_rate": 10.95,
      "collected_at": 1735689600054,
      "timestamp": "2025-01-01 00:00:00"
    },
    // ... weitere historische Einträge
  ],
  "stats": {
    "count": 100,
    "avg_rate": 37.38,
    "min_rate": 10.95,
    "max_rate": 54.21,
    "time_range": {
      "from": "2025-01-01 00:00:00",
      "to": "2025-01-01 09:00:00"
    }
  },
  "meta": {
    "symbol": "BTC",
    "exchange": "hyperliquid",
    "interval": "1h",
    "limit": 100
  }
}
```

**Besonderheiten:**
- Stündliche Snapshots seit 1. Januar 2025
- **Datenquellen kombiniert**:
  - `funding_rate_history`: Importierte historische Daten (Hyperliquid, Lighter, Aster, Paradex seit 1.1.2025)
  - `market_history`: Aggregierte Daten aus Live-Trackern (alle 7 Exchanges für Daten ≥ 7 Tage alt)
- Automatische Deduplizierung bei Überschneidungen
- Automatische Statistik-Berechnung (Durchschnitt, Min, Max)
- Timestamps in Millisekunden und ISO-Format
- Annualisierte Rates (APR in Prozent)
- **Unterstützte Exchanges**: Alle 7 (Hyperliquid, Lighter, Aster, Paradex, EdgeX, Pacifica, Extended)

**Funding Rate Berechnung:**
- `funding_rate`: Dezimalformat (0.000125)
- `funding_rate_percent`: Prozent (0.0125%)
- `annualized_rate`: APR (10.95%)
- Formel: `annualized_rate = funding_rate × 100 × 3 × 365`
  - × 100: Dezimal zu Prozent
  - × 3: Drei 8-Stunden-Perioden pro Tag
  - × 365: Tage pro Jahr

---

### 4. Historische Market-Daten (Alle Metriken)

**NEU:** Abfrage aggregierter historischer Market-Daten mit allen Metriken (Daten ≥ 7 Tage alt).

```bash
GET /api/market-history
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Default | Beschreibung |
|-----------|-----|---------|---------|--------------|
| `symbol` | string | Nein | - | Normalisiertes Token-Symbol (z.B. `BTC`, `ETH`, `SOL`) |
| `exchange` | string | Nein | - | Filtert nach spezifischer Börse |
| `from` | number | Nein | - | Start-Timestamp in Sekunden |
| `to` | number | Nein | - | End-Timestamp in Sekunden |
| `limit` | number | Nein | `1000` | Maximale Anzahl Ergebnisse (1-10000) |
| `metric` | string | Nein | `all` | Filter: `all`, `price`, `volume`, `oi`, `funding` |

**Beispiele:**

```bash
# BTC Preis-History mit Volatilität
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/market-history?symbol=BTC&metric=price&limit=100"

# Volumen-Analyse für alle Exchanges
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/market-history?metric=volume&limit=500"

# Open Interest für ETH auf Hyperliquid
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/market-history?symbol=ETH&exchange=hyperliquid&metric=oi"

# Funding Rates im Januar 2025
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/market-history?metric=funding&from=1735689600&to=1738368000"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "exchange": "hyperliquid",
      "symbol": "BTC-USD",
      "normalized_symbol": "BTC",
      "avg_mark_price": 94250.5,
      "avg_index_price": 94255.2,
      "min_price": 94100.0,
      "max_price": 94500.0,
      "price_volatility": 0.424,
      "volume_base": 125.5,
      "volume_quote": 11829750.25,
      "avg_open_interest": 1250000000,
      "avg_open_interest_usd": 1250000000,
      "max_open_interest_usd": 1255000000,
      "avg_funding_rate": 0.0001,
      "avg_funding_rate_annual": 10.95,
      "min_funding_rate": 0.00008,
      "max_funding_rate": 0.00012,
      "hour_timestamp": 1735689600,
      "sample_count": 240,
      "timestamp": "2025-01-01 00:00:00"
    }
  ],
  "stats": {
    "count": 100,
    "price": {
      "avg": 94300.5,
      "min": 93500.0,
      "max": 95100.0,
      "avg_volatility": 0.38
    },
    "volume": {
      "total_usd": 1182975025.0,
      "avg_hourly_usd": 11829750.25,
      "max_hourly_usd": 15000000.0
    },
    "open_interest": {
      "avg_usd": 1250000000,
      "min_usd": 1240000000,
      "max_usd": 1260000000
    },
    "funding_rate": {
      "avg_apr": 10.5,
      "min_apr": 8.2,
      "max_apr": 12.8
    },
    "time_range": {
      "from": "2025-01-01 00:00:00",
      "to": "2025-01-05 03:00:00"
    }
  },
  "meta": {
    "symbol": "BTC",
    "exchange": "all",
    "metric": "all",
    "limit": 100,
    "interval": "1h"
  }
}
```

**Besonderheiten:**
- **Stündliche Aggregation**: Daten älter als 7 Tage werden automatisch zu Stunden-Snapshots komprimiert
- **Alle 7 Exchanges**: EdgeX, Pacifica, Extended werden erfasst (ab 7 Tage nach Tracker-Start)
- **Volatilität berechnet**: `(max_price - min_price) / avg_price × 100`
- **Sample Count**: Zeigt wie viele 15s-Snapshots in jede Stunde aggregiert wurden (~240 bei voller Verfügbarkeit)
- **Metric Filter**: Optimiert Statistik-Berechnung auf gewünschte Metrik
- **Automatische Aggregation**: Läuft jede Stunde zur vollen Stunde via Cron

**Anwendungsfälle:**
- Langfristige Preis-Trends und Volatilitätsanalyse
- Volumen-Muster über Wochen/Monate
- Open Interest Entwicklung
- Funding Rate Korrelationen mit Preisbewegungen
- Cross-Exchange Arbitrage-Analysen

---

### 5. Echtzeit-Volatilität

**NEU:** Berechnet Volatilität aus Live-Daten der letzten 7 Tage.

```bash
GET /api/volatility
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Default | Beschreibung |
|-----------|-----|---------|---------|--------------|
| `symbol` | string | Nein | - | Filtert nach Symbol (z.B. `BTC`, `ETH`) |
| `exchange` | string | Nein | - | Filtert nach Exchange |
| `interval` | string | Nein | `1h` | Zeitintervall: `15m`, `1h`, `4h`, `1d` |
| `limit` | number | Nein | `24` | Maximale Anzahl Intervalle (1-1000) |

**Beispiele:**

```bash
# BTC Stunden-Volatilität (letzte 24h)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/volatility?symbol=BTC&interval=1h&limit=24"

# ETH 4-Stunden-Volatilität auf Hyperliquid
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/volatility?symbol=ETH&exchange=hyperliquid&interval=4h"

# Alle Token Tages-Volatilität
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/volatility?interval=1d&limit=7"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "exchange": "hyperliquid",
      "symbol": "BTC",
      "bucket_time": 1766596800,
      "min_price": 94100.0,
      "max_price": 94500.0,
      "avg_price": 94250.5,
      "sample_count": 240,
      "volatility": 0.424,
      "timestamp": "2025-12-24 17:00:00"
    }
  ],
  "stats": {
    "count": 24,
    "volatility": {
      "avg": 0.38,
      "min": 0.15,
      "max": 0.82,
      "current": 0.424
    },
    "price": {
      "current": 94250.5,
      "min": 93500.0,
      "max": 95100.0
    },
    "time_range": {
      "from": "2025-12-23 17:00:00",
      "to": "2025-12-24 17:00:00"
    }
  },
  "meta": {
    "symbol": "BTC",
    "exchange": "all",
    "interval": "1h",
    "limit": 24
  }
}
```

**Besonderheiten:**
- **Echtzeit-Berechnung**: Aus aktuellen `market_stats` Daten (letzte 7 Tage)
- **Volatilitäts-Formel**: `(max_price - min_price) / avg_price × 100`
- **Flexible Intervalle**: 15m für Intraday, 1h/4h für Day-Trading, 1d für Swing-Trading
- **Sample Count**: Zeigt Anzahl der 15s-Snapshots pro Intervall (z.B. ~240 für 1h)
- **Alle 7 Exchanges**: Sofort verfügbar für alle Exchanges

**Interpretation:**
- `volatility: 0.424` = 0.424% Preisschwankung in diesem Intervall
- Höhere Werte = größere Volatilität = höheres Risiko/Chance
- `current` = Volatilität des aktuellsten Intervalls
- `avg` = Durchschnittliche Volatilität über den Zeitraum

---

### 6. Normalisierte Daten (Vereinheitlichter Endpunkt)

**🆕 EMPFOHLEN:** Universeller Endpunkt für alle normalisierten Market-Daten mit flexibler Zeitauflösung.

```bash
GET /api/normalized-data
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Default | Beschreibung |
|-----------|-----|---------|---------|--------------|
| `symbol` | string | **Ja** | - | Normalisiertes Token-Symbol (z.B. `BTC`, `ETH`, `SOL`) |
| `exchange` | string | Nein | `all` | Filtert nach spezifischer Börse |
| `from` | number | Nein | `-7 days` | Start-Timestamp (Sekunden oder Millisekunden) |
| `to` | number | Nein | `now` | End-Timestamp (Sekunden oder Millisekunden) |
| `limit` | number | Nein | `168` | Maximale Anzahl Ergebnisse (1-10000), Default: 168 = 7 Tage à 24 Stunden |
| `interval` | string | Nein | `1h` | Zeitauflösung: `1h` (empfohlen), `raw`, `15m`, `4h`, `1d`, `auto` |

**Interval-Modi:**

- **`1h`** (DEFAULT) - Stündliche Aggregation - empfohlen für die meisten Anwendungsfälle
- `15m` - 15-Minuten-Aggregation für granularere Analyse
- `4h` - 4-Stunden-Aggregation für Swing-Trading
- `1d` - Tägliche Aggregation für langfristige Trends
- `raw` - 15-Sekunden-Snapshots (nur letzte 7 Tage, sehr große Datenmengen)
- `auto` - Wählt automatisch beste Auflösung basierend auf Zeitraum

**Beispiele:**

```bash
# BTC letzte 24 Stunden (stündlich aggregiert)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/normalized-data?symbol=BTC&interval=1h&limit=24"

# ETH letzte 7 Tage (täglich aggregiert)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/normalized-data?symbol=ETH&interval=1d&limit=7"

# SOL auf Hyperliquid (4-Stunden-Intervalle)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/normalized-data?symbol=SOL&exchange=hyperliquid&interval=4h&limit=42"

# BTC spezifischer Zeitraum (letzte Woche)
FROM=$(date -u -v-7d +%s)
TO=$(date -u +%s)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/normalized-data?symbol=BTC&from=${FROM}&to=${TO}&interval=1h"

# Ohne Parameter (verwendet Defaults: interval=1h, limit=168)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/normalized-data?symbol=BTC"

# HYPE Funding Rates - letzte 7 Tage (168 Stunden)
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/normalized-data?symbol=HYPE"

# HYPE nur auf Hyperliquid
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/normalized-data?symbol=HYPE&exchange=hyperliquid"
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "exchange": "hyperliquid",
      "original_symbol": "BTC",
      "normalized_symbol": "BTC",
      "mark_price": 87825.0,
      "index_price": 87849.0,
      "min_price": 87800.0,
      "max_price": 87850.0,
      "volatility": 0.057,
      "volume_base": 1390744561.78,
      "volume_quote": 1390744561.78,
      "open_interest": 22938.23418,
      "open_interest_usd": 2014550416.86,
      "max_open_interest_usd": 2015000000.0,
      "funding_rate": 0.0000125,
      "funding_rate_annual": 1.36875,
      "min_funding_rate": 0.0000100,
      "max_funding_rate": 0.0000150,
      "sample_count": 240,
      "timestamp": 1766650259,
      "timestamp_iso": "2025-12-25 08:10:59",
      "data_source": "calculated",
      "interval": "1h"
    }
    // ... weitere Datenpunkte
  ],
  "stats": {
    "count": 24,
    "price": {
      "current": 87825.0,
      "avg": 87829.69,
      "min": 87780.27,
      "max": 87850.6
    },
    "volatility": {
      "current": 0.057,
      "avg": 0.045,
      "min": 0.012,
      "max": 0.082
    },
    "funding_rate": {
      "current_apr": 1.36875,
      "avg_apr": 35.18,
      "min_apr": 1.36875,
      "max_apr": 131.4
    },
    "open_interest": {
      "current_usd": 2014550416.86,
      "avg_usd": 5465783217305.68,
      "min_usd": 2014550416.86,
      "max_usd": 21101755263257.22
    },
    "time_range": {
      "from": "2025-12-24 08:10:59",
      "to": "2025-12-25 08:10:59",
      "from_timestamp": 1766563859,
      "to_timestamp": 1766650259
    }
  },
  "meta": {
    "symbol": "BTC",
    "exchange": "hyperliquid",
    "interval": "1h",
    "limit": 24,
    "data_sources": [
      "calculated"
    ]
  }
}
```

**Datenquellen (data_source):**

- `calculated` - Berechnet aus `market_stats` (letzte 7 Tage, On-Demand-Aggregation)
- `aggregated` - Aus `market_history` (>7 Tage alt, vorberechnete Stunden-Aggregation)
- `raw` - Direkt aus `market_stats` (15-Sekunden-Snapshots)

**Vorteile dieses Endpoints:**

✅ **Ein Endpunkt für alles** - Alle Metriken in einer Abfrage
✅ **Flexible Zeitauflösung** - Von Sekunden bis Tage
✅ **Automatische Optimierung** - Auto-Mode wählt beste Auflösung
✅ **Kombinierte Datenquellen** - Historical + Recent nahtlos vereint
✅ **Umfassende Statistiken** - Automatische Berechnung von Min/Max/Avg
✅ **Alle 7 Exchanges** - Vollständige Abdeckung

**Anwendungsfälle:**

- **Trading Dashboards:** Echtzeit-Preise mit 15s-Auflösung
- **Technische Analyse:** Stunden-/Tages-Charts mit OHLC-Daten
- **Volatilitäts-Monitoring:** Min/Max-Preise pro Intervall
- **Funding Rate Trends:** APR-Entwicklung über Zeit
- **Open Interest Tracking:** OI-Veränderungen pro Stunde/Tag
- **Cross-Exchange-Vergleiche:** Multi-Exchange-Daten in einem Call

---

### 7. Neueste Market Stats

Liefert die neuesten Daten für jedes Symbol (ein Datensatz pro Symbol).

```bash
GET /api/latest
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Default | Beschreibung |
|-----------|-----|---------|---------|--------------|
| `exchange` | string | Nein | `lighter` | Exchange-Name (`lighter`, `paradex`, `hyperliquid`, `edgex`, `aster`, `pacifica`, `extended`) |
| `symbol` | string | Nein | - | Filtert nach einem bestimmten Symbol |

**Beispiele:**

```bash
# Neueste Stats von Lighter
curl "https://defiapi.workers.dev/api/latest?exchange=lighter"

# Neueste Stats von Paradex
curl "https://defiapi.workers.dev/api/latest?exchange=paradex"

# Neueste Stats von Hyperliquid
curl "https://defiapi.workers.dev/api/latest?exchange=hyperliquid"

# Nur BTC von Hyperliquid
curl "https://defiapi.workers.dev/api/latest?exchange=hyperliquid&symbol=BTC"
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

### 8. Historische Market Stats

Liefert historische Daten mit Filtermöglichkeiten.

```bash
GET /api/stats
```

**Query-Parameter:**

| Parameter | Typ | Pflicht | Default | Beschreibung |
|-----------|-----|---------|---------|--------------|
| `exchange` | string | Nein | `lighter` | Exchange-Name (`lighter`, `paradex`, `hyperliquid`, `edgex`, `aster`, `pacifica`, `extended`) |
| `symbol` | string | Nein | - | Filtert nach Symbol |
| `from` | number | Nein | - | Start-Timestamp in Millisekunden |
| `to` | number | Nein | - | End-Timestamp in Millisekunden |
| `limit` | number | Nein | `100` | Maximale Anzahl Ergebnisse (1-1000) |

**Beispiele:**

```bash
# Letzte 50 Einträge für BTC von Hyperliquid
curl "https://defiapi.workers.dev/api/stats?exchange=hyperliquid&symbol=BTC&limit=50"

# Alle Hyperliquid-Daten der letzten Stunde
curl "https://defiapi.workers.dev/api/stats?exchange=hyperliquid&from=1702908745000&to=1702912345000"

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

### 9. Tracker Status (Datenbank)

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
    },
    {
      "id": 3,
      "exchange": "hyperliquid",
      "status": "running",
      "last_message_at": 1702912347,
      "error_message": null,
      "reconnect_count": 0,
      "updated_at": 1702912347
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
| `exchange` | String | Exchange-Name (`lighter`, `paradex`, `hyperliquid`, `edgex`) |
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
- Felder mit `(Lighter only)` sind bei Paradex und Hyperliquid auf `"0"` gesetzt
- Bei Hyperliquid: Symbole sind kürzer (z.B. `BTC` statt `BTC-USD-PERP`)

---

## 🚀 Verwendungsbeispiele

### Python

```python
import requests
from datetime import datetime, timedelta

BASE_URL = "https://defiapi.workers.dev"

# 1. Tracker starten
response = requests.post(f"{BASE_URL}/tracker/hyperliquid/start")
print(response.json())

# 2. Neueste Daten abrufen
response = requests.get(f"{BASE_URL}/api/latest", params={
    "exchange": "hyperliquid"
})
data = response.json()
print(f"Found {data['meta']['count']} markets")

# 3. Historische Daten für BTC
now = int(datetime.now().timestamp() * 1000)
one_hour_ago = int((datetime.now() - timedelta(hours=1)).timestamp() * 1000)

response = requests.get(f"{BASE_URL}/api/stats", params={
    "exchange": "hyperliquid",
    "symbol": "BTC",
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

// 1. Neueste Hyperliquid-Daten abrufen
async function getLatestData() {
  const response = await fetch(`${BASE_URL}/api/latest?exchange=hyperliquid`);
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
  const response = await fetch(`${BASE_URL}/api/latest?exchange=hyperliquid`);
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
curl -X POST "$BASE_URL/tracker/hyperliquid/start"

# Status prüfen
curl "$BASE_URL/tracker/hyperliquid/status" | jq .

# Neueste Daten
curl "$BASE_URL/api/latest?exchange=hyperliquid" | jq '.data[0:5]'

# BTC Daten der letzten Stunde
FROM=$(date -d '1 hour ago' +%s)000
TO=$(date +%s)000
curl "$BASE_URL/api/stats?exchange=hyperliquid&symbol=BTC&from=$FROM&to=$TO" | jq .

# Funding Rates exportieren
curl "$BASE_URL/api/latest?exchange=hyperliquid" | \
  jq -r '.data[] | [.symbol, .funding_rate, .mark_price] | @csv' > funding_rates.csv
```

---

## 🔄 Auto-Start Mechanismus

Die Tracker starten **automatisch** bei jedem Request:

- Wenn Sie einen API-Endpoint aufrufen, werden alle drei Tracker automatisch gestartet (falls nicht bereits aktiv)
- Sie müssen `/tracker/{exchange}/start` nur manuell aufrufen, wenn Sie einen gestoppten Tracker neu starten möchten
- WebSocket-Tracker (Lighter, Paradex) verbinden sich automatisch neu bei Verbindungsabbrüchen (max. 10 Versuche)
- Hyperliquid-Tracker pollt kontinuierlich alle 15 Sekunden (synchronisiert auf :00, :15, :30, :45)

**Empfehlung:** Lassen Sie die Tracker einfach laufen. Sie starten automatisch und benötigen keine manuelle Verwaltung.

---

## 📈 Snapshot-Mechanismus & Polling

**WebSocket-Tracker (Lighter, Paradex):**

1. **WebSocket → Buffer:** Eingehende Market-Updates werden im RAM gebuffert
2. **Buffer → Database:** Alle 15 Sekunden wird ein Snapshot in die D1-Datenbank geschrieben
3. **Buffer Cleanup:** Nach dem Snapshot wird der Buffer geleert, um Speicher freizugeben

**API-Polling-Tracker (Hyperliquid):**

1. **API Poll:** Alle 15 Sekunden wird die API abgefragt (synchronisiert auf :00, :15, :30, :45)
2. **universe ↔ assetCtxs Mapping:** Symbole aus `universe`-Array werden mit Werten aus `assetCtxs`-Array über Index gemappt
3. **Sofortiges Speichern:** Daten werden direkt nach jedem erfolgreichen Poll in die Datenbank geschrieben
4. **Timestamp-Synchronisation:** Polling ist zeitgesteuert für konsistente Timestamps

**Vorteile:**
- ✅ Memory-effizient (Buffer wird regelmäßig geleert)
- ✅ Performance-optimiert (Batch-Inserts statt einzelne Inserts)
- ✅ Reduzierte Datenbank-Load
- ✅ Konsistente 15-Sekunden-Intervalle über alle Exchanges

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
# Status aller Tracker prüfen
curl https://defiapi.workers.dev/api/status | jq .

# Detaillierte Debug-Info
curl https://defiapi.workers.dev/tracker/lighter/debug | jq .
curl https://defiapi.workers.dev/tracker/paradex/debug | jq .
curl https://defiapi.workers.dev/tracker/hyperliquid/debug | jq .
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
curl -X POST https://your-worker.workers.dev/tracker/hyperliquid/start
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

**Version:** 1.2.0
**Letzte Aktualisierung:** 2024-12-19

---

## 📝 Changelog

### v1.2.0 (2024-12-19)
- ✨ EdgeX Exchange Support hinzugefügt
- 🔌 WebSocket-basierter Tracker für ~232 EdgeX Contracts
- 📊 Einzelne Subscription pro Contract (ticker.{contractId})

### v1.1.0 (2024-12-19)
- ✨ Hyperliquid Exchange Support hinzugefügt
- 🔄 API-Polling-Mechanismus für Hyperliquid (alle 15 Sekunden)
- ⏰ Zeitgesteuerte Polling-Synchronisation auf :00, :15, :30, :45
- 📊 Unterstützung für universe ↔ assetCtxs Mapping

### v1.0.0 (2024-12-18)
- ✨ Lighter und Paradex Exchange Support
- 🔌 WebSocket-basierte Tracker
- 💾 15-Sekunden-Snapshots in D1 Database
