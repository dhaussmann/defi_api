# Lighter API - Stündliche Funding Rates

## Übersicht

Die Lighter API bietet **stündliche Funding Rate Daten** über einen REST Endpoint. Dies ist deutlich granularer als die meisten anderen Exchanges (die typischerweise 8h Intervalle haben).

## API Endpoints

### 1. Fundings API (Historische Daten)

**Endpoint:**
```
GET https://mainnet.zklighter.elliot.ai/api/v1/fundings
```

**Parameter:**
| Parameter | Typ | Beschreibung | Beispiel |
|-----------|-----|--------------|----------|
| `market_id` | integer | Market ID (siehe orderBooks API) | `1` (BTC) |
| `resolution` | string | Zeitauflösung | `"1h"` (stündlich) |
| `start_timestamp` | integer | Start Unix timestamp (Sekunden) | `1770116400` |
| `end_timestamp` | integer | End Unix timestamp (Sekunden) | `1770199200` |
| `count_back` | integer | 0 = vorwärts, >0 = rückwärts | `0` |

**Response:**
```json
{
  "fundings": [
    {
      "timestamp": 1770116400,
      "value": "0.00",
      "rate": "0.0001",
      "direction": "short"
    }
  ]
}
```

**Felder:**
- `timestamp`: Unix timestamp in Sekunden (stündlich)
- `value`: Kumulativer Funding-Wert
- `rate`: Funding Rate als Dezimal (z.B. `0.0001` = 0.01% per hour)
- `direction`: `"long"` oder `"short"` (wer zahlt)

### 2. Order Books API (Market IDs)

**Endpoint:**
```
GET https://mainnet.zklighter.elliot.ai/api/v1/orderBooks
```

**Response:**
```json
{
  "order_books": [
    {
      "market_id": 1,
      "symbol": "BTC",
      "status": "active"
    }
  ]
}
```

## Beispiel-Abfragen

### Bash/cURL

```bash
#!/bin/bash

# Letzte 7 Tage BTC Funding Rates (stündlich)
END_TS=$(date -u +%s)
START_TS=$((END_TS - 7 * 86400))

curl -s "https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=1&resolution=1h&start_timestamp=${START_TS}&end_timestamp=${END_TS}&count_back=0" \
  | jq '.fundings[] | {
      time: (.timestamp | strftime("%Y-%m-%d %H:%M")),
      rate: .rate,
      apr: ((.rate | tonumber) * 24 * 365)
    }'
```

### JavaScript/TypeScript

```typescript
interface LighterFunding {
  timestamp: number;
  value: string;
  rate: string;
  direction: 'long' | 'short';
}

async function fetchLighterFundings(
  marketId: number,
  startTimestamp: number,
  endTimestamp: number
): Promise<LighterFunding[]> {
  const url = new URL('https://mainnet.zklighter.elliot.ai/api/v1/fundings');
  url.searchParams.set('market_id', marketId.toString());
  url.searchParams.set('resolution', '1h');
  url.searchParams.set('start_timestamp', startTimestamp.toString());
  url.searchParams.set('end_timestamp', endTimestamp.toString());
  url.searchParams.set('count_back', '0');

  const response = await fetch(url.toString());
  const data = await response.json();
  return data.fundings;
}

// Beispiel: Letzte 24 Stunden BTC
const now = Math.floor(Date.now() / 1000);
const yesterday = now - 86400;
const fundings = await fetchLighterFundings(1, yesterday, now);

// APR berechnen
fundings.forEach(f => {
  const rate = parseFloat(f.rate);
  const apr = rate * 24 * 365 * 100; // In Prozent
  console.log(`${new Date(f.timestamp * 1000).toISOString()}: ${apr.toFixed(2)}% APR`);
});
```

### Python

```python
import requests
from datetime import datetime, timedelta

def fetch_lighter_fundings(market_id: int, days_back: int = 7):
    end_ts = int(datetime.now().timestamp())
    start_ts = end_ts - (days_back * 86400)
    
    url = "https://mainnet.zklighter.elliot.ai/api/v1/fundings"
    params = {
        "market_id": market_id,
        "resolution": "1h",
        "start_timestamp": start_ts,
        "end_timestamp": end_ts,
        "count_back": 0
    }
    
    response = requests.get(url, params=params)
    data = response.json()
    
    return data["fundings"]

# BTC Funding Rates (letzte 7 Tage)
fundings = fetch_lighter_fundings(market_id=1, days_back=7)

for f in fundings:
    rate = float(f["rate"])
    apr = rate * 24 * 365 * 100  # In Prozent
    timestamp = datetime.fromtimestamp(f["timestamp"])
    print(f"{timestamp}: {apr:.2f}% APR ({f['direction']})")
```

## APR Berechnung

**Formel:**
```
APR = rate × 24 × 365 × 100
```

**Beispiel:**
- Rate: `0.0001` (= 0.01% per hour)
- APR: `0.0001 × 24 × 365 × 100 = 87.6%`

**Wichtig:** Die `rate` ist bereits ein Dezimalwert, nicht Prozent!
- `0.0001` = 0.01% per hour
- `0.001` = 0.1% per hour
- `0.01` = 1% per hour

## Market IDs

Häufige Market IDs (Stand Feb 2026):
- BTC: `1`
- ETH: `2`
- SOL: `3`

Vollständige Liste via:
```bash
curl -s "https://mainnet.zklighter.elliot.ai/api/v1/orderBooks" | jq '.order_books[] | {market_id, symbol}'
```

## Vergleich: WebSocket vs REST API

| Aspekt | WebSocket API | REST API (Fundings) |
|--------|---------------|---------------------|
| **Format** | `"funding_rate": "0.13"` (Prozent) | `"rate": "0.0013"` (Dezimal) |
| **Konvertierung** | ÷ 100 → Dezimal | Direkt verwenden |
| **Frequenz** | Echtzeit (alle ~15s) | Historisch (stündlich) |
| **Use Case** | Live Tracking | Historische Analyse |

## Vorteile der stündlichen Auflösung

1. **Granularität**: 24 Datenpunkte pro Tag vs. 3 bei 8h Intervallen
2. **Präzision**: Bessere Moving Average Berechnungen
3. **Volatilität**: Kurzfristige Spikes werden sichtbar
4. **Arbitrage**: Schnellere Erkennung von Opportunities

## Limitierungen

- **Datenmenge**: 24x mehr Datenpunkte als 8h Intervalle
- **API Limits**: Keine dokumentierten Rate Limits, aber vernünftig nutzen
- **Historische Daten**: Verfügbarkeit abhängig von Lighter's Datenhaltung

## Integration in unsere API

Unsere aktuelle Implementierung nutzt:
- **WebSocket**: Echtzeit-Daten für `market_stats` Tabelle
- **Aggregation**: Stündliche Aggregation zu `market_stats_1m`
- **History**: Weitere Aggregation zu `market_history` (stündlich)

**Vorteil:** Wir haben bereits stündliche Granularität durch unsere Aggregation!

**Mögliche Verbesserung:** Historische Lücken mit REST API füllen:
```typescript
// Pseudo-Code
async function backfillLighterHistory(marketId: number, startDate: Date, endDate: Date) {
  const fundings = await fetchLighterFundings(marketId, startDate, endDate);
  
  for (const funding of fundings) {
    await db.insert('market_history', {
      exchange: 'lighter',
      symbol: getSymbolFromMarketId(marketId),
      hour_timestamp: funding.timestamp,
      avg_funding_rate: parseFloat(funding.rate),
      avg_funding_rate_annual: parseFloat(funding.rate) * 24 * 365,
      // ...
    });
  }
}
```

## Fazit

✅ **Ja, Lighter bietet stündliche Funding Rate Daten via REST API!**

Die API ist einfach zu nutzen und liefert präzise historische Daten. Perfekt für:
- Historische Analysen
- Backfilling von Datenlücken
- Verifikation unserer WebSocket-Daten
- Detaillierte Charts und Statistiken
