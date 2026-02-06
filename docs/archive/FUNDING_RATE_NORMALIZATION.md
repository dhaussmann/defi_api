# Funding Rate Normalisierung

## Übersicht

Die Funding Rate Normalisierung ist ein kritischer Prozess, der Funding Rates von verschiedenen Exchanges mit unterschiedlichen Zahlungsintervallen und Formaten in ein einheitliches, vergleichbares Format umwandelt. Dies ermöglicht faire Vergleiche und Arbitrage-Berechnungen über alle Exchanges hinweg.

## Problem: Unterschiedliche Exchange-Formate

Verschiedene Exchanges verwenden unterschiedliche:
1. **Zahlungsintervalle** (1h, 4h, 8h)
2. **Rate-Formate** (Dezimal vs. Prozent)
3. **Symbol-Namenskonventionen** (BTC-USD-PERP, BTCUSDT, etc.)

### Beispiel ohne Normalisierung

```
Exchange A: 0.0001 (8h Intervall) 
Exchange B: 0.00005 (4h Intervall)
Exchange C: 0.01% (1h Intervall)

❌ Direkter Vergleich unmöglich!
```

## Zwei-Stufen-Normalisierung

### Stufe 1: Symbol-Normalisierung

Konvertiert verschiedene Symbol-Formate in ein einheitliches Format (Base Asset).

### Stufe 2: Rate-Normalisierung

Konvertiert Funding Rates in:
- **Stündliche Rate** (hourly): Normalisierte Rate pro Stunde
- **Jährliche Rate** (annual): Annualisierte Rate in Prozent (APR)

---

## Symbol-Normalisierung

### Funktion: `normalizeSymbol(symbol: string): string`

**Zweck:** Entfernt Exchange-spezifische Präfixe und Suffixe, um ein einheitliches Token-Symbol zu erhalten.

### Implementierung

```typescript
function normalizeSymbol(symbol: string): string {
  // 1. Entferne Exchange-Präfixe
  let normalized = symbol
    .replace(/^hyna:/i, '')        // HyENA: hyna:BTC -> BTC
    .replace(/^xyz:/i, '')         // XYZ: xyz:BTC -> BTC
    .replace(/^flx:/i, '')         // FLX: flx:BTC -> BTC
    .replace(/^vntl:/i, '')        // VNTL: vntl:BTC -> BTC
    .replace(/^km:/i, '')          // KM: km:BTC -> BTC
    .replace(/^hyperliquid:/i, '') // Hyperliquid: hyperliquid:BTC -> BTC
    .replace(/^edgex:/i, '')       // EdgeX: edgex:BTC -> BTC
    .replace(/^lighter:/i, '')     // Lighter: lighter:BTC -> BTC
    .replace(/^paradex:/i, '')     // Paradex: paradex:BTC -> BTC
    .replace(/^aster:/i, '')       // Aster: aster:BTC -> BTC
    .replace(/^pacifica:/i, '')    // Pacifica: pacifica:BTC -> BTC
    .replace(/^extended:/i, '');   // Extended: extended:BTC -> BTC

  // 2. Entferne Suffixe
  normalized = normalized
    .replace(/-USD-PERP$/i, '')    // Paradex: BTC-USD-PERP -> BTC
    .replace(/-USD$/i, '')         // Extended: BTC-USD -> BTC
    .replace(/USDT$/i, '')         // Aster: BTCUSDT -> BTC
    .replace(/USD$/i, '')          // EdgeX: BTCUSD -> BTC
    .replace(/^1000/i, '')         // 1000PEPE -> PEPE
    .replace(/^k/i, '')            // kBONK -> BONK
    .toUpperCase();

  return normalized;
}
```

### Beispiele

| Exchange | Original Symbol | Normalisiert |
|----------|----------------|--------------|
| Hyperliquid | `hyperliquid:BTC` | `BTC` |
| Paradex | `BTC-USD-PERP` | `BTC` |
| Aster | `BTCUSDT` | `BTC` |
| EdgeX | `BTCUSD` | `BTC` |
| HyENA | `hyna:ETH` | `ETH` |
| Lighter | `lighter:SOL` | `SOL` |
| Extended | `BTC-USD` | `BTC` |
| Aster | `1000PEPEUSDT` | `PEPE` |
| Aster | `kBONKUSDT` | `BONK` |

### Warum wichtig?

- **Aggregation:** Ermöglicht Gruppierung nach Token über alle Exchanges
- **Arbitrage:** Vergleich derselben Assets auf verschiedenen Exchanges
- **Benutzerfreundlichkeit:** Einheitliche Symbol-Namen in der API

---

## Rate-Normalisierung

### Funktion: `calculateFundingRates(fundingRate, exchange, intervalHours?)`

**Zweck:** Konvertiert Exchange-spezifische Funding Rates in standardisierte stündliche und jährliche Raten.

### Exchange-Spezifische Intervalle

| Exchange | Zahlungsintervall | Besonderheiten |
|----------|------------------|----------------|
| Hyperliquid | 8 Stunden | Standard-Format |
| HyENA | 8 Stunden | Standard-Format |
| XYZ | 8 Stunden | Standard-Format |
| FLX | 8 Stunden | Standard-Format |
| VNTL | 8 Stunden | Standard-Format |
| KM | 8 Stunden | Standard-Format |
| Paradex | 8 Stunden | Standard-Format |
| EdgeX | 4 Stunden | Kürzeres Intervall |
| Aster | 1h / 4h / 8h | **Variabel pro Token** |
| Lighter | 1 Stunde | **Rate bereits in %** |
| Extended | 1 Stunde | Standard-Format |
| Pacifica | 1 Stunde | Standard-Format |

### Implementierung

```typescript
function calculateFundingRates(
  fundingRate: number, 
  exchange: string, 
  intervalHours?: number
): { hourly: number; annual: number } {
  
  let hours: number;
  let isAlreadyPercent = false;

  // 1. Bestimme Zahlungsintervall
  switch (exchange.toLowerCase()) {
    case 'hyperliquid':
    case 'hyena':
    case 'xyz':
    case 'flx':
    case 'vntl':
    case 'km':
    case 'paradex':
      hours = 8;  // 8-Stunden-Intervall
      break;

    case 'edgex':
      hours = 4;  // 4-Stunden-Intervall
      break;

    case 'lighter':
      hours = 1;  // 1-Stunden-Intervall
      isAlreadyPercent = true;  // Rate bereits in %
      break;

    case 'aster':
      // Variable Intervalle: 1h, 4h, oder 8h pro Token
      hours = intervalHours || 8;  // Fallback zu 8h
      break;

    case 'extended':
    case 'pacifica':
      hours = 1;  // 1-Stunden-Intervall
      break;

    default:
      hours = 8;  // Fallback
      break;
  }

  // 2. Normalisiere zu stündlicher Rate
  const hourlyRate = fundingRate / hours;

  // 3. Berechne jährliche Rate (APR)
  // Formel: hourly × 24 hours/day × 365 days × 100 (zu %)
  // Ausnahme: Lighter bereits in %, also kein × 100
  const annualRate = isAlreadyPercent 
    ? hourlyRate * 24 * 365 
    : hourlyRate * 24 * 365 * 100;

  return {
    hourly: hourlyRate,
    annual: annualRate
  };
}
```

### Berechnungsbeispiele

#### Beispiel 1: Hyperliquid (8h Intervall)

```
Input:
- fundingRate: 0.0001
- exchange: "hyperliquid"
- intervalHours: undefined

Berechnung:
1. hours = 8
2. hourlyRate = 0.0001 / 8 = 0.0000125
3. annualRate = 0.0000125 × 24 × 365 × 100 = 10.95%

Output:
{
  hourly: 0.0000125,
  annual: 10.95
}
```

#### Beispiel 2: EdgeX (4h Intervall)

```
Input:
- fundingRate: 0.00005
- exchange: "edgex"
- intervalHours: undefined

Berechnung:
1. hours = 4
2. hourlyRate = 0.00005 / 4 = 0.0000125
3. annualRate = 0.0000125 × 24 × 365 × 100 = 10.95%

Output:
{
  hourly: 0.0000125,
  annual: 10.95
}
```

**Wichtig:** Beide Exchanges haben die gleiche normalisierte Rate, obwohl die Original-Rates unterschiedlich waren!

#### Beispiel 3: Lighter (1h Intervall, bereits in %)

```
Input:
- fundingRate: 0.01  (entspricht 0.01%)
- exchange: "lighter"
- intervalHours: undefined

Berechnung:
1. hours = 1
2. isAlreadyPercent = true
3. hourlyRate = 0.01 / 1 = 0.01
4. annualRate = 0.01 × 24 × 365 = 87.6%
   (kein × 100, da bereits in %)

Output:
{
  hourly: 0.01,
  annual: 87.6
}
```

#### Beispiel 4: Aster (Variable Intervalle)

```
Input:
- fundingRate: 0.0002
- exchange: "aster"
- intervalHours: 4  (Token-spezifisch)

Berechnung:
1. hours = 4  (aus intervalHours Parameter)
2. hourlyRate = 0.0002 / 4 = 0.00005
3. annualRate = 0.00005 × 24 × 365 × 100 = 43.8%

Output:
{
  hourly: 0.00005,
  annual: 43.8
}
```

### Vergleichstabelle

| Exchange | Original Rate | Intervall | Hourly Rate | Annual Rate (APR) |
|----------|--------------|-----------|-------------|-------------------|
| Hyperliquid | 0.0001 | 8h | 0.0000125 | 10.95% |
| EdgeX | 0.00005 | 4h | 0.0000125 | 10.95% |
| Pacifica | 0.0000125 | 1h | 0.0000125 | 10.95% |
| Lighter | 0.01% | 1h | 0.01% | 87.6% |

**Ergebnis:** Trotz unterschiedlicher Original-Formate sind die normalisierten Raten vergleichbar!

---

## Integration in den Daten-Pipeline

### 1. Datenerfassung (WebSocket Tracker)

```typescript
// Rohdaten von Exchange
const rawData = {
  symbol: "BTC-USD-PERP",
  fundingRate: 0.0001,
  exchange: "paradex"
};

// Normalisierung
const normalized_symbol = normalizeSymbol(rawData.symbol);  // "BTC"
const rates = calculateFundingRates(
  rawData.fundingRate, 
  rawData.exchange
);

// Speichern in DB
INSERT INTO funding_snapshots (
  symbol,
  normalized_symbol,
  exchange,
  funding_rate,
  ...
) VALUES (
  'BTC-USD-PERP',
  'BTC',
  'paradex',
  0.0001,
  ...
);
```

### 2. 1-Minuten-Aggregation

```typescript
// Aggregation mit Normalisierung
INSERT INTO market_stats_1m (
  normalized_symbol,
  exchange,
  avg_funding_rate,
  avg_funding_rate_annual,
  ...
)
SELECT 
  normalized_symbol,
  exchange,
  AVG(funding_rate) as avg_funding_rate,
  -- Berechne annualisierte Rate basierend auf Exchange
  CASE 
    WHEN exchange = 'lighter' THEN AVG(funding_rate) * 24 * 365
    WHEN exchange = 'edgex' THEN AVG(funding_rate) / 4 * 24 * 365 * 100
    WHEN exchange IN ('extended', 'pacifica') THEN AVG(funding_rate) * 24 * 365 * 100
    ELSE AVG(funding_rate) / 8 * 24 * 365 * 100  -- 8h Standard
  END as avg_funding_rate_annual,
  ...
FROM funding_snapshots
WHERE ...
GROUP BY normalized_symbol, exchange, minute_timestamp;
```

### 3. Moving Average Berechnung

```typescript
// MAs verwenden bereits normalisierte Daten
SELECT 
  normalized_symbol,
  exchange,
  AVG(avg_funding_rate) as avg_funding_rate,
  AVG(avg_funding_rate_annual) as avg_funding_rate_annual
FROM market_stats_1m
WHERE minute_timestamp >= ?
GROUP BY normalized_symbol, exchange;
```

---

## Vorteile der Normalisierung

### 1. Faire Vergleiche

```
Ohne Normalisierung:
- Hyperliquid BTC: 0.0001 (8h)
- EdgeX BTC: 0.00005 (4h)
❌ EdgeX sieht günstiger aus, ist aber gleich!

Mit Normalisierung:
- Hyperliquid BTC: 10.95% APR
- EdgeX BTC: 10.95% APR
✅ Gleiche Rate erkennbar!
```

### 2. Arbitrage-Erkennung

```typescript
// Vergleiche normalisierte APR-Raten
const hyperliquid_apr = 10.95;
const paradex_apr = 12.50;
const spread = paradex_apr - hyperliquid_apr;  // 1.55%

if (spread > 0.5) {
  // Arbitrage-Möglichkeit!
  // Long auf Hyperliquid (niedrigere Rate zahlen)
  // Short auf Paradex (höhere Rate erhalten)
}
```

### 3. Aggregation über Exchanges

```sql
-- Durchschnittliche Funding Rate für BTC über alle Exchanges
SELECT 
  normalized_symbol,
  AVG(avg_funding_rate_annual) as market_avg_apr
FROM funding_ma_cache
WHERE normalized_symbol = 'BTC'
  AND timeframe = '24h'
GROUP BY normalized_symbol;

-- Nur möglich durch Normalisierung!
```

### 4. Benutzerfreundlichkeit

```json
// API Response mit normalisierten Daten
{
  "symbol": "BTC",  // Einheitlich über alle Exchanges
  "exchanges": {
    "hyperliquid": {
      "funding_rate_apr": 10.95  // Vergleichbar
    },
    "paradex": {
      "funding_rate_apr": 12.50  // Vergleichbar
    }
  }
}
```

---

## Edge Cases und Besonderheiten

### 1. Aster - Variable Intervalle

Aster verwendet unterschiedliche Zahlungsintervalle pro Token:
- Manche Tokens: 1h
- Andere Tokens: 4h
- Wieder andere: 8h

**Lösung:** `intervalHours` Parameter wird aus Token-Metadaten gelesen und an `calculateFundingRates()` übergeben.

### 2. Lighter - Rate bereits in Prozent

Lighter liefert Rates bereits als Prozentsatz (z.B. 0.01 = 0.01%).

**Lösung:** `isAlreadyPercent` Flag verhindert doppelte Multiplikation mit 100.

### 3. Spezielle Token-Präfixe

Manche Tokens haben Präfixe wie `1000PEPE` oder `kBONK`.

**Lösung:** Spezielle Regex-Patterns in `normalizeSymbol()` entfernen diese Präfixe.

### 4. Fehlende Daten

Was passiert, wenn `intervalHours` für Aster fehlt?

**Lösung:** Fallback zu 8h Standard-Intervall.

```typescript
hours = intervalHours || 8;  // Fallback
```

---

## Validierung und Testing

### Test-Cases für Symbol-Normalisierung

```typescript
// Test Suite
const testCases = [
  { input: "hyperliquid:BTC", expected: "BTC" },
  { input: "BTC-USD-PERP", expected: "BTC" },
  { input: "BTCUSDT", expected: "BTC" },
  { input: "1000PEPEUSDT", expected: "PEPE" },
  { input: "kBONKUSDT", expected: "BONK" },
  { input: "hyna:ETH", expected: "ETH" },
];

testCases.forEach(test => {
  const result = normalizeSymbol(test.input);
  console.assert(result === test.expected, 
    `Failed: ${test.input} -> ${result} (expected ${test.expected})`
  );
});
```

### Test-Cases für Rate-Normalisierung

```typescript
const rateTests = [
  {
    input: { rate: 0.0001, exchange: "hyperliquid" },
    expected: { hourly: 0.0000125, annual: 10.95 }
  },
  {
    input: { rate: 0.00005, exchange: "edgex" },
    expected: { hourly: 0.0000125, annual: 10.95 }
  },
  {
    input: { rate: 0.01, exchange: "lighter" },
    expected: { hourly: 0.01, annual: 87.6 }
  },
];

rateTests.forEach(test => {
  const result = calculateFundingRates(
    test.input.rate, 
    test.input.exchange
  );
  console.assert(
    Math.abs(result.annual - test.expected.annual) < 0.01,
    `Rate mismatch for ${test.input.exchange}`
  );
});
```

---

## Zusammenfassung

Die Funding Rate Normalisierung ist essentiell für:

✅ **Faire Vergleiche** zwischen Exchanges mit unterschiedlichen Intervallen  
✅ **Arbitrage-Erkennung** durch vergleichbare APR-Raten  
✅ **Aggregation** von Daten über mehrere Exchanges  
✅ **Benutzerfreundlichkeit** durch einheitliche Symbol-Namen  
✅ **Datenintegrität** durch konsistente Speicherung  

**Kern-Prinzipien:**
1. Normalisiere früh (bei Datenerfassung)
2. Speichere sowohl Original als auch normalisierte Werte
3. Verwende normalisierte Werte für alle Berechnungen und Vergleiche
4. Dokumentiere Exchange-spezifische Besonderheiten

**Formel-Übersicht:**
```
Stündliche Rate = Original Rate / Zahlungsintervall (in Stunden)
Jährliche Rate (APR) = Stündliche Rate × 24 × 365 × 100
```

(Ausnahme: Lighter bereits in %, kein × 100)
