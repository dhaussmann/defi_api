# V3 API Documentation

Umfassende Dokumentation für die Cross-Exchange Funding Rate API basierend auf der `unified_v3` Tabelle.

**Base URL:** `https://api.fundingrate.de`

---

## Übersicht

Die V3 API bietet Zugriff auf normalisierte Funding Rate Daten von 12 verschiedenen DeFi-Exchanges. Alle Symbole werden automatisch normalisiert (z.B. `BTC-USD-PERP` → `BTC`), um Cross-Exchange Vergleiche zu ermöglichen.

### Verfügbare Exchanges

- **hyperliquid** - Hyperliquid DEX
- **paradex** - Paradex (Starknet)
- **edgex** - EdgeX Protocol
- **extended** - Extended Protocol
- **lighter** - Lighter Network
- **aster** - Aster Finance
- **variational** - Variational DEX
- **hyena** - HyENA Protocol
- **felix** - Felix Protocol
- **ventuals** - Ventuals
- **xyz** - XYZ Markets
- **nado** - Nado Protocol

### Datenquellen

- **`api`** - Live V3 Collectors (aktuell)
- **`import`** - Historische API Imports
- **`tracker_export`** - Migrierte Daten aus market_history

---

## Endpoints

### 1. Query Moving Averages

#### 1.1 Get Moving Averages for a Symbol

**Endpoint:** `GET /api/v3/funding/ma`

**Description:** Query historical moving averages for a specific symbol, period, and exchange. Returns calculated moving averages with statistical metrics.

**Parameters:**
- `symbol` (required): Token symbol (e.g., `BTC`, `ETH`, `SOL`)
- `period` (required): Time period for MA calculation
  - Valid values: `1h`, `24h`, `3d`, `7d`, `14d`, `30d`
- `exchange` (optional): Exchange name or `all` for cross-exchange aggregation
  - Default: `all`
  - Examples: `hyperliquid`, `paradex`, `edgex`, `aster`, etc.
- `limit` (optional): Number of results to return
  - Default: `24`
  - Range: 1-1000

**Response Format:**
```json
{
  "success": true,
  "symbol": "BTC",
  "exchange": "hyperliquid",
  "period": "7d",
  "count": 24,
  "data": [
    {
      "normalized_symbol": "BTC",
      "exchange": "hyperliquid",
      "period": "7d",
      "ma_rate_1h": 0.000123,
      "ma_apr": 10.78,
      "data_points": 168,
      "std_dev": 0.000045,
      "min_rate": 0.000078,
      "max_rate": 0.000189,
      "calculated_at": 1770370154,
      "period_start": 1769765354,
      "period_end": 1770370154
    }
  ]
}
```

**Field Descriptions:**
- `ma_rate_1h`: Moving average of 1-hour normalized funding rate
- `ma_apr`: Moving average of annualized percentage rate (APR)
- `data_points`: Number of data points used in calculation
- `std_dev`: Standard deviation of rates in the period
- `min_rate`: Minimum rate observed in the period
- `max_rate`: Maximum rate observed in the period
- `calculated_at`: Unix timestamp when MA was calculated
- `period_start`: Unix timestamp of period start
- `period_end`: Unix timestamp of period end

**Example Requests:**
```bash
# Get 7-day MA for BTC on Hyperliquid
curl "https://api.fundingrate.de/api/v3/funding/ma?symbol=BTC&period=7d&exchange=hyperliquid&limit=5"

# Get 24-hour MA for ETH across all exchanges
curl "https://api.fundingrate.de/api/v3/funding/ma?symbol=ETH&period=24h&exchange=all&limit=10"

# Get 30-day MA for SOL on Paradex
curl "https://api.fundingrate.de/api/v3/funding/ma?symbol=SOL&period=30d&exchange=paradex&limit=1"
```

#### 1.2 Get Latest Moving Averages (All Periods)

**Endpoint:** `GET /api/v3/funding/ma/latest`

**Description:** Get the most recent moving averages for all time periods (1h, 24h, 3d, 7d, 14d, 30d) for a specific symbol and exchange.

**Parameters:**
- `symbol` (required): Token symbol (e.g., `BTC`, `ETH`, `SOL`)
- `exchange` (optional): Exchange name or `all` for cross-exchange aggregation
  - Default: `all`

**Response Format:**
```json
{
  "success": true,
  "symbol": "BTC",
  "exchange": "hyperliquid",
  "data": [
    {
      "period": "1h",
      "ma_rate_1h": 0.000125,
      "ma_apr": 10.95,
      "data_points": 1,
      "std_dev": 0,
      "calculated_at": 1770370154
    },
    {
      "period": "24h",
      "ma_rate_1h": 0.000118,
      "ma_apr": 10.34,
      "data_points": 24,
      "std_dev": 0.000032,
      "calculated_at": 1770370154
    },
    {
      "period": "3d",
      "ma_rate_1h": 0.000121,
      "ma_apr": 10.60,
      "data_points": 72,
      "std_dev": 0.000038,
      "calculated_at": 1770370154
    },
    {
      "period": "7d",
      "ma_rate_1h": 0.000123,
      "ma_apr": 10.78,
      "data_points": 168,
      "std_dev": 0.000045,
      "calculated_at": 1770370154
    },
    {
      "period": "14d",
      "ma_rate_1h": 0.000119,
      "ma_apr": 10.42,
      "data_points": 336,
      "std_dev": 0.000051,
      "calculated_at": 1770370154
    },
    {
      "period": "30d",
      "ma_rate_1h": 0.000116,
      "ma_apr": 10.16,
      "data_points": 720,
      "std_dev": 0.000058,
      "calculated_at": 1770370154
    }
  ]
}
```

**Example Requests:**
```bash
# Get latest MAs for all periods for BTC on Hyperliquid
curl "https://api.fundingrate.de/api/v3/funding/ma/latest?symbol=BTC&exchange=hyperliquid"

# Get latest cross-exchange MAs for ETH
curl "https://api.fundingrate.de/api/v3/funding/ma/latest?symbol=ETH&exchange=all"

# Get latest MAs for SOL on EdgeX
curl "https://api.fundingrate.de/api/v3/funding/ma/latest?symbol=SOL&exchange=edgex"
```

### 2. Query Funding Rates (1h Normalized) mit flexiblen Filtern.

#### Query Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `symbol` | string | **Yes** | Symbol (normalisiert) | `BTC`, `ETH`, `SOL` |
| `exchanges` | string | No | Komma-separierte Liste von Exchanges | `hyperliquid,paradex,edgex` |
| `range` | string | No | Zeitbereich (siehe unten) | `24h`, `3d`, `7d`, `14d`, `30d` |
| `from` | string | No | Start-Zeit (ISO 8601 oder Unix timestamp) | `2026-02-03T11:00:00Z` oder `1738584000` |
| `to` | string | No | End-Zeit (ISO 8601 oder Unix timestamp) | `2026-02-05T14:00:00Z` oder `1738756800` |
| `limit` | number | No | Max. Anzahl Ergebnisse (1-10000) | `1000` (default) |

#### Response Format

```json
{
  "success": true,
  "symbol": "BTC",
  "filters": {
    "exchanges": ["hyperliquid", "paradex"],
    "timeRange": {
      "from": "2026-02-05T10:00:00.000Z",
      "to": "2026-02-06T10:00:00.000Z"
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

#### Beispiele

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

#### Query Parameters

Identisch zu `/api/v3/funding/rates`

#### Response Format

```json
{
  "success": true,
  "symbol": "ETH",
  "filters": {
    "exchanges": "all",
    "timeRange": {
      "from": "2026-02-03T10:00:00.000Z",
      "to": "2026-02-06T10:00:00.000Z"
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

#### Beispiele

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

#### Query Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `symbol` | string | **Yes** | Symbol (normalisiert) | `BTC`, `ETH`, `SOL` |
| `range` | string | No | Zeitbereich (default: `24h`) | `24h`, `3d`, `7d`, `14d`, `30d` |

#### Response Format

```json
{
  "success": true,
  "symbol": "BTC",
  "timeRange": {
    "from": "2026-02-05T10:00:00.000Z",
    "to": "2026-02-06T10:00:00.000Z",
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

#### Beispiele

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

### Vordefinierte Bereiche (`range` Parameter)

- **`24h`** - Letzte 24 Stunden
- **`3d`** - Letzte 3 Tage
- **`7d`** - Letzte 7 Tage
- **`14d`** - Letzte 14 Tage
- **`30d`** - Letzte 30 Tage

### Custom Zeitbereiche (`from` / `to` Parameter)

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

**Hinweis:** Wenn `from` und `to` angegeben sind, wird `range` ignoriert.

---

## Symbol-Normalisierung

Alle Symbole werden automatisch normalisiert, um Cross-Exchange Vergleiche zu ermöglichen:

| Original | Normalisiert |
|----------|--------------|
| `BTC-USD-PERP` | `BTC` |
| `edgex:BTC-PERP` | `BTC` |
| `BTCUSDT` | `BTC` |
| `hyna:ETH` | `ETH` |
| `1000PEPE` | `PEPE` |
| `ETH-USD-PERP` | `ETH` |
| `SOLUSD` | `SOL` |

Die Normalisierung erfolgt automatisch beim Sync von den V3-Tabellen zur `unified_v3` Tabelle.

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

```json
{
  "success": false,
  "error": "Limit must be between 1 and 10000"
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

## Rate Limits & Best Practices

### Rate Limits

- **Keine expliziten Rate Limits** auf API-Ebene
- Cloudflare Worker Limits gelten (CPU-Zeit, Memory)
- **Empfehlung:** Max. 1000 Requests pro Minute

### Best Practices

1. **Verwende `limit` Parameter** um große Datenmengen zu vermeiden
2. **Cache Responses** wenn möglich (besonders für historische Daten)
3. **Verwende spezifische Zeitbereiche** statt immer `30d`
4. **Filtere nach Exchanges** wenn du nicht alle brauchst
5. **Batch Requests** für mehrere Symbole nacheinander

---

## Moving Average Calculation Details

### Calculation Method

Moving averages are calculated hourly (at `:10` past each hour) using the following process:

1. **Data Collection:** Fetch all funding rates from `unified_v3` for the specified period
2. **Statistical Analysis:** Calculate mean, standard deviation, min, and max
3. **Storage:** Store results in `funding_ma` (per exchange) and `funding_ma_cross` (aggregated)

### Periods and Data Points

| Period | Duration | Typical Data Points | Use Case |
|--------|----------|---------------------|----------|
| 1h | 1 hour | 1 | Current rate snapshot |
| 24h | 24 hours | 24 | Daily trend analysis |
| 3d | 3 days | 72 | Short-term trend |
| 7d | 7 days | 168 | Weekly trend analysis |
| 14d | 14 days | 336 | Medium-term trend |
| 30d | 30 days | 720 | Long-term trend |

### Cross-Exchange Aggregation

When `exchange=all` is specified, the API returns aggregated data:
- **Simple Average:** Mean of all exchange MAs
- **Weighted Average:** Weighted by number of data points
- **Spread Analysis:** Difference between highest and lowest exchange MA
- **Exchange Count:** Number of exchanges with data for the symbol

### Update Frequency

- **Calculation:** Every hour at `:10` past the hour
- **Data Source:** All funding rates from `unified_v3` table
- **Latency:** MAs reflect data up to the last calculation time

## Use Cases

### 1. Moving Average Analysis
- **Trend Identification:** Compare short-term vs long-term MAs
- **Cross-Exchange Arbitrage:** Identify exchanges with diverging MAs
- **Volatility Assessment:** Use std_dev to gauge rate stability
- **Market Sentiment:** Track MA direction and magnitude

### 2. Trading Strategy Development

Vergleiche BTC Funding Rates über alle Exchanges in Echtzeit:

```bash
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=BTC&range=1h&limit=100"
```

**Anwendung:**
- Identifiziere Exchanges mit signifikant unterschiedlichen Funding Rates
- Nutze Arbitrage-Möglichkeiten zwischen Exchanges
- Überwache Spread-Entwicklung

### 2. Historical Analysis

Analysiere ETH Funding Rates über 30 Tage:

```bash
curl "https://api.fundingrate.de/api/v3/funding/apr?symbol=ETH&range=30d"
```

**Anwendung:**
- Erkenne Trends und Muster
- Berechne durchschnittliche Funding Costs
- Backtesting von Trading-Strategien

### 3. Exchange-Specific Monitoring

Überwache nur Hyperliquid und Paradex:

```bash
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=SOL&exchanges=hyperliquid,paradex&range=7d"
```

**Anwendung:**
- Fokussiere auf bevorzugte Exchanges
- Reduziere Datenvolumen
- Spezifische Exchange-Analysen

### 4. Custom Time Window Analysis

Analysiere spezifischen Zeitraum (z.B. während eines Events):

```bash
curl "https://api.fundingrate.de/api/v3/funding/rates?symbol=BTC&from=2026-02-03T11:00:00Z&to=2026-02-05T14:00:00Z"
```

**Anwendung:**
- Event-basierte Analysen
- Korrelation mit externen Events
- Präzise Zeitfenster-Queries

### 5. Quick Market Overview

Schneller Überblick über alle Exchanges für ein Symbol:

```bash
curl "https://api.fundingrate.de/api/v3/funding/summary?symbol=BTC&range=24h"
```

**Anwendung:**
- Dashboard-Integration
- Schnelle Marktübersicht
- Vergleich von Exchange-Performance

---

## Technische Details

### Datenbank

- **Typ:** Cloudflare D1 (SQLite)
- **Binding:** `DB_UNIFIED`
- **Database Name:** `defiapi-unified-funding`
- **Tabelle:** `unified_v3`

### Tabellen-Schema

```sql
CREATE TABLE unified_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  funding_time INTEGER NOT NULL,
  original_symbol TEXT NOT NULL,
  rate_1h_percent REAL,
  rate_apr REAL,
  interval_hours INTEGER,
  source TEXT NOT NULL,
  synced_at INTEGER NOT NULL
);

CREATE INDEX idx_unified_symbol_time ON unified_v3(normalized_symbol, funding_time DESC);
CREATE INDEX idx_unified_exchange_time ON unified_v3(exchange, funding_time DESC);
CREATE INDEX idx_unified_symbol_exchange ON unified_v3(normalized_symbol, exchange);
```

### Update-Frequenz

- **Automatischer Sync:** Alle 5 Minuten (Cron Job)
- **Sync-Quelle:** V3 Exchange-spezifische Tabellen in `DB_WRITE`
- **Batch-Größe:** 50.000 Records pro Sync
- **Incremental Sync:** Nur neue Daten seit letztem Sync

### Daten-Retention

- **Unbegrenzte Speicherung** aller historischen Daten
- **Keine automatische Löschung** alter Records
- **Aktuelle Größe:** ~335.000 Records (Stand: Feb 2026)

### Performance

- **Query-Zeit:** < 100ms für typische Queries
- **Worker CPU-Zeit:** < 50ms pro Request
- **Memory Usage:** < 10MB pro Request

---

## CORS & Security

### CORS Headers

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

### Authentication

- **Aktuell:** Keine Authentication erforderlich
- **Zukünftig:** API Keys für Rate Limiting möglich

### Security Best Practices

1. **Input Validation:** Alle Parameter werden validiert
2. **SQL Injection Prevention:** Prepared Statements
3. **Rate Limiting:** Cloudflare Worker Limits
4. **Error Handling:** Keine sensitiven Informationen in Errors
## Integration Examples

### JavaScript/TypeScript - Moving Averages

```typescript
// Fetch latest MAs for BTC across all exchanges
async function getLatestBTCMovingAverages() {
  const response = await fetch(
    'https://api.fundingrate.de/api/v3/funding/ma/latest?symbol=BTC&exchange=all'
  );
  const data = await response.json();
  
  if (data.success) {
    // Find 7-day and 30-day MAs
    const ma7d = data.data.find(ma => ma.period === '7d');
    const ma30d = data.data.find(ma => ma.period === '30d');
    
    console.log(`7-day MA: ${ma7d.ma_apr.toFixed(2)}% APR`);
    console.log(`30-day MA: ${ma30d.ma_apr.toFixed(2)}% APR`);
    
    // Detect trend
    if (ma7d.ma_apr > ma30d.ma_apr) {
      console.log('Upward trend detected');
    } else {
      console.log('Downward trend detected');
    }
  }
}

// Compare MAs across multiple exchanges
async function compareExchangeMAs(symbol: string, period: string) {
  const exchanges = ['hyperliquid', 'paradex', 'edgex', 'aster'];
  const results = [];
  
  for (const exchange of exchanges) {
    const response = await fetch(
      `https://api.fundingrate.de/api/v3/funding/ma?symbol=${symbol}&period=${period}&exchange=${exchange}&limit=1`
    );
    const data = await response.json();
    
    if (data.success && data.count > 0) {
      results.push({
        exchange,
        ma_apr: data.data[0].ma_apr,
        data_points: data.data[0].data_points
      });
    }
  }
  
  // Sort by MA APR
  results.sort((a, b) => b.ma_apr - a.ma_apr);
  
  console.log(`${symbol} ${period} MA Comparison:`);
  results.forEach(r => {
    console.log(`${r.exchange}: ${r.ma_apr.toFixed(2)}% APR (${r.data_points} points)`);
  });
  
  return results;
}

// Track MA volatility
async function trackMAVolatility(symbol: string, exchange: string) {
  const response = await fetch(
    `https://api.fundingrate.de/api/v3/funding/ma/latest?symbol=${symbol}&exchange=${exchange}`
  );
  const data = await response.json();
  
  if (data.success) {
    data.data.forEach(ma => {
      const volatility = (ma.std_dev / Math.abs(ma.ma_rate_1h)) * 100;
      console.log(`${ma.period}: ${volatility.toFixed(2)}% volatility`);
    });
  }
}
```

### Python - Moving Average Analysis

```python
import requests
from datetime import datetime

class FundingMAAnalyzer:
    BASE_URL = "https://api.fundingrate.de/api/v3/funding"
    
    def get_latest_mas(self, symbol: str, exchange: str = "all"):
        """Get latest MAs for all periods"""
        response = requests.get(
            f"{self.BASE_URL}/ma/latest",
            params={"symbol": symbol, "exchange": exchange}
        )
        return response.json()
    
    def get_ma_history(self, symbol: str, period: str, exchange: str = "all", limit: int = 24):
        """Get historical MA data"""
        response = requests.get(
            f"{self.BASE_URL}/ma",
            params={
                "symbol": symbol,
                "period": period,
                "exchange": exchange,
                "limit": limit
            }
        )
        return response.json()
    
    def detect_ma_crossover(self, symbol: str, exchange: str = "all"):
        """Detect MA crossover signals"""
        data = self.get_latest_mas(symbol, exchange)
        
        if not data["success"]:
            return None
        
        mas = {ma["period"]: ma["ma_apr"] for ma in data["data"]}
        
        # Golden cross: short-term MA crosses above long-term MA
        if mas.get("7d", 0) > mas.get("30d", 0):
            return "GOLDEN_CROSS"
        # Death cross: short-term MA crosses below long-term MA
        elif mas.get("7d", 0) < mas.get("30d", 0):
            return "DEATH_CROSS"
        
        return "NEUTRAL"
    
    def calculate_ma_spread(self, symbol: str, period: str):
        """Calculate spread between exchanges"""
        exchanges = ["hyperliquid", "paradex", "edgex", "aster"]
        mas = []
        
        for exchange in exchanges:
            data = self.get_ma_history(symbol, period, exchange, limit=1)
            if data["success"] and data["count"] > 0:
                mas.append({
                    "exchange": exchange,
                    "ma_apr": data["data"][0]["ma_apr"]
                })
        
        if len(mas) < 2:
            return None
        
        mas.sort(key=lambda x: x["ma_apr"])
        spread = mas[-1]["ma_apr"] - mas[0]["ma_apr"]
        
        return {
            "highest": mas[-1],
            "lowest": mas[0],
            "spread": spread,
            "spread_percent": (spread / abs(mas[0]["ma_apr"])) * 100
        }

# Usage
analyzer = FundingMAAnalyzer()

# Detect crossover
signal = analyzer.detect_ma_crossover("BTC", "hyperliquid")
print(f"Signal: {signal}")

# Calculate spread
spread = analyzer.calculate_ma_spread("ETH", "7d")
if spread:
    print(f"Spread: {spread['spread']:.2f}% ({spread['spread_percent']:.1f}%)")
```

### JavaScript/TypeScript - Funding Rates

```typescript
interface FundingRate {
  normalized_symbol: string;
  exchange: string;
  funding_time: number;
  timestamp: string;
  original_symbol: string;
  rate_1h_percent: number;
  interval_hours: number;
  source: string;
}

interface FundingRatesResponse {
  success: boolean;
  symbol: string;
  filters: {
    exchanges: string | string[];
    timeRange: {
      from: string;
      to: string;
    };
  };
  count: number;
  data: FundingRate[];
}

async function getFundingRates(
  symbol: string,
  options?: {
    exchanges?: string[];
    range?: string;
    from?: string;
    to?: string;
    limit?: number;
  }
): Promise<FundingRatesResponse> {
  const params = new URLSearchParams({ symbol });
  
  if (options?.exchanges) {
    params.set('exchanges', options.exchanges.join(','));
  }
  if (options?.range) {
    params.set('range', options.range);
  }
  if (options?.from) {
    params.set('from', options.from);
  }
  if (options?.to) {
    params.set('to', options.to);
  }
  if (options?.limit) {
    params.set('limit', options.limit.toString());
  }
  
  const response = await fetch(
    `https://api.fundingrate.de/api/v3/funding/rates?${params}`
  );
  
  return response.json();
}

// Beispiel-Nutzung
const btcRates = await getFundingRates('BTC', {
  exchanges: ['hyperliquid', 'paradex'],
  range: '24h',
  limit: 100
});

console.log(`Found ${btcRates.count} funding rates for BTC`);
btcRates.data.forEach(rate => {
  console.log(`${rate.exchange}: ${rate.rate_1h_percent}%`);
});
```

### Python

```python
import requests
from typing import Optional, List, Dict, Any
from datetime import datetime

class FundingRateAPI:
    BASE_URL = "https://api.fundingrate.de/api/v3"
    
    def __init__(self):
        self.session = requests.Session()
    
    def get_funding_rates(
        self,
        symbol: str,
        exchanges: Optional[List[str]] = None,
        range: Optional[str] = None,
        from_time: Optional[str] = None,
        to_time: Optional[str] = None,
        limit: int = 1000
    ) -> Dict[str, Any]:
        """Query funding rates for a symbol."""
        params = {"symbol": symbol, "limit": limit}
        
        if exchanges:
            params["exchanges"] = ",".join(exchanges)
        if range:
            params["range"] = range
        if from_time:
            params["from"] = from_time
        if to_time:
            params["to"] = to_time
        
        response = self.session.get(
            f"{self.BASE_URL}/funding/rates",
            params=params
        )
        response.raise_for_status()
        return response.json()
    
    def get_funding_summary(
        self,
        symbol: str,
        range: str = "24h"
    ) -> Dict[str, Any]:
        """Get aggregated statistics for a symbol."""
        params = {"symbol": symbol, "range": range}
        
        response = self.session.get(
            f"{self.BASE_URL}/funding/summary",
            params=params
        )
        response.raise_for_status()
        return response.json()

# Beispiel-Nutzung
api = FundingRateAPI()

# BTC Funding Rates
btc_rates = api.get_funding_rates(
    symbol="BTC",
    exchanges=["hyperliquid", "paradex"],
    range="24h"
)

print(f"Found {btc_rates['count']} funding rates")

# BTC Summary
btc_summary = api.get_funding_summary("BTC", range="7d")
for exchange in btc_summary["exchanges"]:
    print(f"{exchange['exchange']}: avg={exchange['avg_apr']:.2f}% APR")
```

### cURL Scripts

```bash
#!/bin/bash

# Konfiguration
API_BASE="https://api.fundingrate.de/api/v3"
SYMBOL="BTC"

# Funding Rates abrufen
echo "Fetching BTC funding rates..."
curl -s "${API_BASE}/funding/rates?symbol=${SYMBOL}&range=24h&limit=10" | jq '.'

# Summary abrufen
echo -e "\nFetching BTC summary..."
curl -s "${API_BASE}/funding/summary?symbol=${SYMBOL}&range=24h" | jq '.exchanges[] | {exchange, avg_apr, data_points}'

# Spezifische Exchanges
echo -e "\nFetching from specific exchanges..."
curl -s "${API_BASE}/funding/rates?symbol=${SYMBOL}&exchanges=hyperliquid,paradex&range=7d&limit=5" | jq '.data[] | {exchange, timestamp, rate_1h_percent}'
```

---

## Changelog

### Version 1.0.0 (Feb 2026)

**Initial Release:**
- ✅ `/api/v3/funding/rates` - Query funding rates
- ✅ `/api/v3/funding/apr` - Query funding APR
- ✅ `/api/v3/funding/summary` - Aggregated statistics
- ✅ Exchange filtering
- ✅ Time range filtering (fixed + custom)
- ✅ Symbol normalization
- ✅ 12 Exchanges supported
- ✅ ~335k historical records

---

## Support & Feedback

### Fragen & Probleme

- **GitHub Issues:** [Repository Issues](https://github.com/your-repo/issues)
- **Email:** support@fundingrate.de

### Feature Requests

Wir freuen uns über Feedback und Feature-Vorschläge! Bitte erstelle ein GitHub Issue mit:
- Beschreibung des gewünschten Features
- Use Case / Anwendungsfall
- Beispiel-Request/Response (falls relevant)

---

## Roadmap

### Geplante Features

- [ ] WebSocket API für Real-time Updates
- [ ] Aggregierte Multi-Symbol Queries
- [ ] Historical Data Export (CSV, JSON)
- [ ] API Keys & Authentication
- [ ] Rate Limiting per API Key
- [ ] Webhook Notifications
- [ ] GraphQL API
- [ ] Volatility & Risk Metrics

---

## Lizenz

Diese API ist Teil des DeFi API Projekts und steht unter der MIT Lizenz.

---

**Letzte Aktualisierung:** 6. Februar 2026
**API Version:** 1.0.0
**Dokumentation Version:** 1.0.0
