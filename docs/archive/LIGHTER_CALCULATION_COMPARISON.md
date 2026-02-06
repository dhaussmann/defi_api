# Lighter Funding Rate Calculation Comparison

## Vergleich: Lighter Funding History App vs. Unsere Implementierung

### 1. APR Berechnung (Annualized Funding Rate)

#### Lighter Funding History App
```javascript
// Position 6, Zeile ~115
if (viewMode === 'annualized') {
  allEntries = allEntries.map(e => ({
    ...e,
    v: e.v * 24 * 365  // Funding Rate × 24 Stunden × 365 Tage
  }));
}
```

**Formel:** `APR = funding_rate × 24 × 365`

**Annahme:** 
- Funding Rate ist **pro Stunde** (hourly rate)
- Wird auf 365 Tage hochgerechnet
- Ergebnis in Prozent (da Lighter Rates bereits als Prozent kommen)

#### Unsere Implementierung

**In `index.ts:801-850` (calculateFundingRates):**
```typescript
function calculateFundingRates(fundingRate: number, exchange: string, intervalHours?: number) {
  let hours: number;
  
  // Exchange-spezifische Intervalle
  if (exchange === 'hyperliquid' || exchange === 'paradex' || 
      exchange === 'lighter' || exchange === 'pacifica') {
    hours = 8;  // 8-Stunden Intervall
  }
  // ... andere Exchanges
  
  const hourly = fundingRate / hours;  // Normalisierung auf Stundenbasis
  const annual = fundingRate * (24 / hours) * 365 * 100;  // APR in Prozent
  
  return { hourly, annual };
}
```

**Formel:** `APR = funding_rate × (24 / interval_hours) × 365 × 100`

Für Lighter (8h Intervall):
`APR = funding_rate × (24 / 8) × 365 × 100 = funding_rate × 3 × 365 × 100`

**In `index.ts:1200-1222` (Aggregation):**
```typescript
CASE
  WHEN exchange = 'lighter' THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
  // ...
END as avg_funding_rate_annual
```

**Formel:** `APR = funding_rate × 3 × 365 × 100`

### 2. Vergleich der APR Formeln

| Aspekt | Lighter App | Unsere Implementierung |
|--------|-------------|------------------------|
| **Formel** | `rate × 24 × 365` | `rate × 3 × 365 × 100` |
| **Annahme** | Rate ist **hourly** | Rate ist **per 8h** |
| **Faktor** | 8,760 | 109,500 |
| **Unterschied** | **12.5x** | - |

### 3. Das Problem

**Lighter App geht von hourly rates aus:**
- Lighter API liefert: `0.0012` (= 0.12% per 8h)
- App nimmt an: `0.0012` ist hourly
- Berechnung: `0.0012 × 24 × 365 = 10.512%` ✅ (stimmt mit Feb 1 Daten überein)

**Unsere Implementierung geht von 8h rates aus:**
- Lighter API liefert: `0.0012` (= 0.12% per 8h)
- Wir teilen durch 100: `0.000012` (Dezimal-Konvertierung)
- Berechnung: `0.000012 × 3 × 365 × 100 = 1.314%` ❌ (zu niedrig!)

### 4. Root Cause

**In `LighterTracker.ts:564-570`:**
```typescript
// Lighter liefert Funding Rates als Prozentwerte (z.B. "0.0012" = 0.12%)
// Andere Exchanges liefern Dezimalwerte (z.B. "0.000012" = 0.0012%)
// Daher müssen wir Lighter-Werte durch 100 teilen für Konsistenz
const fundingRate = (parseFloat(fundingRateRaw) / 100).toString();
```

**Problem:** Diese Division durch 100 ist falsch!

Lighter API liefert bereits **Dezimalwerte**, nicht Prozentwerte:
- API Wert: `0.0012` = 0.12% per 8h (als Dezimal)
- Wir teilen durch 100: `0.000012` = 0.0012% per 8h
- **Ergebnis:** 100x zu niedrig!

### 5. Korrekte Interpretation

**Lighter API Format:**
```json
{
  "rate": "0.0012",      // 0.12% per 8h (Dezimal, nicht Prozent!)
  "direction": "long"
}
```

**Richtige Berechnung:**
```typescript
// FALSCH (aktuell):
const fundingRate = parseFloat(fundingRateRaw) / 100;  // 0.0012 → 0.000012
const annual = fundingRate * 3 * 365 * 100;            // 1.314%

// RICHTIG (sollte sein):
const fundingRate = parseFloat(fundingRateRaw);        // 0.0012 (keine Division!)
const annual = fundingRate * 3 * 365 * 100;            // 131.4%
```

### 6. Moving Average Berechnung

#### Lighter Funding History App
```javascript
// Position 8, Zeile ~100
function calculateMovingAverage(timeSeries, values, windowMs) {
  const result = [];
  let windowSum = 0, windowCount = 0, windowStartIdx = 0;

  for (let i = 0; i < timeSeries.length; i++) {
    const currentTime = timeSeries[i];
    
    // Slide window start forward while outside window
    while (timeSeries[windowStartIdx] < currentTime - windowMs) {
      windowSum -= values[windowStartIdx];
      windowCount--;
      windowStartIdx++;
    }
    
    windowSum += values[i];
    windowCount++;
    result.push(windowCount > 0 ? windowSum / windowCount : null);
  }
  return result;
}
```

**Algorithmus:** Sliding Window mit Zeit-basiertem Fenster
- Fenster basiert auf Zeitstempel (z.B. 24h = 86,400,000ms)
- Dynamisches Hinzufügen/Entfernen von Werten
- Durchschnitt = Summe / Anzahl

#### Unsere Implementierung

**In `maCache.ts:37-62`:**
```sql
SELECT 
  normalized_symbol,
  exchange,
  ? as timeframe,
  AVG(avg_funding_rate) as avg_funding_rate,
  AVG(avg_funding_rate_annual) as avg_funding_rate_annual,
  COUNT(*) as sample_count,
  ? as calculated_at
FROM market_history
WHERE hour_timestamp >= ?
  AND hour_timestamp <= ?
  AND avg_funding_rate IS NOT NULL
GROUP BY normalized_symbol, exchange
```

**Algorithmus:** SQL AVG() über Zeitbereich
- Zeitbereich-basierte Filterung (z.B. letzte 24 Stunden)
- SQL AVG() Aggregation
- Gruppierung nach Symbol und Exchange

### 7. Vergleich der MA Berechnungen

| Aspekt | Lighter App | Unsere Implementierung |
|--------|-------------|------------------------|
| **Methode** | Sliding Window (JavaScript) | SQL AVG() |
| **Zeitbasis** | Millisekunden-genau | Stunden-genau |
| **Granularität** | Jeder Datenpunkt | Stündliche Aggregate |
| **Komplexität** | O(n) mit Sliding Window | O(n) mit SQL Scan |
| **Ergebnis** | Identisch bei gleichen Daten | Identisch bei gleichen Daten |

**Beide Methoden sind mathematisch äquivalent**, solange die Eingangsdaten gleich sind.

### 8. Zusammenfassung der Diskrepanzen

#### ❌ FEHLER: Division durch 100 in LighterTracker

**Aktuell:**
```typescript
const fundingRate = (parseFloat(fundingRateRaw) / 100).toString();
```

**Sollte sein:**
```typescript
const fundingRate = parseFloat(fundingRateRaw).toString();
```

**Auswirkung:**
- Alle Lighter Funding Rates sind **100x zu niedrig**
- APR Berechnungen sind **100x zu niedrig**
- Feb 1, 2026: Sollte 11.42% sein, aber zeigt 0.11%

#### ✅ KORREKT: APR Berechnung Formel

Unsere Formel `rate × 3 × 365 × 100` ist korrekt für 8h Intervalle.

#### ✅ KORREKT: Moving Average Berechnung

Unsere SQL-basierte MA Berechnung ist mathematisch äquivalent zur Lighter App.

### 12. Empfohlene Fixes

**WARTE AUF WEITERE ANALYSE**

Es gibt eine Diskrepanz zwischen:
1. WebSocket API Format (was LighterTracker empfängt)
2. REST API Format (was die Lighter App verwendet)
3. Historischen Daten (was wir in der DB haben)

Bevor wir Fixes implementieren, müssen wir:
1. WebSocket API Beispieldaten prüfen
2. Historische Daten mit REST API vergleichen
3. Verstehen, warum Feb 1 Daten 11.42% zeigen, nicht 1051%

### 10. Verifikation

Nach dem Fix sollten die Werte übereinstimmen:

**Lighter App (Feb 1, 2026):**
- Funding Rate: 0.001304 per 8h
- APR: 11.42%

**Unsere API (nach Fix):**
- Funding Rate: 0.001304 per 8h
- APR: 0.001304 × 3 × 365 × 100 = 142.71% ❌ (immer noch falsch!)

**Warte... die Formel ist auch falsch!**

Die richtige Formel sollte sein:
```typescript
// Lighter App: rate × 24 × 365 (rate ist bereits in Prozent)
// Unsere API: rate × 24 × 365 × 100 (rate ist Dezimal, muss in Prozent)

// ABER: Lighter hat 8h Intervall, nicht 1h!
// Also: rate × (24/8) × 365 × 100 = rate × 3 × 365 × 100

// Problem: Lighter App nimmt an, rate ist hourly!
// Tatsächlich: rate ist per 8h

// Lösung: Wir müssen rate NICHT durch 8 teilen, sondern direkt verwenden
// APR = rate × 3 × 365 × 100 ist KORREKT für 8h rates
```

**Tatsächliches Problem:** Die Lighter App rechnet falsch! Sie nimmt an, dass die Rate hourly ist, aber sie ist per 8h.

**Korrekte Berechnung:**
- Lighter API: 0.001304 per 8h
- Hourly: 0.001304 / 8 = 0.0001630 per hour
- APR: 0.0001630 × 24 × 365 × 100 = 142.71%

**ODER:**
- Lighter API: 0.001304 per 8h
- APR: 0.001304 × 3 × 365 × 100 = 142.71%

**Aber die Lighter App zeigt 11.42%!**

Das bedeutet: Die Lighter App dividiert durch 10 oder die API liefert bereits prozentuale Werte!

### 11. FINALE ANALYSE - Lighter API Format

**Tatsächliches API Format (verifiziert):**
```json
{
  "timestamp": 1770116400,
  "rate": "0.0001",      // 0.01% PER HOUR (bereits Prozent!)
  "direction": "short"
}
```

**Bestätigung:**
- Lighter API liefert **hourly rates** (nicht 8h!)
- Rates sind bereits in **Prozent** (0.0001 = 0.01%)
- Resolution ist 1h (nicht 8h wie bei anderen Exchanges)

**Unsere Implementierung in `index.ts:823-827`:**
```typescript
case 'lighter':
  // 1-hour intervals, rate already in %
  hours = 1;
  isAlreadyPercent = true;
  break;
```
✅ **KORREKT!** Wir behandeln Lighter bereits als 1h Intervall mit Prozent-Rates.

**APR Berechnung in `index.ts:852-853`:**
```typescript
const annualRate = isAlreadyPercent 
  ? hourlyRate * 24 * 365  // Lighter: keine × 100
  : hourlyRate * 24 * 365 * 100;  // Andere: × 100
```
✅ **KORREKT!** Formel stimmt mit Lighter App überein.

**Das eigentliche Problem:**

**In `LighterTracker.ts:564-570`:**
```typescript
// FALSCH: Division durch 100
const fundingRate = (parseFloat(fundingRateRaw) / 100).toString();
```

**Lighter WebSocket API liefert:**
```json
{
  "funding_rate": "0.12"  // 0.12% per hour (bereits Prozent!)
}
```

**Was passiert:**
1. WebSocket API: `0.12` (= 0.12% per hour)
2. Wir teilen durch 100: `0.0012` (= 0.0012% per hour) ❌
3. APR: `0.0012 × 24 × 365 = 10.512%` ❌ (sollte 105.12% sein!)

**Korrekte Berechnung:**
1. WebSocket API: `0.12` (= 0.12% per hour)
2. Keine Division: `0.12` (= 0.12% per hour) ✅
3. APR: `0.12 × 24 × 365 = 1051.2%` ✅

**ABER:** Die historischen Daten vom 1.2.2026 zeigen 11.42% APR, nicht 1051%!

Das bedeutet: Die WebSocket API und die REST API haben **unterschiedliche Formate**!

**WebSocket API:** `"funding_rate": "0.12"` = 0.12% per hour
**REST API:** `"rate": "0.0001"` = 0.01% per hour

**Faktor:** 1200x Unterschied! (0.12 vs 0.0001)

Das ist unmöglich. Lass mich die historischen Daten nochmal prüfen...
