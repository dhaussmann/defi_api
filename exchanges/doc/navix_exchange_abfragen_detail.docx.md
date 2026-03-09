  
**NAVIX API**

Exchange API-Abfragen – Detailanalyse

Alle 25 Exchange-Services: Endpunkte, Abfragemuster, Funding-Rate-Formeln

Stand: 8.3.2026

# **Abfrage-Muster Übersicht**

Die 25 Exchange-Services lassen sich in 6 grundlegende Abfragemuster einteilen:

| Muster | Exchanges | Beschreibung |
| :---- | :---- | :---- |
| Single-Endpoint | dYdX, ARKM, Nado, Pacifica, Variational, Evedex | Ein einziger API-Call liefert alle Daten (Funding, Preis, OI, Volume) in einer Response. |
| Multi-Endpoint Parallel | Asterdex, Backpack, Reya, Vest, Ethereal | Mehrere Bulk-Endpunkte werden parallel via Promise.all() abgefragt und per Map zusammengeführt. |
| Metadata \+ Per-Market | Aevo, APEX, Astros, Hibachi, StandX, GRVT | Erst Marktliste laden, dann pro Market individuelle API-Calls für Details. |
| Metadata \+ Serial | EdgeX | Wie oben, aber Funding-Rates werden seriell mit 800ms Delay abgefragt (Rate-Limit-Schutz). |
| POST-basiert (JSON-RPC) | HyperLiquid, TradeXYZ, GRVT | POST-Request mit JSON-Body statt Query-Parametern. |
| WebSocket | Lighter | WebSocket-Verbindung, Subscribe auf market\_stats/all, 5s sammeln, dann schließen. |
| Aggregator (Proxy) | Bullpen | Keine eigene API – aggregiert Daten von HyperLiquid \+ TradeXYZ Services. |

# **Detailanalyse jeder Exchange**

## **1\. HyperLiquid**

**Base URL:** https://api.hyperliquid.xyz/info

**Methode:** POST (JSON-RPC-ähnlich)

**Besonderheit:** Zwei separate Aufrufe: Crypto-Märkte (Standard) und XYZ-Märkte (RWA/Stocks). Beide werden parallel via Promise.all() geladen.

### **API-Aufrufe**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1a | POST | /info  Body: { type: "metaAndAssetCtxs" } | Alle Crypto-Perps |
| 1b | POST | /info  Body: { type: "metaAndAssetCtxs", dex: "xyz" } | Alle RWA/Stock-Perps |

### **Funding-Rate-Formel**

rate8H \= parseFloat(assetCtx.funding) \* 8

APR \= calculateFundingRatesFrom8H(rate8H)  // \= rate8H \* 3 \* 365

### **Datenextraktion**

Response ist ein Tuple \[meta, assetContexts\]. Meta.universe enthält die Marktdefinitionen, assetContexts die Live-Daten. Index-basiertes Mapping: *meta.universe\[i\] ↔ assetContexts\[i\]*

ticker \= market.name  (Crypto: direkt, XYZ: via tradeXYZSymbolToHyperliquid)

markPrice \= assetContexts\[i\].markPx

OI \= parseFloat(openInterest) \* markPrice  (Token → USD)

volume24h \= assetContexts\[i\].dayNtlVlm

spread \= (impactPxs\[1\] \- impactPxs\[0\]) / markPx \* 100

priceChange24h \= (markPx \- prevDayPx) / prevDayPx \* 100

## **2\. Aevo**

**Base URL:** https://api.aevo.xyz

**Methode:** GET (REST)

**Besonderheit:** Aggressives Rate Limiting\! Max 2 concurrent Requests, 150ms Delay zwischen Requests, Exponential Backoff bei 429 (1s → 2s → 4s, max 3 Retries).

### **API-Aufrufe**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /markets?instrument\_type=PERPETUAL | Alle Perp-Märkte |
| 2 | GET | /funding?instrument\_name={name} | Funding Rate pro Market |
| 3 | GET | /statistics?asset={ticker}\&instrument\_type=PERPETUAL | OI, Volume, 24h-Preis |

⚠ Calls 2 und 3 werden PRO MARKET ausgeführt mit mapWithConcurrency(markets, 2, worker). Bei 100 Märkten \= 200 API-Calls\!

### **Funding-Rate-Formel**

rate8H \= parseFloat(fundingData.funding\_rate)

APR \= calculateFundingRatesFrom8H(rate8H)  // \= rate8H \* 3 \* 365

### **Rate-Limit-Mechanismus**

rateLimitDelay(): Prüft timeSinceLastRequest \< 150ms → wartet

withRetry(op, name): Bei HTTP 429 → Backoff: 1000ms \* 2^attempt

mapWithConcurrency(items, 2, worker): Max 2 gleichzeitige Worker-Threads

## **3\. Paradex**

**Base URL:** https://api.prod.paradex.trade/v1

**Besonderheit:** Dynamischer Funding-Intervall pro Market (aus Metadata). Standard 8h, aber kann variieren.

### **API-Aufrufe**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /markets | Metadata inkl. funding\_period\_hours |
| 2 | GET | /markets/summary?market=ALL | Live-Daten aller Märkte |

### **Funding-Rate-Formel**

periodsPerDay \= 24 / funding\_period\_hours

APR \= rate \* periodsPerDay \* 365

Ticker: paradexSymbolToHyperliquid("BTC-USD-PERP") → "BTC"

## **4\. Extended**

**Base URL:** https://api.starknet.extended.exchange/api/v1/info

### **API-Aufrufe**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /markets | Alle Märkte inkl. marketStats |

### **Funding-Rate-Formel**

rate8H \= parseFloat(market.marketStats.fundingRate) \* 8

APR \= rate8H \* 3 \* 365

Alle Daten (Funding, OI, Volume, Spread, 24h-Change) kommen in einer Response, eingebettet in marketStats.

## **5\. Asterdex (Aster)**

**Base URL:** https://fapi.asterdex.com

**Besonderheit:** Binance-ähnliche API-Struktur (fapi/v3). Dynamischer Funding-Intervall aus fundingInfo.

### **API-Aufrufe (alle 3 parallel)**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /fapi/v3/premiumIndex | Funding Rates \+ Mark/Index Price |
| 2 | GET | /fapi/v3/fundingInfo | Funding-Intervall je Symbol |
| 3 | GET | /fapi/v3/ticker/24hr | 24h-Volume \+ Price Change |

### **Funding-Rate-Formel**

paymentsPerDay \= 24 / fundingInfo.fundingIntervalHours

APR \= fundingRate \* paymentsPerDay \* 365

// Beispiel: 8h-Intervall → 3 payments/day

// Beispiel: 4h-Intervall → 6 payments/day

## **6\. Backpack**

**Base URL:** https://api.backpack.exchange

**Besonderheit:** Dynamischer Funding-Intervall basierend auf fundingInterval (in Millisekunden).

### **API-Aufrufe (alle 4 parallel)**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /api/v1/markets | Marktdefinitionen \+ fundingInterval |
| 2 | GET | /api/v1/tickers | 24h-Volume \+ Price Change |
| 3 | GET | /api/v1/markPrices | Mark Price \+ Funding Rate |
| 4 | GET | /api/v1/openInterest | Open Interest pro Symbol |

### **Funding-Rate-Formel**

intervalsPerHour \= 3600000 / market.fundingInterval

hourlyFundingRate \= fundingRatePerInterval \* intervalsPerHour

APR \= hourlyFundingRate \* 24 \* 365

## **7\. Lighter**

**REST URL:** https://explorer.elliot.ai/api

**WS URL:** wss://mainnet.zklighter.elliot.ai/stream

**Besonderheit:** Einzige Exchange mit WebSocket-Abfrage\! REST für Metadata, dann WebSocket für Live-Daten.

### **Ablauf**

1\. REST GET /markets → Market-Index → Symbol Mapping aufbauen

2\. WebSocket öffnen, subscribe { type: "subscribe", channel: "market\_stats/all" }

3\. 5 Sekunden lang Messages sammeln (letzte Werte gewinnen pro Market)

4\. WebSocket schließen, gesammelte Daten zurückgeben

⚠ Timeout: 10s. Wenn nach 10s keine Daten → Error. Normaler Sammelzeitraum: 5s.

### **Funding-Rate-Formel**

fundingRate \= parseFloat(stats.current\_funding\_rate)

APR \= fundingRate \* (24/1) \* 365 / 100  // 1h-Intervall, Rate in %

## **8\. EdgeX**

**Base URL:** https://pro.edgex.exchange

**Besonderheit:** Strengstes Rate Limiting\! Funding Rates werden SERIELL mit 800ms Delay zwischen Requests abgefragt. Bei 429: Exponential Backoff (2s → 4s → 8s).

### **API-Aufrufe**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /api/v1/public/meta/getMetaData | Contracts \+ Coins Metadata |
| 2\*N | GET | /api/v1/public/funding/getLatestFundingRate?contractId={id} | Funding Rate pro Contract (seriell\!) |

⚠ Bei 30 Contracts \= 30 serielle Calls mit je 800ms Pause \= \~24 Sekunden Minimum\!

### **Funding-Rate-Formel**

// EdgeX nutzt 4-Stunden-Intervalle

periodsPerDay \= 24 / 4  // \= 6

APR \= rate \* 6 \* 365

## **9\. APEX**

**Base URL:** https://omni.apex.exchange/api

### **API-Aufrufe**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /v3/symbols | Alle Perpetual Contracts (Config) |
| 2\*N | GET | /v3/ticker?symbol={crossSymbolName} | Ticker-Daten pro Symbol (parallel) |

Schritt 2 wird für jedes Symbol parallel via Promise.allSettled() ausgeführt.

### **Funding-Rate-Formel**

hourlyRate \= parseFloat(tickerData.fundingRate)

APR \= hourlyRate \* 24 \* 365

## **10\. Drift**

**Base URL:** https://data.api.drift.trade

### **API-Aufrufe**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /contracts | Alle Contracts (Perps \+ andere) |

### **Funding-Rate-Formel**

fundingRate \= parseFloat(contract.funding\_rate) \* 8 / 100

APR \= fundingRate \* 3 \* 365

*Hinweis: Drift liefert die Rate in Prozent statt als Dezimalzahl, daher / 100\.*

## **11\. dYdX**

**Base URL:** https://indexer.dydx.trade

### **API-Aufrufe**

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /v4/perpetualMarkets | Alle Perp-Märkte (Key-Value Object) |

Response ist ein Object { markets: { 'BTC-USD': {...}, 'ETH-USD': {...} } }. Iteration über Object.entries().

### **Funding-Rate-Formel**

hourlyRate \= parseFloat(market.defaultFundingRate1H)

APR \= hourlyRate \* 24 \* 365

maxLeverage \= 1 / parseFloat(market.initialMarginFraction)

## **12\. ARKM**

**Base URL:** https://arkm.com/api

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /public/tickers | Alle Ticker (filter: productType \=== 'perpetual') |

### **Funding-Rate-Formel**

rate8H \= parseFloat(market.fundingRate)

APR \= rate8H \* 3 \* 365

## **13\. Vest**

**Base URL:** https://server-prod.hz.vestmarkets.com/v2

**Besonderheit:** Benötigt Custom Header: xrestservermm: 'restserver0'. Unterstützt RWA-Assets (USD-Paare).

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /ticker/latest | Alle Ticker (Funding, Mark/Index Price) |
| 2 | GET | /ticker/24hr | 24h-Volume \+ Price Change |

### **Funding-Rate-Formel**

hourlyRate \= parseFloat(vestTicker.oneHrFundingRate)

APR \= hourlyRate \* 24 \* 365

## **14\. Ethereal**

**Base URL:** https://api.ethereal.trade/v1

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /product?order=asc\&orderBy=createdAt | Alle Produkte (filter: engineType \=== 0 für Perps) |
| 2 | GET | /product/market-price?productIds={ids} | Mark Prices \+ Spreads (Batch) |

### **Funding-Rate-Formel**

rate1H \= parseFloat(product.fundingRate1h)

APR \= rate1H \* 24 \* 365

## **15\. Evedex**

**Base URL:** https://exchange-api.evedex.com

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /api/market/instrument?fields=metrics | Alle Instrumente mit Metriken |

### **Funding-Rate-Formel**

fundingRate8H \= parseFloat(inst.fundingRate) \* \-1  // INVERTIERT\!

APR \= fundingRate8H \* 3 \* 365

⚠ Evedex invertiert die Funding Rate (\* \-1). Dies ist ein wichtiger Unterschied zu allen anderen Exchanges\!

## **16\. Astros**

**Base URL:** https://api.astros.ag

**Besonderheit:** Benötigt Browser-User-Agent Header. Pro Market 3 parallele Calls.

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /api/third/info/pairs | Alle Handelspaare |
| 2a\*N | GET | /api/third/v1/market/funding/current?pairName={sym} | Funding Rate |
| 2b\*N | GET | /api/third/info/ticker/24hr?pairName={sym} | 24h Ticker |
| 2c\*N | GET | /api/third/info/oi?pairName={sym} | Open Interest |

### **Funding-Rate-Formel**

hourlyRate \= parseFloat(fundingResponse.data.fundingRate)

APR \= hourlyRate \* 24 \* 365

## **17\. Nado**

**URL:** GET https://archive.prod.nado.xyz/v2/contracts

APR \= fundingRate24H \* 365  // Rate ist bereits täglich\!

## **18\. Pacifica**

**URL:** GET https://api.pacifica.fi/api/v1/info/prices

rate1H \= parseFloat(market.funding)

APR \= rate1H \* 24 \* 365

## **19\. Variational**

**URL:** GET https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats

**Besonderheit:** Nutzt native fetch() statt Axios. fundingRateAPR wird direkt von der API geliefert (bereits annualisiert).

APR \= parseFloat(listing.funding\_rate)  // Bereits APR\!

## **20\. Reya**

**Base URL:** https://api.reya.xyz/v2

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /marketDefinitions | Max Leverage pro Market |
| 2 | GET | /prices | Aktuelle Preise |
| 3 | GET | /markets/summary | Funding Rates \+ Volume \+ OI |

hourlyRate \= parseFloat(market.fundingRate)

APR \= hourlyRate \* 24 \* 365 / 100  // Rate in Prozent\!

## **21\. GRVT**

**Base URL:** https://market-data.grvt.io/full/v1

**Methode:** POST (JSON Bodies)

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | POST | /instruments  Body: { kind: \["PERPETUAL"\], is\_active: true } | Alle Instrumente |
| 2\*N | POST | /ticker  Body: { instrument: name } | Ticker pro Instrument |

APR \= parseFloat(fundingRate) \* (24/fundingIntervalHours) \* 365 / 100

## **22\. Hibachi**

**Base URL:** https://data-api.hibachi.xyz

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /market/exchange-info | Alle Contracts (filter: status LIVE) |
| 2a\*N | GET | /market/data/prices?symbol={sym} | Funding \+ Preise |
| 2b\*N | GET | /market/data/stats?symbol={sym} | Volume \+ 24h High/Low |
| 2c\*N | GET | /market/data/open-interest?symbol={sym} | Open Interest |

rate8H \= parseFloat(fundingRateEstimation.estimatedFundingRate)

APR \= rate8H \* 3 \* 365

## **23\. StandX**

**Base URL:** https://api.standx.com

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /exchange/v1/symbols | Alle Symbole |
| 2\*N | GET | /exchange/v1/market?symbol={sym} | Marktdaten pro Symbol |

rate1H \= parseFloat(market.funding\_rate)

APR \= rate1H \* 24 \* 365

## **24\. 01 (ZeroOne)**

**Base URL:** https://zo-mainnet.n1.xyz

| \# | HTTP | Endpunkt / Body | Daten |
| :---- | :---- | :---- | :---- |
| 1 | GET | /info | Alle Markets |
| 2\*N | GET | /market/{marketId}/stats | Stats pro Market |

rate1H \= stats.perpStats.funding\_rate

APR \= rate1H \* 24 \* 365

## **25\. Bullpen (Aggregator)**

**Besonderheit:** Keine eigene Exchange-API\! Aggregiert Daten von HyperLiquid \+ TradeXYZ.

const \[hlMarkets, xyzMarkets\] \= await Promise.all(\[

  hyperliquidService.getMarkets(),

  tradeXYZService.getMarkets()

\]);

// Deduplizierung: First-seen wins (HyperLiquid hat Priorität)

TradeXYZ selbst nutzt ebenfalls die HyperLiquid-API mit dem Parameter dex: 'xyz'.

# **API-Call-Volumen pro Exchange**

Geschätzte Anzahl externer API-Calls pro getMarkets()-Aufruf:

| Exchange | Calls | Aufschlüsselung |
| :---- | :---- | :---- |
| HyperLiquid | 2 | 2 POST-Requests (Crypto \+ XYZ) |
| Aevo | 1 \+ 2\*N | 1 Markets \+ (Funding \+ Stats) \* N Markets. Bei 100 Märkten: \~201 Calls |
| Paradex | 2 | 1 Metadata \+ 1 Summary (ALL) |
| Extended | 1 | Alles in einer Response |
| Asterdex | 3 | 3 Bulk-Endpunkte parallel |
| Backpack | 4 | 4 Bulk-Endpunkte parallel |
| Lighter | 1 \+ WS | 1 REST \+ 1 WebSocket-Session (5s) |
| EdgeX | 1 \+ N | 1 Metadata \+ N serielle Funding-Calls (langsam\!) |
| APEX | 1 \+ N | 1 Config \+ N Ticker-Calls (parallel) |
| Drift | 1 | Alles in einer Response |
| dYdX | 1 | Alles in einer Response |
| ARKM | 1 | Alles in einer Response |
| Vest | 2 | 2 Ticker-Endpunkte |
| Ethereal | 2 | 1 Products \+ 1 Market-Prices (Batch) |
| Evedex | 1 | Alles in einer Response |
| Astros | 1 \+ 3\*N | 1 Pairs \+ (Funding \+ Ticker \+ OI) \* N |
| Nado | 1 | Alles in einer Response |
| Pacifica | 1 | Alles in einer Response |
| Variational | 1 | Alles in einer Response |
| Reya | 3 | 3 Endpunkte parallel |
| GRVT | 1 \+ N | 1 Instruments \+ N Ticker-Calls |
| Hibachi | 1 \+ 3\*N | 1 Exchange-Info \+ 3 Calls pro Contract |
| StandX | 1 \+ N | 1 Symbols \+ N Market-Calls |
| 01 | 1 \+ N | 1 Info \+ N Stats-Calls |
| Bullpen | 2 (proxy) | Nutzt HyperLiquid \+ TradeXYZ Services intern |

**Gesamtschätzung bei 25 Exchanges mit je \~30 Märkten:** Ca. 500-800 externe API-Calls pro vollständigem Durchlauf aller Exchanges.