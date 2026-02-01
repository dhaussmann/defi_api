# Arbitrage-Berechnung - Dokumentation

Diese Dokumentation beschreibt die Arbitrage-Berechnungslogik in Funding Finder Pro.

## Übersicht

Die Arbitrage-Funktion identifiziert profitable Funding-Rate-Unterschiede zwischen verschiedenen Krypto-Börsen für dasselbe Trading-Paar. Trader können diese Unterschiede nutzen, indem sie auf einer Börse long und auf einer anderen short gehen.

## Grundprinzip

**Funding Rate Arbitrage** funktioniert wie folgt:
- **Long Position** auf der Börse mit der **niedrigeren** Funding Rate (man erhält Funding oder zahlt weniger)
- **Short Position** auf der Börse mit der **höheren** Funding Rate (man erhält mehr Funding)
- Der **Spread** zwischen beiden Raten ist der potenzielle Gewinn

## Datenquellen

### Moving Average (MA) Daten
Die Berechnung basiert auf Moving Averages der Funding Rates über verschiedene Zeiträume:
- `ma24h` - 24-Stunden Moving Average
- `ma3d` - 3-Tage Moving Average
- `ma7d` - 7-Tage Moving Average
- `ma14d` - 14-Tage Moving Average
- `ma30d` - 30-Tage Moving Average

### APR-Werte (Annual Percentage Rate)
Das Backend liefert vorberechnete APR-Werte für jeden Zeitraum:
- `apr24h`, `apr3d`, `apr7d`, `apr14d`, `apr30d`
- Diese werden direkt vom Backend berechnet und berücksichtigen die **exchange-spezifische Funding-Frequenz**

## Berechnungslogik

### 1. Datenaggregation
```typescript
// MA-Daten werden nach Symbol gruppiert
const symbolMaMap = new Map<string, MAData[]>();
maDataMap.forEach((ma) => {
  if (!symbolMaMap.has(ma.symbol)) {
    symbolMaMap.set(ma.symbol, []);
  }
  symbolMaMap.get(ma.symbol)!.push(ma);
});
```

### 2. Paarvergleich
Für jedes Symbol werden alle Börsen-Paare verglichen:

```typescript
for (let i = 0; i < maList.length; i++) {
  for (let j = i + 1; j < maList.length; j++) {
    const ma1 = maList[i];
    const ma2 = maList[j];

    // Rate für den gewählten Zeitraum abrufen
    const rate1 = ma1[selectedTimeframe];  // z.B. ma24h
    const rate2 = ma2[selectedTimeframe];

    // Spread berechnen (stündlich)
    const spread = Math.abs(rate1 - rate2);
  }
}
```

### 3. Long/Short-Zuweisung
Die Börse mit der **niedrigeren** Rate wird für die Long-Position gewählt:

```typescript
const isRate1Lower = rate1 < rate2;
const longExchange = isRate1Lower ? ma1.exchange : ma2.exchange;
const shortExchange = isRate1Lower ? ma2.exchange : ma1.exchange;
const longRate = isRate1Lower ? rate1 : rate2;
const shortRate = isRate1Lower ? rate2 : rate1;
```

**Warum?**
- Bei einer Long-Position **zahlt** man die Funding Rate (wenn positiv) oder **erhält** sie (wenn negativ)
- Bei einer Short-Position **erhält** man die Funding Rate (wenn positiv) oder **zahlt** sie (wenn negativ)
- Daher: Long auf der Börse mit niedriger Rate, Short auf der Börse mit hoher Rate

### 4. APR-Spread-Berechnung
Der jährliche Spread wird aus den Backend-APR-Werten berechnet:

```typescript
// APR-Zeitraum dem MA-Zeitraum zuordnen
const aprTimeframe = maToAprTimeframe[selectedTimeframe];
const apr1 = ma1[aprTimeframe];
const apr2 = ma2[aprTimeframe];

// Long/Short APR zuweisen
const longAPR = isRate1Lower ? (apr1 ?? 0) : (apr2 ?? 0);
const shortAPR = isRate1Lower ? (apr2 ?? 0) : (apr1 ?? 0);

// Spread-APR berechnen
const spreadAPR = Math.abs(shortAPR - longAPR);
```

### 5. Stabilitäts-Score
Der Stabilitäts-Score (0-5) zeigt an, wie konsistent die Spread-Richtung über alle Zeiträume ist:

```typescript
const timeframes: MATimeframe[] = ['ma24h', 'ma3d', 'ma7d', 'ma14d', 'ma30d'];
let consistentCount = 0;

timeframes.forEach(tf => {
  const tfRate1 = ma1[tf];
  const tfRate2 = ma2[tf];
  if (tfRate1 !== null && tfRate2 !== null) {
    // Prüfen ob die Richtung konsistent ist
    const tfIsRate1Lower = tfRate1 < tfRate2;
    if (tfIsRate1Lower === isRate1Lower) {
      consistentCount++;
    }
  }
});

const stabilityScore = consistentCount;
const isStable = stabilityScore >= 4;  // Stabil wenn mind. 4 Zeiträume übereinstimmen
```

**Bedeutung:**
- **STABLE** (Score ≥ 4): Die Spread-Richtung ist über fast alle Zeiträume konsistent
- **MODERATE** (Score 3): Mischbild - teilweise konsistent
- **VOLATILE** (Score < 3): Die Spread-Richtung wechselt häufig zwischen Zeiträumen

## Ausgabe-Datenstruktur

```typescript
interface MAArbitrageOpportunity {
  id: string;                    // Eindeutige ID
  symbol: string;                // z.B. "BTC", "ETH"
  longExchange: string;          // Börse für Long-Position
  shortExchange: string;         // Börse für Short-Position
  longRate: number;              // Stündliche Rate (dezimal)
  shortRate: number;             // Stündliche Rate (dezimal)
  spread: number;                // Stündlicher Spread (dezimal)
  spreadAPR: number;             // Jährlicher Spread (Prozent)
  longAPR: number;               // Long-APR vom Backend (Prozent)
  shortAPR: number;              // Short-APR vom Backend (Prozent)
  timeframe: MATimeframe;        // Gewählter Zeitraum
  isStable: boolean;             // true wenn stabil
  stabilityScore: number;        // 0-5
  longMA: MAData;                // Vollständige MA-Daten Long
  shortMA: MAData;               // Vollständige MA-Daten Short
  openInterest: number;          // Kombiniertes OI beider Börsen
}
```

## Anzeigeformate

### Stündlich (Hourly)
- Zeigt die rohe MA-Rate als Prozent
- Format: `0.0097%` (= 0.000097 dezimal)

### Jährlich (Yearly)
- Zeigt den vom Backend berechneten APR
- Format: `+10.07%` oder `-5.23%`
- Berücksichtigt exchange-spezifische Funding-Intervalle

## Filter-Optionen

Die UI bietet folgende Filter:
- **Min Spread**: Mindest-Spread in Prozent (stündlich)
- **Min OI**: Mindest-Open-Interest in USD
- **Stability**: Nur stabile, moderate oder volatile Opportunities
- **Exchanges**: Börsen ein-/ausschließen
- **Timeframe**: MA-Zeitraum wählen (24h bis 30d)

## Beispiel

```
Symbol: BTC
Long Exchange: Paradex (Rate: 0.0050%)
Short Exchange: Extended (Rate: 0.0150%)
Spread: 0.0100% (stündlich)
Spread APR: ~87.6% (jährlich, vom Backend berechnet)
Stability Score: 5/5 (sehr stabil)
```

## Dateien

- `src/hooks/useMAArbitrage.ts` - Haupt-Hook für Arbitrage-Berechnung
- `src/pages/Arbitrage.tsx` - Arbitrage-Seite mit UI
- `src/services/fundingApi.ts` - API-Aufrufe für MA-Daten
