# Bulk Moving Average Endpoint - Dokumentation

## 🚀 **Neuer Endpoint: `/api/funding/ma/bulk`**

### **Problem gelöst**
Vorher musstest du für jeden Token und jede Börse einzelne API-Calls machen, was sehr lange dauerte.

**Jetzt:** Ein einziger API-Call liefert alle Moving Averages für alle Token und Börsen + automatische Arbitrage-Erkennung!

---

## 📡 **Endpoint Details**

**URL:** `GET /api/funding/ma/bulk`

**Base URL:** `https://api.fundingrate.de` oder `https://defiapi.cloudflareone-demo-account.workers.dev`

---

## 🔧 **Query Parameter**

Alle Parameter sind **optional**:

| Parameter | Typ | Beschreibung | Beispiel |
|-----------|-----|--------------|----------|
| `exchanges` | string | Komma-getrennte Liste von Börsen | `hyperliquid,edgex,hyena` |
| `symbols` | string | Komma-getrennte Liste von Symbolen | `BTC,ETH,SOL` |
| `timeframes` | string | Komma-getrennte Liste von Zeiträumen | `24h,7d` |

**Verfügbare Timeframes:** `24h`, `3d`, `7d`, `14d`, `30d`

---

## 📊 **Response Format**

```json
{
  "success": true,
  "data": [
    {
      "symbol": "BTC",
      "exchange": "hyperliquid",
      "timeframes": {
        "24h": {
          "avg_funding_rate": 0.00000541,
          "avg_funding_rate_annual": 0.59,
          "sample_count": 1440
        },
        "7d": {
          "avg_funding_rate": 0.00000623,
          "avg_funding_rate_annual": 0.68,
          "sample_count": 10080
        }
      }
    },
    {
      "symbol": "BTC",
      "exchange": "edgex",
      "timeframes": {
        "24h": {
          "avg_funding_rate": 0.00005771,
          "avg_funding_rate_annual": 12.64,
          "sample_count": 1440
        }
      }
    }
  ],
  "arbitrage": [
    {
      "symbol": "BTC",
      "timeframe": "24h",
      "long_exchange": "hyperliquid",
      "short_exchange": "edgex",
      "long_rate": 0.59,
      "short_rate": 12.64,
      "spread_apr": 12.05,
      "profit_potential": "positive"
    }
  ],
  "meta": {
    "total_combinations": 825,
    "timeframes": ["24h", "7d"],
    "exchanges_filter": "all",
    "symbols_filter": "all",
    "arbitrage_opportunities": 156
  }
}
```

---

## 💡 **Use Cases & Beispiele**

### **1. Alle Daten für alle Token und Börsen**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk'
```

**Ergebnis:** Komplette Übersicht über alle ~825 Token/Börsen-Kombinationen mit allen Timeframes.

---

### **2. Nur bestimmte Börsen (z.B. Hyperliquid, EdgeX, Hyena)**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk?exchanges=hyperliquid,edgex,hyena'
```

**Use Case:** Du tradest nur auf diesen 3 Börsen und willst nur deren Daten.

---

### **3. Nur bestimmte Tokens (z.B. BTC, ETH, SOL)**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk?symbols=BTC,ETH,SOL'
```

**Use Case:** Du fokussierst dich auf diese 3 Tokens und willst alle Börsen vergleichen.

---

### **4. Spezifische Börsen + Tokens + Timeframes**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk?exchanges=hyperliquid,edgex&symbols=BTC,ETH&timeframes=24h,7d'
```

**Use Case:** Fokussierte Analyse für deine Trading-Strategie.

---

### **5. Nur 24h Daten für schnelle Übersicht**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk?timeframes=24h'
```

**Use Case:** Dashboard mit aktuellen 24h-Durchschnitten.

---

## 🎯 **Arbitrage-Erkennung**

Der Endpoint erkennt **automatisch** Arbitrage-Möglichkeiten:

**Kriterien:**
- Mindestens 2 Börsen haben Daten für den gleichen Token
- APR-Spread > 0.1% zwischen den Börsen

**Strategie:**
```
Long auf Exchange mit niedrigerem APR  → Du erhältst Funding
Short auf Exchange mit höherem APR     → Du zahlst Funding
Profit = Spread zwischen den beiden Rates
```

**Beispiel:**
```json
{
  "symbol": "BTC",
  "timeframe": "24h",
  "long_exchange": "hyperliquid",   // APR: 0.59%
  "short_exchange": "edgex",        // APR: 12.64%
  "spread_apr": 12.05,              // Profit-Potential
  "profit_potential": "positive"
}
```

**Interpretation:**
- Long BTC auf Hyperliquid (du erhältst 0.59% APR)
- Short BTC auf EdgeX (du zahlst 12.64% APR)
- **Netto-Verlust:** -12.05% APR (nicht profitabel!)

**Hinweis:** `profit_potential: "positive"` bedeutet nur, dass der Spread positiv ist, nicht dass die Strategie profitabel ist! Du musst die Richtung beachten.

---

## ⚡ **Performance-Vorteile**

### **Vorher (einzelne Calls):**
```bash
# Für 825 Token/Börsen-Kombinationen:
825 API Calls × ~200ms = ~165 Sekunden (2:45 Minuten!)
```

### **Jetzt (Bulk-Call):**
```bash
# Ein einziger Call:
1 API Call × ~2-3 Sekunden = 3 Sekunden!
```

**Speedup:** ~55x schneller! 🚀

---

## 📈 **Response-Felder erklärt**

### **Data Array**
Jedes Element enthält:
- `symbol` - Normalisiertes Symbol (z.B. "BTC")
- `exchange` - Börsenname
- `timeframes` - Objekt mit allen angeforderten Timeframes
  - `avg_funding_rate` - Durchschnittliche Raw Funding Rate
  - `avg_funding_rate_annual` - Durchschnittlicher APR in %
  - `sample_count` - Anzahl der Datenpunkte (für Validierung)

### **Arbitrage Array**
Jedes Element enthält:
- `symbol` - Token
- `timeframe` - Zeitraum
- `long_exchange` - Börse für Long-Position (niedrigerer APR)
- `short_exchange` - Börse für Short-Position (höherer APR)
- `long_rate` - APR auf Long-Börse
- `short_rate` - APR auf Short-Börse
- `spread_apr` - APR-Differenz (Profit-Potential)
- `profit_potential` - "positive" oder "negative"

### **Meta Object**
- `total_combinations` - Anzahl der Token/Börsen-Kombinationen
- `timeframes` - Liste der inkludierten Timeframes
- `exchanges_filter` - Angewendeter Börsen-Filter
- `symbols_filter` - Angewendeter Symbol-Filter
- `arbitrage_opportunities` - Anzahl gefundener Arbitrage-Möglichkeiten

---

## 🔍 **Filtering-Strategien**

### **1. Top-Börsen für Liquidität**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk?exchanges=hyperliquid,paradex,edgex'
```

### **2. Nur Major Tokens**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk?symbols=BTC,ETH,SOL,ARB,OP'
```

### **3. Schnelle 24h-Übersicht**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk?timeframes=24h&exchanges=hyperliquid,edgex'
```

### **4. Langfristige Analyse (30 Tage)**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk?timeframes=30d'
```

---

## 💻 **Frontend Integration**

### **JavaScript/TypeScript Beispiel**

```typescript
interface BulkMAResponse {
  success: boolean;
  data: Array<{
    symbol: string;
    exchange: string;
    timeframes: {
      [key: string]: {
        avg_funding_rate: number;
        avg_funding_rate_annual: number;
        sample_count: number;
      } | null;
    };
  }>;
  arbitrage: Array<{
    symbol: string;
    timeframe: string;
    long_exchange: string;
    short_exchange: string;
    long_rate: number;
    short_rate: number;
    spread_apr: number;
    profit_potential: 'positive' | 'negative';
  }>;
  meta: {
    total_combinations: number;
    timeframes: string[];
    exchanges_filter: string;
    symbols_filter: string;
    arbitrage_opportunities: number;
  };
}

// Fetch alle Daten
async function fetchBulkMA(
  exchanges?: string[],
  symbols?: string[],
  timeframes?: string[]
): Promise<BulkMAResponse> {
  const params = new URLSearchParams();
  
  if (exchanges?.length) {
    params.set('exchanges', exchanges.join(','));
  }
  if (symbols?.length) {
    params.set('symbols', symbols.join(','));
  }
  if (timeframes?.length) {
    params.set('timeframes', timeframes.join(','));
  }
  
  const url = `https://api.fundingrate.de/api/funding/ma/bulk?${params}`;
  const response = await fetch(url);
  return response.json();
}

// Beispiel-Verwendung
const data = await fetchBulkMA(
  ['hyperliquid', 'edgex'],
  ['BTC', 'ETH'],
  ['24h', '7d']
);

console.log(`Gefunden: ${data.meta.total_combinations} Kombinationen`);
console.log(`Arbitrage: ${data.arbitrage.length} Möglichkeiten`);
```

---

## 🎨 **Dashboard-Beispiel**

```typescript
// Beste Arbitrage-Möglichkeiten anzeigen
function displayTopArbitrage(data: BulkMAResponse) {
  const topOpportunities = data.arbitrage
    .sort((a, b) => Math.abs(b.spread_apr) - Math.abs(a.spread_apr))
    .slice(0, 10);
  
  topOpportunities.forEach(opp => {
    console.log(`
      ${opp.symbol} (${opp.timeframe}):
      Long: ${opp.long_exchange} @ ${opp.long_rate.toFixed(2)}%
      Short: ${opp.short_exchange} @ ${opp.short_rate.toFixed(2)}%
      Spread: ${opp.spread_apr.toFixed(2)}% APR
    `);
  });
}

// Heatmap-Daten vorbereiten
function prepareHeatmapData(data: BulkMAResponse, timeframe: string) {
  return data.data
    .filter(d => d.timeframes[timeframe])
    .map(d => ({
      symbol: d.symbol,
      exchange: d.exchange,
      apr: d.timeframes[timeframe]!.avg_funding_rate_annual,
    }));
}
```

---

## 📊 **Vergleich: Alt vs. Neu**

### **Alte Methode (einzelne Calls):**
```typescript
// Für 10 Tokens × 5 Börsen = 50 Calls!
const tokens = ['BTC', 'ETH', 'SOL', ...];
const exchanges = ['hyperliquid', 'edgex', ...];

for (const token of tokens) {
  for (const exchange of exchanges) {
    await fetch(`/api/funding/ma?symbol=${token}&exchange=${exchange}`);
  }
}
// Dauer: ~10 Sekunden
```

### **Neue Methode (Bulk-Call):**
```typescript
// Ein einziger Call!
const data = await fetch('/api/funding/ma/bulk?symbols=BTC,ETH,SOL&exchanges=hyperliquid,edgex');
// Dauer: ~2 Sekunden
```

---

## ⚠️ **Wichtige Hinweise**

1. **Arbitrage-Interpretation:** Der `spread_apr` zeigt nur die Differenz. Du musst die Richtung beachten (long vs. short).

2. **Sample Count:** Prüfe `sample_count` um sicherzustellen, dass genug Daten vorhanden sind (z.B. > 100 für 24h).

3. **Null-Werte:** Wenn `timeframes[key]` = `null`, gibt es keine Daten für diesen Zeitraum.

4. **Performance:** Ohne Filter werden ~825 Kombinationen zurückgegeben. Nutze Filter für schnellere Responses.

5. **Rate Limits:** Aktuell keine Rate Limits, aber verwende Caching im Frontend.

---

## 🚀 **Next Steps**

1. **Teste den Endpoint:**
   ```bash
   curl 'https://api.fundingrate.de/api/funding/ma/bulk?symbols=BTC&timeframes=24h'
   ```

2. **Integriere ins Frontend:**
   - Ersetze multiple API-Calls durch einen Bulk-Call
   - Zeige Arbitrage-Möglichkeiten in einer Tabelle
   - Erstelle Heatmaps mit den MA-Daten

3. **Optimiere deine Queries:**
   - Filtere nach relevanten Börsen
   - Wähle nur benötigte Timeframes
   - Cache die Responses (2-5 Minuten)

---

## 📚 **Weitere Dokumentation**

- **OpenAPI Spec:** [`openapi.yaml`](./openapi.yaml)
- **API Schema:** [`API_SCHEMA.md`](./API_SCHEMA.md)
- **Quick Reference:** [`API_QUICK_REFERENCE.md`](./API_QUICK_REFERENCE.md)
