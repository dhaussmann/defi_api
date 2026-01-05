# DeFi API Documentation

Base URL: `https://defiapi.cloudflareone-demo-account.workers.dev`

## Overview

Diese API sammelt und aggregiert Funding-Rate-Daten von verschiedenen dezentralen Perpetual-Futures-Börsen:
- **Hyperliquid** (1h Intervall)
- **Paradex** (8h Intervall)
- **EdgeX** (4h Intervall)
- **Lighter** (1h Intervall)
- **Aster** (1h/4h/8h Intervall - variabel pro Token)
- **Pacifica** (1h Intervall)
- **Extended** (1h Intervall)

## API Endpunkte

### 1. Marktdaten Endpunkte

#### `/api/markets`
Gibt alle aktuellen Marktdaten für alle Exchanges zurück.

**Query Parameter:**
- `exchange` (optional): Filtert nach Exchange (z.B. `aster`, `hyperliquid`)
- `symbol` (optional): Filtert nach normalisiertem Symbol (z.B. `BTC`, `HYPE`)

**Beispiel:**
\`\`\`bash
curl 'https://defiapi.cloudflareone-demo-account.workers.dev/api/markets?exchange=aster&symbol=HYPE'
\`\`\`

**Response:**
\`\`\`json
{
  "success": true,
  "data": [
    {
      "symbol": "HYPE",
      "exchange": "aster",
      "original_symbol": "HYPEUSDT",
      "mark_price": 25.73,
      "index_price": 25.70,
      "open_interest_usd": 1234567.89,
      "volume_24h": 987654.32,
      "funding_rate": -0.00000578,
      "funding_rate_annual": -1.26,
      "next_funding_time": 1767110400000,
      "price_change_24h": 2.5,
      "price_low_24h": 24.80,
      "price_high_24h": 26.20,
      "updated_at": 1767107032
    }
  ]
}
\`\`\`

#### `/api/compare`
Vergleicht einen Token über alle Exchanges hinweg.

**Query Parameter:**
- `symbol` (required): Normalisiertes Symbol (z.B. `BTC`, `ETH`)

**Beispiel:**
\`\`\`bash
curl 'https://defiapi.cloudflareone-demo-account.workers.dev/api/compare?symbol=BTC'
\`\`\`

#### `/api/tokens`
Gibt alle verfügbaren Tokens zurück (normalisierte Symbole).

**Beispiel:**
\`\`\`bash
curl 'https://defiapi.cloudflareone-demo-account.workers.dev/api/tokens'
\`\`\`

### 2. Historische Daten

#### `/api/market-history`
Gibt historische stündliche Marktdaten zurück.

**Query Parameter:**
- `exchange` (required): Exchange Name
- `symbol` (required): Original Symbol (z.B. `BTCUSDT`, `BTC-USD-PERP`)
- `from` (optional): Start-Timestamp (Unix Epoch)
- `to` (optional): End-Timestamp (Unix Epoch)
- `limit` (optional): Maximale Anzahl Einträge (default: 168 = 1 Woche)

**Beispiel:**
\`\`\`bash
curl 'https://defiapi.cloudflareone-demo-account.workers.dev/api/market-history?exchange=aster&symbol=HYPEUSDT&limit=24'
\`\`\`

#### `/api/normalized-data`
Flexible Datenabfrage mit verschiedenen Intervallen und Zeiträumen.

**Query Parameter:**
- `exchange` (optional): Exchange Name
- `symbol` (optional): Normalisiertes Symbol
- `interval` (optional): Intervall (`15s`, `1m`, `1h`) - default: `1h`
- `from` (optional): Start-Timestamp
- `to` (optional): End-Timestamp
- `limit` (optional): Maximale Anzahl Einträge (default: 168)

**Beispiel:**
\`\`\`bash
curl 'https://defiapi.cloudflareone-demo-account.workers.dev/api/normalized-data?symbol=BTC&interval=1h&limit=24'
\`\`\`

### 3. Quick-Access Endpunkte (Zeit-basiert)

#### `/api/data/24h`
Gibt Daten der letzten 24 Stunden zurück.

#### `/api/data/7d`
Gibt Daten der letzten 7 Tage zurück.

#### `/api/data/30d`
Gibt Daten der letzten 30 Tage zurück.

### 4. Status & Monitoring

#### `/api/status`
Gibt den Status aller Tracker zurück.

#### `/tracker/{exchange}/status`
Status eines spezifischen Trackers.

**Exchanges:** `lighter`, `paradex`, `hyperliquid`, `edgex`, `aster`, `pacifica`, `extended`

## Funding Rate Berechnung

| Exchange   | Intervall | Zahlungen/Tag | Formel                           |
|------------|-----------|---------------|----------------------------------|
| Hyperliquid| 1h        | 24            | rate × 24 × 365 × 100           |
| Paradex    | 8h        | 3             | rate × 3 × 365 × 100            |
| EdgeX      | 4h        | 6             | rate × 6 × 365 × 100            |
| Lighter    | 1h        | 24            | rate × 24 × 365 (rate ist %)   |
| Aster      | variabel  | variabel      | rate × (24/h) × 365 × 100       |
| Pacifica   | 1h        | 24            | rate × 24 × 365 × 100           |
| Extended   | 1h        | 24            | rate × 24 × 365 × 100           |

**Aster Besonderheit:** Dynamische Intervalle pro Token (1h/4h/8h)
- HYPE: 4h → -0.00000578 × 6 × 365 × 100 = -1.26% APR
- BTC: 8h → 0.0001 × 3 × 365 × 100 = 10.95% APR

## Beispiele

### Funding Rates für alle BTC-Märkte vergleichen
\`\`\`bash
curl 'https://defiapi.cloudflareone-demo-account.workers.dev/api/compare?symbol=BTC'
\`\`\`

### Letzte 24h für HYPE auf Aster
\`\`\`bash
curl 'https://defiapi.cloudflareone-demo-account.workers.dev/api/data/24h?exchange=aster&symbol=HYPE'
\`\`\`
