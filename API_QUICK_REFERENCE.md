# DeFi API - Quick Reference

**Base URL:** `https://defiapi.cloudflareone-demo-account.workers.dev`

---

## 📊 Haupt-Endpunkte

### 1. Tracker Status
Zeigt den Status aller 7 Exchange-Tracker

```bash
GET /api/trackers
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "exchange": "hyperliquid",
      "running": true,
      "pollCount": 245,
      "bufferSize": 223
    }
    // ... weitere Tracker
  ]
}
```

---

### 2. Verfügbare Token auflisten
Zeigt alle verfügbaren normalisierten Token mit ihren Original-Symbolen

```bash
GET /api/tokens
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_tokens": 364,
    "tokens": [
      {
        "token": "BTC",
        "exchanges_count": 7,
        "exchanges": ["aster", "edgex", "extended", "hyperliquid", "lighter", "pacifica", "paradex"],
        "original_symbols": [
          { "exchange": "aster", "symbol": "BTCUSDT" },
          { "exchange": "edgex", "symbol": "BTCUSD" },
          { "exchange": "extended", "symbol": "BTC-USD" },
          { "exchange": "hyperliquid", "symbol": "BTC" },
          { "exchange": "lighter", "symbol": "BTC" },
          { "exchange": "pacifica", "symbol": "BTC" },
          { "exchange": "paradex", "symbol": "BTC-USD-PERP" }
        ]
      }
      // ... weitere Token
    ]
  }
}
```

**Features:**
- ✅ Alle Token alphabetisch sortiert
- ✅ Sortierung nach Anzahl der Börsen (Token auf allen 7 Börsen zuerst)
- ✅ Zeigt Original-Symbole für jede Börse
- ✅ Perfekt für Autocomplete/Dropdown-Listen

**Beispiele:**
```bash
# Alle verfügbaren Token
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/tokens"

# Nur Token, die auf allen 7 Börsen verfügbar sind
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/tokens" | \
  jq '.data.tokens[] | select(.exchanges_count == 7) | .token'

# Anzahl Token auf allen Börsen
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/tokens" | \
  jq '[.data.tokens[] | select(.exchanges_count == 7)] | length'
```

---

### 3. Token-Vergleich über alle Börsen
Vergleicht einen Token über alle 7 Börsen hinweg mit aggregierten Statistiken

```bash
GET /api/compare?token=<TOKEN>
```

**Parameter:**
- `token` (required): Base Asset Symbol (z.B. `BTC`, `ETH`, `SOL`)

**Beispiele:**
```bash
# BTC über alle Börsen
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/compare?token=BTC"

# Ethereum
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/compare?token=ETH"

# Solana
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/compare?token=SOL"
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
        "open_interest_usd": 1048821848.486,
        "funding_rate_annual": 6.72,
        "volume_24h": 0,
        "timestamp": "2025-12-23 07:47:57"
      }
      // ... weitere Börsen
    ],
    "aggregated": {
      "total_open_interest_usd": 4362746369.72,
      "avg_price": 87503.29,
      "min_price": 87307.74,
      "max_price": 87541.6,
      "price_spread_pct": 0.27,
      "avg_funding_rate_annual_pct": 19.27
    }
  }
}
```

**Features:**
- ✅ Automatische Symbol-Normalisierung (BTCUSDT, BTC-USD, BTC-USD-PERP → BTC)
- ✅ Aggregierte Statistiken über alle Börsen
- ✅ Preis-Spread Berechnung
- ✅ Durchschnittliche Funding Rates (annualisiert)
- ✅ Gesamt Open Interest in USD

---

### 4. Market-Statistiken abrufen
Liefert aktuelle oder historische Market-Daten

```bash
GET /api/stats?exchange=<EXCHANGE>&symbol=<SYMBOL>
```

**Parameter:**
- `exchange` (optional): `lighter`, `paradex`, `hyperliquid`, `edgex`, `aster`, `pacifica`, `extended`
- `symbol` (optional): Token-Symbol
- `from` (optional): Start-Timestamp in ms
- `to` (optional): End-Timestamp in ms
- `limit` (optional): Max. Anzahl Ergebnisse (default: 100, max: 1000)

**Beispiele:**
```bash
# Alle Märkte von Hyperliquid
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/stats?exchange=hyperliquid"

# BTC von allen Börsen
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/stats?symbol=BTC"

# ETH nur von Lighter
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/stats?exchange=lighter&symbol=ETH"

# Letzte 50 BTC-Einträge von Extended
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/stats?exchange=extended&symbol=BTC-USD&limit=50"
```

---

### 5. Neueste Market-Daten
Liefert nur den neuesten Datensatz pro Symbol

```bash
GET /api/latest?exchange=<EXCHANGE>
```

**Parameter:**
- `exchange` (optional): Filtert nach einer bestimmten Börse
- `symbol` (optional): Filtert nach einem bestimmten Symbol

**Beispiele:**
```bash
# Neueste Daten von allen Börsen
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/latest"

# Neueste Daten nur von Hyperliquid
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/latest?exchange=hyperliquid"

# Nur BTC von Hyperliquid
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/latest?exchange=hyperliquid&symbol=BTC"
```

---

## 🎯 Unterstützte Börsen

| Börse | Symbol-Format | Beispiel | Verbindung | Polling/Snapshot |
|-------|---------------|----------|------------|------------------|
| **Lighter** | `BTC`, `ETH` | `BTC` | WebSocket | 15s Snapshots |
| **Paradex** | `BTC-USD-PERP` | `BTC-USD-PERP` | WebSocket | 15s Snapshots |
| **Hyperliquid** | `BTC`, `ETH` | `BTC` | API Polling | 60s / 60s |
| **EdgeX** | `BTCUSD`, `ETHUSD` | `BTCUSD` | WebSocket | 15s Snapshots |
| **Aster** | `BTCUSDT`, `ETHUSDT` | `BTCUSDT` | API Polling | 60s / 60s |
| **Pacifica** | `BTC`, `ETH` | `BTC` | WebSocket | 15s Snapshots |
| **Extended** | `BTC-USD`, `ETH-USD` | `BTC-USD` | API Polling | 15s / 60s |

---

## 🔧 Symbol-Normalisierung

Die `/api/compare` Funktion normalisiert automatisch verschiedene Symbol-Formate:

| Original | Normalisiert | Börse |
|----------|--------------|-------|
| `BTCUSDT` | `BTC` | Aster |
| `BTCUSD` | `BTC` | EdgeX |
| `BTC-USD` | `BTC` | Extended |
| `BTC-USD-PERP` | `BTC` | Paradex |
| `BTC` | `BTC` | Hyperliquid, Lighter, Pacifica |
| `1000PEPE` | `PEPE` | Alle (Präfix-Removal) |
| `kBONK` | `BONK` | Alle (Präfix-Removal) |

---

## 📦 Response-Felder

### Market Stats Felder

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `exchange` | string | Börsen-Name |
| `symbol` | string | Original Symbol |
| `mark_price` | float | Mark-Preis für Margin |
| `index_price` | float | Index-Preis des Underlying |
| `open_interest` | float | Open Interest (Kontrakte) |
| `open_interest_usd` | float | Open Interest in USD |
| `funding_rate` | float | Funding Rate (8h) |
| `funding_rate_annual` | float | Annualisierte Funding Rate (%) |
| `volume_24h` | float | 24h Volumen in USD |
| `price_low_24h` | float | 24h Tiefstkurs |
| `price_high_24h` | float | 24h Höchstkurs |
| `price_change_24h` | float | 24h Preisänderung (%) |
| `timestamp` | string | Zeitstempel der Daten |

---

## 💡 Verwendungsbeispiele

### Python
```python
import requests

BASE_URL = "https://defiapi.cloudflareone-demo-account.workers.dev"

# BTC über alle Börsen vergleichen
response = requests.get(f"{BASE_URL}/api/compare", params={"token": "BTC"})
data = response.json()

print(f"BTC auf {data['data']['exchanges_count']} Börsen")
print(f"Durchschnittspreis: ${data['data']['aggregated']['avg_price']:,.2f}")
print(f"Gesamt OI: ${data['data']['aggregated']['total_open_interest_usd']:,.0f}")
```

### JavaScript
```javascript
const BASE_URL = "https://defiapi.cloudflareone-demo-account.workers.dev";

// Tracker Status abrufen
const response = await fetch(`${BASE_URL}/api/trackers`);
const data = await response.json();

console.log(`${data.data.length} Tracker aktiv`);
data.data.forEach(tracker => {
  console.log(`${tracker.exchange}: ${tracker.bufferSize} Märkte`);
});
```

### cURL
```bash
# Top-Level Statistiken für BTC
curl -s "https://defiapi.cloudflareone-demo-account.workers.dev/api/compare?token=BTC" \
  | jq '.data.aggregated'

# Alle Hyperliquid-Märkte sortiert nach OI
curl -s "https://defiapi.cloudflareone-demo-account.workers.dev/api/latest?exchange=hyperliquid" \
  | jq '.data | sort_by(.open_interest_usd | tonumber) | reverse | .[0:10]'
```

---

## 🚀 Integration-Tipps

1. **Rate Limiting**: Keine Limits aktuell, aber bitte vernünftig nutzen
2. **Caching**: Daten werden alle 15-60s aktualisiert, Client-Caching empfohlen
3. **Error Handling**: Alle Responses haben `success: true/false` Flag
4. **CORS**: Alle Endpunkte unterstützen Cross-Origin Requests
5. **Timestamps**: `created_at` in Sekunden, `recorded_at` in Millisekunden

---

## 📚 Weitere Dokumentation

Vollständige API-Dokumentation: [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
