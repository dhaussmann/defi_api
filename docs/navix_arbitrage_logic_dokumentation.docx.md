**NAVIX / Too Many Cooks**

Arbitrage-Logik — Entwickler-Dokumentation

Referenz zur Integration in eigene Systeme

Stand: 9.3.2026

# **1\. Architekturübersicht**

Die Arbitrage-Logik ist auf zwei Schichten verteilt: das API-Backend (Cloudflare Worker) berechnet die Strategien serverseitig, das Frontend (Next.js) berechnet in Echtzeit die Darstellung und Profit-Simulation. Beide verwenden dieselbe Grundformel.

## **1.1 Zentrale Formel**

Spread APR \= Short\_Exchange.fundingRateAPR \- Long\_Exchange.fundingRateAPR  
   
// Short \= Exchange mit dem HÖCHSTEN Funding Rate (du empfängst Funding)  
// Long  \= Exchange mit dem NIEDRIGSTEN Funding Rate (du zahlst weniger)  
// Spread \> 0 \= profitable Arbitrage-Gelegenheit

## **1.2 Datenquellen**

| Quelle | Speicher | Inhalt |
| :---- | :---- | :---- |
| MARKET\_KV | Cloudflare KV Store | Aktuelle Marktdaten pro Exchange (JSON-Array mit allen Tickers) |
| FUNDING\_RATES | Cloudflare Analytics Engine | Historische Funding Rates (blob1=exchange, blob2=ticker, double1=apr, timestamp) |
| user\_strategies | Cloudflare D1 (SQLite) | Benutzer-definierte Alert-Strategien mit Schwellenwerten |

## **1.3 UnifiedMarketData Interface**

Jede Exchange liefert Daten im KV Store in diesem normalisierten Format:

interface UnifiedMarketData {  
  ticker: string;              // z.B. 'BTC', 'ETH'  
  fundingRateAPR: number;      // Bereits annualisiert (dezimal, z.B. 0.876 \= 87.6%)  
  openInterest: number | null; // In USD  
  volume24h: number | null;    // In USD  
  marketPrice: number | null;  
  marketPriceChangePercent24h: number | null;  
  spreadBidAsk: number | null;  
  maxLeverage: number | null;  
  marketType: string;          // 'crypto' | 'stock' | 'forex' | 'commodity' | 'index' | 'etf'  
}

# **2\. Best Strategies — Arbitrage-Ranking (Backend)**

**Endpoint:** GET /api/db/best-strategies

Findet die profitabelsten Exchange-Paare über alle Tickers hinweg. Dies ist der zentrale Algorithmus für das "Top Strategies"-Ranking.

## **2.1 Parameter**

| Parameter | Typ | Required | Beschreibung |
| :---- | :---- | :---- | :---- |
| count | number | Ja | Max. Ergebnisse (max 10.000) |
| exchangeNames | string | Ja | Komma-getrennte Exchange-Keys (z.B. 'hyperliquid,paradex,dydx') |
| period | number | Ja | Lookback-Tage (nur für Frontend-Kontext, Berechnung nutzt aktuelle KV-Daten) |
| minVolume24h | number | Nein | Minimales 24h-Volumen in USD |
| minOpenInterest | number | Nein | Minimales Open Interest in USD |
| spotMode | 'true'|'false' | Nein | Wenn true: Spot/Perp-Modus (nur 1 Exchange nötig) |
| marketTypes | string | Nein | Komma-getrennte Typen: crypto,stock,forex,commodity,index,etf |

## **2.2 Algorithmus: Perp/Perp-Modus**

Vollständiger Pseudocode für die Arbitrage-Erkennung:

// SCHRITT 1: Aktuelle Marktdaten laden  
const exchangeData \= new Map\<string, UnifiedMarketData\[\]\>();  
for (const name of exchangeNames) {  
  const data \= await MARKET\_KV.get(name, 'json');  
  if (data) exchangeData.set(name, data);  
}  
   
// SCHRITT 2: Tickers über alle Exchanges gruppieren \+ filtern  
const tickerRates \= new Map\<string, ExchangeRate\[\]\>();  
for (const \[exchange, markets\] of exchangeData) {  
  for (const market of markets) {  
    // Filter anwenden  
    if (minVolume24h && (market.volume24h ?? 0\) \< minVolume24h) continue;  
    if (minOpenInterest && (market.openInterest ?? 0\) \< minOpenInterest) continue;  
    if (marketTypes && \!marketTypes.includes(market.marketType)) continue;  
   
    const key \= market.ticker.toUpperCase();  
    const existing \= tickerRates.get(key) ?? \[\];  
    existing.push({  
      exchange,  
      rate: market.fundingRateAPR,    // Bereits annualisiert  
      openInterest: market.openInterest,  
      volume24h: market.volume24h,  
      marketPrice: market.marketPrice,  
      marketType: market.marketType  
    });  
    tickerRates.set(key, existing);  
  }  
}  
   
// SCHRITT 3: Für jeden Ticker das beste Paar finden  
const strategies \= \[\];  
for (const \[ticker, rates\] of tickerRates) {  
  // Benötigt mind. 2 Exchanges für Delta-Neutral  
  if (rates.length \< 2\) continue;  
   
  // Nach Rate absteigend sortieren  
  const sorted \= \[...rates\].sort((a, b) \=\> b.rate \- a.rate);  
   
  // Höchster Rate \= Short-Seite (empfängst Funding)  
  const short \= sorted\[0\];  
  // Niedrigster Rate \= Long-Seite (zahlst weniger)  
  const long \= sorted\[sorted.length \- 1\];  
   
  // Gleiche Exchange überspringen  
  if (short.exchange \=== long.exchange) continue;  
   
  // Spread berechnen  
  const diff \= short.rate \- long.rate;  
   
  // Nur profitable Spreads behalten  
  if (diff \<= 0\) continue;  
   
  strategies.push({  
    ticker,  
    avgFundingRateAPRDiff: diff,  // Der Arbitrage-Spread  
    shortExchangeData: { exchange: short.exchange, ... },  
    longExchangeData: { exchange: long.exchange, ... }  
  });  
}  
   
// SCHRITT 4: Nach Spread absteigend sortieren, Top-N zurückgeben  
strategies.sort((a, b) \=\> b.avgFundingRateAPRDiff \- a.avgFundingRateAPRDiff);  
return strategies.slice(0, count);

**Wichtig:** Der Algorithmus verwendet nur die AKTUELLEN Funding Rates aus dem KV Store — keine historischen Daten. Das Feld heisst avgFundingRateAPRDiff aus Legacy-Gründen, enthält aber den aktuellen Snapshot-Spread.

## **2.3 Algorithmus: Spot/Perp-Modus**

Im Spot-Modus wird kein Exchange-Paar gebildet. Stattdessen werden einzelne Exchanges mit positivem Funding Rate gesucht (Short Perp \+ Spot-Kauf als Hedge):

const strategies \= \[\];  
for (const \[exchange, markets\] of exchangeData) {  
  for (const market of markets) {  
    // NUR positive Funding Rates (Short empfängt Zahlung)  
    if (market.fundingRateAPR \<= 0\) continue;  
   
    // Filter anwenden (Volume, OI, MarketType)  
    if (minVolume24h && (market.volume24h ?? 0\) \< minVolume24h) continue;  
    if (minOpenInterest && (market.openInterest ?? 0\) \< minOpenInterest) continue;  
    if (marketTypes && \!marketTypes.includes(market.marketType)) continue;  
   
    strategies.push({  
      ticker: market.ticker,  
      avgFundingRateAPRDiff: market.fundingRateAPR,  // Gesamter Rate \= Profit  
      shortExchangeData: { exchange, ... }  
      // KEIN longExchangeData (Spot hat kein Funding)  
    });  
  }  
}  
strategies.sort((a, b) \=\> b.avgFundingRateAPRDiff \- a.avgFundingRateAPRDiff);  
return strategies.slice(0, count);

# **3\. Strategy Detail — Historische Analyse (Backend)**

**Endpoint:** GET /api/db/strategy

Liefert historische Spread-Zeitreihe und Durchschnitts-APR für ein spezifisches Exchange-Paar und Ticker.

## **3.1 Parameter**

| Parameter | Required | Beschreibung |
| :---- | :---- | :---- |
| shortExchange | Ja | Exchange-Key für die Short-Seite |
| longExchange | Ja | Exchange-Key für die Long-Seite |
| ticker | Ja | Asset-Ticker (z.B. 'BTC', 'ETH') |
| period | Nein | Lookback in Tagen (1–90, Default: 7\) |

## **3.2 Algorithmus**

// SCHRITT 1: Aktuelle Daten aus KV  
const shortMarket \= (await MARKET\_KV.get(shortExchange, 'json'))  
  .find(m \=\> m.ticker.toUpperCase() \=== ticker.toUpperCase());  
const longMarket \= (await MARKET\_KV.get(longExchange, 'json'))  
  .find(m \=\> m.ticker.toUpperCase() \=== ticker.toUpperCase());  
   
// SCHRITT 2: Historische Daten aus Analytics Engine  
const sql \= \`  
  SELECT blob1 AS exchange, blob2 AS ticker,  
         double1 AS funding\_rate\_apr, timestamp  
  FROM FUNDING\_RATES  
  WHERE blob2 \= '${ticker}'  
    AND (blob1 \= '${shortExchange}' OR blob1 \= '${longExchange}')  
    AND timestamp \>= NOW() \- INTERVAL '${period}' DAY  
  ORDER BY timestamp ASC\`;  
   
// SCHRITT 3: Timestamps paaren (nur wo BEIDE Exchanges Daten haben)  
const byTimestamp \= new Map\<string, { short?: number, long?: number }\>();  
for (const row of result.data) {  
  const existing \= byTimestamp.get(row.timestamp) ?? {};  
  if (row.exchange \=== shortExchange) existing.short \= row.funding\_rate\_apr;  
  if (row.exchange \=== longExchange) existing.long \= row.funding\_rate\_apr;  
  byTimestamp.set(row.timestamp, existing);  
}  
   
// SCHRITT 4: Spread-Zeitreihe berechnen  
const history \= Array.from(byTimestamp.entries())  
  .filter((\[, v\]) \=\> v.short \!== undefined && v.long \!== undefined)  
  .map((\[timestamp, v\]) \=\> ({  
    timestamp,  
    fundingRateAPRDiff: v.short \- v.long  
  }));  
   
// SCHRITT 5: Durchschnitt berechnen  
const avgDiff \= history.length \> 0  
  ? history.reduce((sum, d) \=\> sum \+ d.fundingRateAPRDiff, 0\) / history.length  
  : shortMarket.fundingRateAPR \- (longMarket?.fundingRateAPR ?? 0);

**Fallback:** Wenn keine historischen Daten verfügbar sind (z.B. Analytics Engine nicht konfiguriert), wird der aktuelle Snapshot-Spread als avgDiff verwendet.

## **3.3 Response-Struktur**

{  
  ticker: string,  
  avgFundingRateAPRDiff: number,       // Durchschnittlicher Spread  
  fundingRateAPRDiffHistory: \[          // Zeitreihe  
    { timestamp: string, fundingRateAPRDiff: number }  
  \],  
  shortExchangeData: {  
    exchange, ticker, funding\_rate\_apr,  
    open\_interest, volume\_24h, market\_price, market\_type, timestamp  
  },  
  longExchangeData: { ... } | undefined  // undefined bei Spot-Modus  
}

# **4\. Frontend Best-Strategy-Berechnung**

Das Frontend berechnet für die Tabellen-Ansicht ebenfalls den besten Spread — direkt auf den bereits geladenen Latest-Market-Daten, ohne Backend-Call.

## **4.1 Funktion We() — Perp/Perp-Modus**

function findBestStrategy(tickerRow, isSpotMode, mustIncludeExchange) {  
  if (isSpotMode) return findBestSpotStrategy(tickerRow, mustIncludeExchange);  
   
  const exchanges \= tickerRow.exchanges;  // Array aller Exchanges für diesen Ticker  
  if (exchanges.length \< 2\) return null;  
   
  let best \= null;  
   
  // Brute-Force: Alle Exchange-Paare durchprobieren  
  for (let i \= 0; i \< exchanges.length; i++) {  
    for (let j \= 0; j \< exchanges.length; j++) {  
      if (i \=== j) continue;  
   
      const longExchange \= exchanges\[i\];    // Potentielle Long-Seite  
      const shortExchange \= exchanges\[j\];   // Potentielle Short-Seite  
   
      // Optional: mustIncludeExchange-Filter  
      if (mustIncludeExchange) {  
        const target \= mustIncludeExchange.toLowerCase();  
        const isShort \= shortExchange.exchange.toLowerCase() \=== target;  
        const isLong \= longExchange.exchange.toLowerCase() \=== target;  
        if (\!isShort && \!isLong) continue;  
      }  
   
      const longAPR \= longExchange.funding\_rate\_apr ?? 0;  
      const spreadAPR \= (shortExchange.funding\_rate\_apr ?? 0\) \- longAPR;  
   
      if (\!best || spreadAPR \> best.avgFundingRateAPRDiff) {  
        best \= {  
          longExchangeData: longExchange,  
          shortExchangeData: shortExchange,  
          ticker: tickerRow.ticker,  
          avgFundingRateAPRDiff: spreadAPR  
        };  
      }  
    }  
  }  
  return best;  
}

## **4.2 Funktion findBestSpotStrategy() — Spot-Modus**

function findBestSpotStrategy(tickerRow, mustIncludeExchange) {  
  const exchanges \= tickerRow.exchanges;  
  if (exchanges.length \=== 0\) return null;  
   
  // Prüfe ob RWA-Exchanges vorhanden sind  
  const hasRwa \= exchanges.some(e \=\> isRwaExchange(e.exchange));  
   
  // Bei RWA: alle Exchanges zulassen, sonst nur positive Rates  
  let candidates \= hasRwa ? exchanges : exchanges.filter(e \=\>   
    (e.funding\_rate\_apr ?? 0\) \> 0  
  );  
   
  // Optional: mustIncludeExchange filtern  
  if (mustIncludeExchange) {  
    const target \= mustIncludeExchange.toLowerCase();  
    candidates \= candidates.filter(e \=\>   
      e.exchange.toLowerCase() \=== target  
    );  
  }  
   
  if (candidates.length \=== 0\) return null;  
   
  // Exchange mit dem höchsten Funding Rate finden  
  const best \= candidates.reduce((a, b) \=\>   
    (b.funding\_rate\_apr ?? 0\) \> (a.funding\_rate\_apr ?? 0\) ? b : a  
  );  
   
  return {  
    shortExchangeData: best,  
    longExchangeData: undefined,  // Spot \= kein Long-Exchange  
    ticker: tickerRow.ticker,  
    avgFundingRateAPRDiff: best.funding\_rate\_apr ?? 0  
  };  
}

## **4.3 Funktion ZC() — Spread-Wert für Sortierung**

Identisch mit We(), gibt aber nur den numerischen Spread-Wert zurück (kein Objekt). Wird für die Tabellen-Sortierung verwendet.

function getBestStrategyAPR(tickerRow, isSpotMode, mustIncludeExchange) {  
  // Gleiche Logik wie findBestStrategy(),   
  // aber return nur: number (den höchsten Spread-Wert)  
  // Statt Objekt wird nur der höchste aprDiff-Wert zurückgegeben  
}

# **5\. Profit-Simulation (Frontend)**

Berechnet die erwarteten Gewinne basierend auf dem aktuellen Funding-Rate-Spread und der konfigurierten Positionsgröße.

## **5.1 Positionsgröße**

// Investition wird HALBIERT, da auf beide Seiten aufgeteilt  
const positionSize \= investment \* leverage / 2;  
   
// Beispiel: $10.000 Investment, 2x Leverage  
// positionSize \= 10000 \* 2 / 2 \= $10.000 pro Seite  
// Gesamt-Exposure: $20.000 ($10k Short \+ $10k Long)

## **5.2 Profit-Berechnung**

function calculateProfit({ shortAPR, longAPR, positionSize }) {  
  // shortAPR und longAPR sind Dezimalwerte (z.B. 0.876 \= 87.6%)  
  // positionSize ist der Betrag PRO SEITE in USD  
   
  if (\!Number.isFinite(positionSize) || positionSize \<= 0\) {  
    return { hourly: 0, daily: 0, weekly: 0, monthly: 0, yearly: 0 };  
  }  
   
  // Jahresprofit \= Position \* (Short APR \- Long APR)  
  const yearlyProfit \= positionSize \*   
    ((typeof shortAPR \=== 'number' ? shortAPR : 0\) \-   
     (typeof longAPR \=== 'number' ? longAPR : 0));  
   
  const WEEKS\_PER\_YEAR \= 365 / 7;  // \= 52.142857...  
   
  return {  
    hourly:  yearlyProfit / 8760,          // ÷ Stunden/Jahr  
    daily:   yearlyProfit / 365,            // ÷ Tage/Jahr  
    weekly:  yearlyProfit / WEEKS\_PER\_YEAR, // ÷ Wochen/Jahr  
    monthly: yearlyProfit / 12,             // ÷ Monate/Jahr  
    yearly:  yearlyProfit                   // Direkt  
  };  
}

## **5.3 Rechenbeispiel**

| Parameter | Wert |
| :---- | :---- |
| Short Exchange (Paradex) APR | 120% \= 1.20 |
| Long Exchange (Hyperliquid) APR | 40% \= 0.40 |
| Investment | $10.000 |
| Leverage | 2x |
| positionSize (pro Seite) | $10.000 \* 2 / 2 \= $10.000 |
| Spread | 1.20 \- 0.40 \= 0.80 (80%) |
| Yearly Profit | **$10.000 \* 0.80 \= $8.000** |
| Monthly | $8.000 / 12 \= $666.67 |
| Weekly | $8.000 / 52.14 \= $153.43 |
| Daily | $8.000 / 365 \= $21.92 |
| Hourly | $8.000 / 8760 \= $0.91 |

**Limitation:** Die Simulation nutzt nur die AKTUELLEN Funding Rates. Sie berücksichtigt NICHT: Slippage, Taker Fees, Funding-Rate-Änderungen, Liquidationsrisiko, Compounding oder Margin-Anforderungen.

# **6\. Backtest-Statistiken (Frontend)**

Berechnet Stabilitäts- und Risikometriken aus der historischen Spread-Zeitreihe. Wird auf der Strategy-Detail-Seite angezeigt.

## **6.1 Statistik-Berechnung**

function computeBacktestStats(history, currentAprDiff) {  
  if (history.length \< 2\) return null;  
   
  const diffs \= history.map(h \=\> h.fundingRateAPRDiff);  
  const n \= diffs.length;  
   
  // Grundstatistiken  
  const min \= Math.min(...diffs);  
  const max \= Math.max(...diffs);  
  const avg \= diffs.reduce((a, b) \=\> a \+ b, 0\) / n;  
   
  // Median  
  const sorted \= \[...diffs\].sort((a, b) \=\> a \- b);  
  const mid \= Math.floor(n / 2);  
  const median \= n % 2 \=== 0 ? (sorted\[mid-1\] \+ sorted\[mid\]) / 2 : sorted\[mid\];  
   
  // Standardabweichung (Population)  
  const stdDev \= Math.sqrt(  
    diffs.reduce((sum, x) \=\> sum \+ (x \- avg) \*\* 2, 0\) / n  
  );  
   
  // Anteil positiver Spreads (% der Zeit profitabel)  
  const positiveCount \= diffs.filter(d \=\> d \> 0).length;  
  const positivePercentage \= positiveCount / n;  
   
  // Outlier-Erkennung: Aktueller Spread \> 2σ vom Mittelwert  
  const isOutlier \= Math.abs(currentAprDiff \- avg) \> 2 \* stdDev;  
   
  // Stabilitäts-Score basierend auf Variationskoeffizient (CV)  
  let stabilityScore;  
  const absAvg \= Math.abs(avg);  
  if (absAvg \< 0.001) {  
    // Durchschnitt nahe 0: Standardabweichung direkt bewerten  
    stabilityScore \= stdDev \< 0.02 ? 'high'   
                   : stdDev \> 0.05 ? 'low' : 'medium';  
  } else {  
    const cv \= stdDev / absAvg;  // Variationskoeffizient  
    stabilityScore \= cv \< 0.5 ? 'high'  
                   : cv \> 1.5 ? 'low' : 'medium';  
  }  
   
  return { min, max, avg, median, stdDev,  
           positivePercentage, dataPoints: n,  
           isOutlier, stabilityScore };  
}

## **6.2 Interpretationshilfe**

| Metrik | Schwellenwert | Bedeutung |
| :---- | :---- | :---- |
| stabilityScore | CV \< 0.5 | 'high' — Spread ist stabil, geringe Schwankungen relativ zum Mittelwert |
|  | CV 0.5–1.5 | 'medium' — Mäßige Schwankungen |
|  | CV \> 1.5 | 'low' — Hohe Volatilität, Spread ist unberechenbar |
| isOutlier | |current-avg| \> 2σ | Aktueller Spread ist ungewöhnlich — könnte nicht nachhaltig sein |
| positivePercentage | \> 80% | Spread war in \>80% der Zeit profitabel — gutes Zeichen |

# **7\. Alert-System — Automatische Strategie-Überwachung**

**Endpoint:** GET /api/telegram/check-strategies

Wird periodisch aufgerufen (z.B. via Cron) und prüft alle aktiven Benutzer-Strategien gegen aktuelle Marktdaten.

## **7.1 Algorithmus**

// Alle aktiven Strategien laden  
const strategies \= await DB.prepare(  
  'SELECT \* FROM user\_strategies WHERE is\_active \= 1'  
).all();  
   
for (const strategy of strategies) {  
  // COOLDOWN: Keine Benachrichtigung wenn in letzten 4h bereits gesendet  
  const recent \= await DB.prepare(  
    \`SELECT id FROM sent\_notifications   
     WHERE strategy\_id \= ?   
     AND sent\_at \> datetime('now', '-4 hours')\`  
  ).bind(strategy.id).first();  
  if (recent) continue;  
   
  // Aktuelle Rates aus KV laden  
  const shortData \= await MARKET\_KV.get(strategy.short\_exchange, 'json');  
  const longData \= await MARKET\_KV.get(strategy.long\_exchange, 'json');  
  if (\!shortData || \!longData) continue;  
   
  const shortRate \= shortData.find(  
    m \=\> m.ticker.toUpperCase() \=== strategy.symbol.toUpperCase()  
  )?.fundingRateAPR;  
  const longRate \= longData.find(  
    m \=\> m.ticker.toUpperCase() \=== strategy.symbol.toUpperCase()  
  )?.fundingRateAPR;  
   
  if (shortRate \=== undefined || longRate \=== undefined) continue;  
   
  // Aktuellen Spread berechnen  
  const currentApr \= shortRate \- longRate;  
   
  // Alert wenn Spread UNTER Schwellenwert fällt  
  // (= Strategie wird weniger profitabel)  
  if (currentApr \< strategy.threshold\_apr) {  
    await sendTelegramMessage(strategy.telegram\_chat\_id,   
      \`Alert: ${strategy.symbol} APR: ${currentApr} \< Threshold: ${strategy.threshold\_apr}\`  
    );  
   
    // Notification loggen für Cooldown  
    await DB.prepare(  
      'INSERT INTO sent\_notifications (strategy\_id, apr\_value) VALUES (?, ?)'  
    ).bind(strategy.id, currentApr).run();  
  }  
}

**Alert-Richtung:** Der Alert feuert wenn der Spread UNTER den Schwellenwert fällt (currentApr \< threshold). Es ist also eine Warnung, dass die Strategie weniger profitabel wird — kein Einstiegssignal.

## **7.2 Datenbank-Schema für Strategien**

CREATE TABLE user\_strategies (  
  id INTEGER PRIMARY KEY AUTOINCREMENT,  
  telegram\_chat\_id TEXT NOT NULL,  
  symbol TEXT NOT NULL,           \-- z.B. 'BTC'  
  short\_exchange TEXT NOT NULL,    \-- z.B. 'paradex'  
  long\_exchange TEXT NOT NULL,     \-- z.B. 'hyperliquid'  
  threshold\_apr REAL NOT NULL,     \-- Schwellenwert (Dezimal, z.B. 0.5 \= 50%)  
  is\_active BOOLEAN DEFAULT 1,  
  created\_at DATETIME DEFAULT CURRENT\_TIMESTAMP  
);  
   
CREATE TABLE sent\_notifications (  
  id INTEGER PRIMARY KEY AUTOINCREMENT,  
  strategy\_id INTEGER NOT NULL,  
  apr\_value REAL,                 \-- Spread-Wert beim Alert  
  sent\_at DATETIME DEFAULT CURRENT\_TIMESTAMP  
);

# **8\. Integrations-Leitfaden**

Schritte zur Integration der Arbitrage-Logik in ein eigenes System.

## **8.1 Minimale Implementation**

**Was du brauchst:**

* Funding Rates von mindestens 2 DEX-Exchanges (annualisiert als Dezimalwert)

* Einen periodischen Job der die Rates aktualisiert (z.B. alle 5–60 Minuten)

* Einen Speicher für die aktuellen Rates (KV, Redis, DB, In-Memory)

## **8.2 Standalone-Beispiel (TypeScript)**

Komplettes, lauffähiges Beispiel der Arbitrage-Erkennung:

// \============================================================  
// STANDALONE ARBITRAGE DETECTOR  
// \============================================================  
   
interface MarketData {  
  ticker: string;  
  fundingRateAPR: number;  // Annualisiert, Dezimal  
  volume24h?: number;  
  openInterest?: number;  
}  
   
interface ArbitrageStrategy {  
  ticker: string;  
  spreadAPR: number;  
  shortExchange: string;  
  shortAPR: number;  
  longExchange: string;  
  longAPR: number;  
}  
   
function findArbitrageOpportunities(  
  exchangeData: Map\<string, MarketData\[\]\>,  
  options?: {  
    minVolume24h?: number;  
    minOpenInterest?: number;  
    minSpreadAPR?: number;  
  }  
): ArbitrageStrategy\[\] {  
  const { minVolume24h \= 0, minOpenInterest \= 0, minSpreadAPR \= 0 } \= options ?? {};  
   
  // Schritt 1: Tickers über Exchanges gruppieren  
  const tickerRates \= new Map\<string, Array\<{  
    exchange: string; rate: number;  
    volume24h?: number; openInterest?: number;  
  }\>\>();  
   
  for (const \[exchange, markets\] of exchangeData) {  
    for (const market of markets) {  
      if (minVolume24h && (market.volume24h ?? 0\) \< minVolume24h) continue;  
      if (minOpenInterest && (market.openInterest ?? 0\) \< minOpenInterest) continue;  
   
      const key \= market.ticker.toUpperCase();  
      const list \= tickerRates.get(key) ?? \[\];  
      list.push({ exchange, rate: market.fundingRateAPR, ...market });  
      tickerRates.set(key, list);  
    }  
  }  
   
  // Schritt 2: Bestes Paar pro Ticker finden  
  const strategies: ArbitrageStrategy\[\] \= \[\];  
   
  for (const \[ticker, rates\] of tickerRates) {  
    if (rates.length \< 2\) continue;  
   
    const sorted \= \[...rates\].sort((a, b) \=\> b.rate \- a.rate);  
    const short \= sorted\[0\];  
    const long \= sorted\[sorted.length \- 1\];  
   
    if (short.exchange \=== long.exchange) continue;  
   
    const spread \= short.rate \- long.rate;  
    if (spread \<= minSpreadAPR) continue;  
   
    strategies.push({  
      ticker,  
      spreadAPR: spread,  
      shortExchange: short.exchange,  
      shortAPR: short.rate,  
      longExchange: long.exchange,  
      longAPR: long.rate,  
    });  
  }  
   
  // Schritt 3: Nach Spread sortieren  
  return strategies.sort((a, b) \=\> b.spreadAPR \- a.spreadAPR);  
}  
   
// \============================================================  
// PROFIT-BERECHNUNG  
// \============================================================  
   
function calculateProfit(params: {  
  shortAPR: number;  
  longAPR: number;  
  investmentUSD: number;  
  leverage: number;  
}) {  
  const positionSize \= params.investmentUSD \* params.leverage / 2;  
  const yearlyProfit \= positionSize \* (params.shortAPR \- params.longAPR);  
   
  return {  
    positionPerSide: positionSize,  
    hourly:  yearlyProfit / 8760,  
    daily:   yearlyProfit / 365,  
    weekly:  yearlyProfit / (365/7),  
    monthly: yearlyProfit / 12,  
    yearly:  yearlyProfit,  
  };  
}  
   
// \============================================================  
// NUTZUNG  
// \============================================================  
   
const data \= new Map(\[  
  \['hyperliquid', \[{ ticker: 'BTC', fundingRateAPR: 0.40, volume24h: 50\_000\_000 }\]\],  
  \['paradex',     \[{ ticker: 'BTC', fundingRateAPR: 1.20, volume24h: 10\_000\_000 }\]\],  
  \['dydx',        \[{ ticker: 'BTC', fundingRateAPR: 0.65, volume24h: 20\_000\_000 }\]\],  
\]);  
   
const opportunities \= findArbitrageOpportunities(data, { minSpreadAPR: 0.10 });  
// \=\> \[{ ticker: 'BTC', spreadAPR: 0.80, short: 'paradex', long: 'hyperliquid' },  
//     { ticker: 'BTC', spreadAPR: 0.55, short: 'paradex', long: 'dydx' }, ...\]  
   
const profit \= calculateProfit({  
  shortAPR: 1.20,  longAPR: 0.40,  
  investmentUSD: 10\_000,  leverage: 2  
});  
// \=\> { positionPerSide: 10000, daily: 21.92, monthly: 666.67, yearly: 8000 }

## **8.3 Checkliste für die Integration**

**Daten-Pipeline:**

1. Funding Rates immer als annualisierten Dezimalwert speichern (0.876 \= 87.6% APR)

2. Annualisierung: Hourly Rate \* 24 \* 365, 8-Hourly Rate \* 3 \* 365

3. Open Interest immer in USD konvertieren (einige APIs liefern in Kontrakten)

4. Tickers normalisieren (uppercase, ohne Suffix wie '-PERP' oder '-USD')

**Arbitrage-Logik:**

1. Höchster Rate \= Short-Seite, Niedrigster Rate \= Long-Seite

2. Spread \= Short APR \- Long APR (muss \> 0 sein für Profit)

3. Mindestens 2 verschiedene Exchanges pro Ticker erforderlich

4. Gleiche Exchange als Short und Long ausschließen

**Alerts:**

1. Alert feuert wenn Spread UNTER Schwellenwert fällt (Spread-Kompression)

2. Cooldown implementieren (z.B. 4 Stunden) um Spam zu vermeiden

3. Notification-Log führen für Cooldown-Prüfung

# **9\. API-Endpunkt-Übersicht**

| Methode | Pfad | Funktion |
| :---- | :---- | :---- |
| GET | /api/db/best-strategies | Top-N Arbitrage-Strategien (Ranking) |
| GET | /api/db/strategy | Einzelne Strategie mit historischer Zeitreihe |
| GET | /api/db/:exchange/market-data | Historische Daten pro Exchange (mit Durchschnitt) |
| GET | /api/db/:exchange/market-data/latest | Aktuelle Snapshot-Daten aus KV |
| GET | /api/telegram/check-strategies | Alert-Prüfung aller aktiven Strategien |
| POST | /api/internal/execution-cost/batch | Slippage/Fee-Berechnung (Premium) |

