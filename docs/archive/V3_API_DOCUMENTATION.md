# V3 API Documentation

API-Endpunkte für Cross-Exchange Funding Rate Queries aus der `unified_v3` Tabelle.

**Base URL:** `https://api.fundingrate.de`

---

## Endpoints

### 1. GET `/api/v3/funding/rates`

Query funding rates (1h normalized) mit flexiblen Filtern.

#### Query Parameters:

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `symbol` | string | **Yes** | Symbol (normalisiert) | `BTC`, `ETH`, `SOL` |
| `exchanges` | string | No | Komma-separierte Liste von Exchanges | `hyperliquid,paradex,edgex` |
| `range` | string | No | Zeitbereich | `24h`, `3d`, `7d`, `14d`, `30d` |
| `from` | string | No | Start-Zeit (ISO 8601 oder Unix timestamp) | `2026-02-03T11:00:00Z` oder `1738584000` |
| `to` | string | No | End-Zeit (ISO 8601 oder Unix timestamp) | `2026-02-05T14:00:00Z` oder `1738756800` |
| `limit` | number | No | Max. Anzahl Ergebnisse (1-10000) | `1000` (default) |

#### Response:

```json
{
  "success": true,
  "symbol": "BTC",
  "filters": {
    "exchanges": ["hyperliquid", "paradex"],
    "timeRange": {
      "from": "2026-02-05T10:06:00Z",
      "to": "2026-02-06T10:06:00Z"
    }
  },
  "count": 245,
  "data": [
    {
      "normalized_symbol": "BTC",
      "exchange": "hyperliquid",
      "funding_time": 1738839600,
      "timestamp": "2026-02-06 08:00:00",
      "original_symbol": "BTC",
      "rate_1h_percent": -0.001272,
      "interval_hours": 8,
      "source": "api"
    }
  ]
}
```

#### Beispiele:

```bash
# Alle BTC Funding Rates der letzten 24h
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=BTC&range=24h"

# Nur Hyperliquid und Paradex, letzte 7 Tage
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=ETH&exchanges=hyperliquid,paradex&range=7d"

# Alle Exchanges, letzten 3 Tage, max 100 Ergebnisse
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=SOL&range=3d&limit=100"

# Custom Zeitbereich mit ISO 8601
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=BTC&from=2026-02-03T11:00:00Z&to=2026-02-05T14:00:00Z"

# Custom Zeitbereich mit Unix timestamps
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=BTC&from=1738584000&to=1738756800"
```

---

### 2. GET `/api/v3/funding/apr`

Query funding rates APR (annualisiert) mit flexiblen Filtern.

#### Query Parameters:

Identisch zu `/api/v3/funding/rates`

#### Response:

```json
{
  "success": true,
  "symbol": "ETH",
  "filters": {
    "exchanges": "all",
    "timeRange": {
      "from": "2026-02-03T10:06:00Z",
      "to": "2026-02-06T10:06:00Z"
    }
  },
  "count": 189,
  "data": [
    {
      "normalized_symbol": "ETH",
      "exchange": "paradex",
      "funding_time": 1738839200,
      "timestamp": "2026-02-06 07:53:20",
      "original_symbol": "ETH-USD-PERP",
      "rate_apr": 45.67,
      "rate_1h_percent": 0.00521,
      "interval_hours": 1,
      "source": "api"
    }
  ]
}
```

#### Beispiele:

```bash
# ETH APR, letzte 24h, alle Exchanges
curl "https://api.fundingrate.de/api/v3/funding/apr?symbol=ETH&range=24h"

# BTC APR, nur Extended und EdgeX, letzte 7 Tage
curl "https://api.fundingrate.de/api/v3/funding/apr?symbol=BTC&exchanges=extended,edgex&range=7d"

# SOL APR, custom Zeitbereich
curl "https://api.fundingrate.de/api/v3/funding/apr?symbol=SOL&from=2026-02-01T00:00:00Z&to=2026-02-06T00:00:00Z"
```

---

### 3. GET `/api/v3/funding/summary`

Aggregierte Statistiken für ein Symbol über alle Exchanges.

#### Query Parameters:

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `symbol` | string | **Yes** | Symbol (normalisiert) | `BTC`, `ETH`, `SOL` |
| `range` | string | No | Zeitbereich (default: `24h`) | `24h`, `3d`, `7d`, `14d`, `30d` |

#### Response:

```json
{
  "success": true,
  "symbol": "BTC",
  "timeRange": {
    "from": "2026-02-05T10:06:00Z",
    "to": "2026-02-06T10:06:00Z",
    "range": "24h"
  },
  "exchanges": [
    {
      "exchange": "hyperliquid",
      "data_points": 24,
      "avg_rate_1h": -0.00089,
      "min_rate_1h": -0.00251,
      "max_rate_1h": 0.00012,
      "avg_apr": -7.8,
      "min_apr": -22.0,
      "max_apr": 1.05,
      "latest_funding_time": 1738839600
    },
    {
      "exchange": "paradex",
      "data_points": 1440,
      "avg_rate_1h": -0.00102,
      "min_rate_1h": -0.00287,
      "max_rate_1h": 0.00008,
      "avg_apr": -8.9,
      "min_apr": -25.1,
      "max_apr": 0.7,
      "latest_funding_time": 1738839520
    }
  ]
}
```

#### Beispiele:

```bash
# BTC Summary, letzte 24h
curl "https://api.fundingrate.de/api/v3/funding/summary?symbol=BTC&range=24h"

# ETH Summary, letzte 7 Tage
curl "https://api.fundingrate.de/api/v3/funding/summary?symbol=ETH&range=7d"

# SOL Summary, letzte 30 Tage
curl "https://api.fundingrate.de/api/v3/funding/summary?symbol=SOL&range=30d"
```

---

## Zeitbereich-Formate

### Vordefinierte Bereiche (`range` Parameter):

- `24h` - Letzte 24 Stunden
- `3d` - Letzte 3 Tage
- `7d` - Letzte 7 Tage
- `14d` - Letzte 14 Tage
- `30d` - Letzte 30 Tage

### Custom Zeitbereiche (`from` / `to` Parameter):

**ISO 8601 Format:**
```
2026-02-03T11:00:00Z
2026-02-05T14:00:00.000Z
```

**Unix Timestamp (Sekunden):**
```
1738584000
1738756800
```

---

## Verfügbare Exchanges

Die folgenden Exchanges sind in der `unified_v3` Tabelle verfügbar:

- `hyperliquid`
- `paradex`
- `edgex`
- `extended`
- `lighter`
- `aster`
- `variational`
- `hyena`
- `felix`
- `ventuals`
- `xyz`
- `nado`

---

## Symbol-Normalisierung

Alle Symbole werden automatisch normalisiert:

| Original | Normalisiert |
|----------|--------------|
| `BTC-USD-PERP` | `BTC` |
| `edgex:BTC-PERP` | `BTC` |
| `BTCUSDT` | `BTC` |
| `hyna:ETH` | `ETH` |
| `1000PEPE` | `PEPE` |

---

## Error Responses

### 400 Bad Request

```json
{
  "success": false,
  "error": "Symbol parameter is required"
}
```

```json
{
  "success": false,
  "error": "Invalid range format. Use: 24h, 3d, 7d, 14d, 30d"
}
```

```json
{
  "success": false,
  "error": "Invalid from date format. Use ISO 8601 (e.g., 2026-02-03T11:00:00Z) or Unix timestamp"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "error": "Database query failed"
}
```

---

## Rate Limits

Keine expliziten Rate Limits, aber bitte vernünftige Nutzung:
- Max. 1000 Requests pro Minute empfohlen
- Verwende `limit` Parameter um große Datenmengen zu vermeiden

---

## Datenquellen

Die Daten in `unified_v3` stammen aus drei Quellen:

- **`api`** - Live V3 Collectors (aktuell)
- **`import`** - Historische API Imports
- **`tracker_export`** - Migrierte Daten von market_history

---

## Beispiel Use Cases

### 1. Cross-Exchange Arbitrage Detection

```bash
# Vergleiche BTC Funding Rates über alle Exchanges
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=BTC&range=1h&limit=100"
```

### 2. Historical Analysis

```bash
# Analysiere ETH Funding Rates über 30 Tage
curl "https://api.fundingrate.de/api/v3/funding/apr?symbol=ETH&range=30d"
```

### 3. Exchange-Specific Monitoring

```bash
# Überwache nur Hyperliquid und Paradex
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=SOL&exchanges=hyperliquid,paradex&range=7d"
```

### 4. Custom Time Window Analysis

```bash
# Analysiere spezifischen Zeitraum (z.B. während eines Events)
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=BTC&from=2026-02-03T11:00:00Z&to=2026-02-05T14:00:00Z"
```

---

## Technische Details

- **Datenbank:** Cloudflare D1 (`DB_UNIFIED`)
- **Tabelle:** `unified_v3`
- **Update-Frequenz:** Alle 5 Minuten (automatischer Cron Job)
- **Daten-Retention:** Unbegrenzt
- **Response Format:** JSON
- **CORS:** Enabled

---

## Support

Bei Fragen oder Problemen: [GitHub Issues](https://github.com/your-repo/issues)
