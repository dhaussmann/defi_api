  
**NAVIX / Too Many Cooks**

Funding Rate Arbitrage API

Technische Dokumentation

Cloudflare Workers · Hono Framework · TypeScript

Erstellt: 8.3.2026

# **1\. Projektübersicht**

Diese Anwendung ist eine auf Cloudflare Workers basierende REST-API, die in Echtzeit Funding Rates von über 25 dezentralen Perpetual-Börsen (DEXes) aggregiert. Der Hauptzweck ist die Identifikation von Funding-Rate-Arbitrage-Möglichkeiten zwischen verschiedenen Exchanges.

## **1.1 Kernfunktionalität**

**Funding Rate Aggregation:** Paralleles Abrufen von Marktdaten (Funding Rates, Open Interest, Volumen, Preise) von 25+ DEXes über deren jeweilige REST/GraphQL-APIs.

**Arbitrage-Strategiefindung:** Automatische Berechnung der profitabelsten Long/Short-Kombinationen über Exchange-Paare hinweg, basierend auf Funding-Rate-Differenzen (APR).

**Alert-System:** Benutzer können Strategien mit Schwellenwerten konfigurieren und erhalten Benachrichtigungen über Telegram-Bot und/oder Expo Push Notifications, wenn sich die APR-Differenz unter ihren Schwellenwert bewegt.

**Historische Datenanalyse:** Speicherung historischer Funding-Daten in Cloudflare Analytics Engine für Trendanalyse und durchschnittliche APR-Berechnung über konfigurierbare Zeiträume.

## **1.2 Technologie-Stack**

| Komponente | Technologie |
| :---- | :---- |
| Runtime | Cloudflare Workers (Edge) |
| Framework | Hono v4 (Lightweight Web Framework) |
| Sprache | TypeScript (kompiliert zu JavaScript-Bundle) |
| Datenbank | Cloudflare D1 (SQLite-basiert) |
| Cache/KV | Cloudflare KV (MARKET\_KV) |
| Analytics | Cloudflare Analytics Engine (FUNDING\_RATES Dataset) |
| HTTP-Client | Axios |
| Build-System | Wrangler (Cloudflare CLI) mit esbuild/unenv Polyfills |

## **1.3 Architektur-Diagramm (Datenfluss)**

                    ┌─────────────────┐

                    │  Cron Trigger   │

                    │  (stündlich)     │

                    └────────┬────────┘

                             │

                    ┌────────┴────────┐

                    │ ServiceFactory   │────\> 25+ Exchange Services

                    │ (getMarkets)     │\<──── Unified Market Data

                    └────────┬────────┘

                             │

              ┌────────────┼─────────────┐

              │              │              │

     ┌────────┴───┐ ┌────┴───────┐ ┌────┴───────┐

     │ KV Store     │ │ Analytics  │ │ D1 Database │

     │ (Latest)     │ │ Engine     │ │ (Strategies │

     │ MARKET\_KV    │ │ (History)  │ │  Users etc) │

     └──────┬───────┘ └────┬───────┘ └────┬───────┘

              │              │              │

              └────────────┼─────────────┘

                             │

                    ┌────────┴────────┐

                    │ Hono REST API  │───\> Frontend / Mobile App

                    │ \+ CORS         │\<─── API Requests

                    └─────────────────┘

# **2\. Projektstruktur (Original-TypeScript)**

Der vorliegende Code ist ein kompiliertes JavaScript-Bundle. Die ursprüngliche TypeScript-Struktur lässt sich aus den Kommentaren rekonstruieren:

src/

├── index.ts                         \# Haupteinstiegspunkt, Hono-App, Routing

├── config/

│   ├── exchanges.ts                 \# Exchange-Konfiguration (alle 25+ DEXes)

│   └── exchangeFees.ts              \# Gebührenstruktur je Exchange (BPS)

├── types/

│   └── marketTypes.ts               \# Asset-Klassifizierung (Stocks/Forex/etc.)

├── utils/

│   ├── logger.ts                    \# Strukturiertes API-Logging

│   ├── utils.ts                     \# Funding-Rate-Berechnungsfunktionen

│   └── tickersMapper.ts             \# Symbol-Normalisierung je Exchange

├── middleware/

│   └── auth.ts                      \# API-Key Authentifizierung

├── services/

│   └── exchanges/

│       ├── base/BaseExchangeService.ts  \# Abstrakte Basisklasse

│       ├── ServiceFactory.ts            \# Factory Pattern für Services

│       ├── hyperliquid.ts               \# HyperLiquid Service

│       ├── aevo.ts                      \# Aevo Service (Rate Limiting)

│       ├── paradex.ts / lighter.ts / ... \# Weitere 23 Exchange Services

└── routes/

    ├── exchanges.ts                 \# /api/\* – Live-Marktdaten

    ├── database.ts                  \# /api/db/\* – Historische Daten & Strategien

    ├── telegram.ts                  \# /api/telegram/\* – Bot-Auth & Alerts

    ├── push.ts                      \# /api/push/\* – Expo Push Notifications

    ├── user.ts                      \# /api/user/\* – Benutzerkonfiguration

    ├── internal.ts                  \# /api/internal/\* – Execution Cost (Auth)

    └── health.ts                    \# /health – System Health Checks

# **3\. Exchange-Integration**

## **3.1 Einheitliches Datenmodell (UnifiedMarketData)**

Jeder Exchange-Service implementiert eine getMarkets()-Methode, die Daten in ein einheitliches Format normalisiert:

| Feld | Typ | Beschreibung |
| :---- | :---- | :---- |
| ticker | string | Normalisierter Ticker (z.B. 'BTC', 'ETH') |
| marketPrice | number|null | Aktueller Mark Price in USD |
| fundingRateAPR | number | Annualisierte Funding Rate (Formel: hourly\*24\*365 oder 8h\*3\*365) |
| openInterest | number|null | Open Interest in USD (OI in Tokens \* Mark Price) |
| maxLeverage | number|null | Maximaler Hebel |
| volume24h | number|null | 24h-Handelsvolumen in USD |
| spreadBidAsk | number|null | Bid/Ask-Spread in Prozent |
| marketPriceChange%24h | number|null | Preisänderung letzte 24h in Prozent |
| marketType | enum | 'crypto' | 'stock' | 'forex' | 'etf' | 'index' | 'commodity' |

## **3.2 Funding Rate Berechnung**

Es gibt zwei Berechnungsmethoden, abhängig davon, ob die Exchange stündliche oder 8-stündliche Rates liefert:

// Von stündlicher Rate:     APR \= hourlyRate \* 24 \* 365

// Von 8h-Rate:              APR \= rate8H \* 3 \* 365

**Wichtig:** Die Normalisierung auf APR ermöglicht den direkten Vergleich zwischen Exchanges mit unterschiedlichen Funding-Intervallen.

## **3.3 Ticker-Normalisierung (tickersMapper.ts)**

Jede Exchange verwendet eigene Symbolformate. Die Mapper-Funktionen normalisieren zum HyperLiquid-Format (reiner Ticker ohne Suffixe):

| Exchange | Input-Format | Output | Logik |
| :---- | :---- | :---- | :---- |
| Paradex | BTC-USD-PERP | BTC | split('-')\[0\] |
| Aster | BTCUSDT | BTC | Entferne 'USDT'/'USD' Suffix |
| APEX | BTCUSDT | BTC | replace('USDT', '') |
| Reya | BTCRUSDPERP | BTC | replace('RUSDPERP', '') |
| ARKM | BTC.PERP | BTC | split('.')\[0\] |
| TradeXYZ | 123:BTC | BTC | split(':')\[1\] |

## **3.4 Exchange-Übersicht**

Die folgenden 10 Exchanges repräsentieren die wichtigsten Implementierungsmuster. Insgesamt sind 25+ Exchanges integriert:

| Exchange | API-Basis | Methode | Besonderheiten |
| :---- | :---- | :---- | :---- |
| HyperLiquid | api.hyperliquid.xyz | POST | Crypto \+ XYZ (RWA/Stocks) |
| Aevo | api.aevo.xyz | GET | Perpetuals, separate Funding/Statistics API |
| Paradex | api.prod.paradex.trade | GET | BBO-Endpunkt für Spreads |
| Lighter | api.lighter.xyz | GET | Orderbook-basierte Spread-Berechnung |
| EdgeX | api.edgex.exchange | GET | Pre-Launch Markets, Orderbook-Spreads |
| Backpack | api.backpack.exchange | GET | Ticker \+ Funding \+ OI Endpunkte |
| Drift | drift-historical-data-v2.s3.eu-west-1.amazonaws.com | GET | S3-basierte Marktdaten |
| Vest | serverprod.vest.exchange | POST (GraphQL) | GraphQL API |
| APEX | omni.apex.exchange | GET | v3 REST API |
| dYdX | indexer.dydx.trade | GET | v4 Indexer API |

## **3.5 ServiceFactory Pattern**

Die ServiceFactory implementiert ein Singleton-/Cache-Pattern für Exchange-Services:

class ServiceFactory {

  services \= new Map();           // Cache für instanziierte Services

  getService(exchange) {

    if (this.services.has(exchange)) return cached;

    const ServiceClass \= SERVICE\_REGISTRY\[exchange.key\];

    const service \= new ServiceClass();

    this.services.set(exchange, service);  // Einmalig erstellen

    return service;

  }

}

Das SERVICE\_REGISTRY-Objekt mappt jeden Exchange-Key auf seine Service-Klasse. Neue Exchanges werden registriert, indem man einen Eintrag hinzufügt.

# **4\. API-Endpunkte**

## **4.1 Health (/health)**

| Methode | Pfad | Beschreibung |
| :---- | :---- | :---- |
| GET | /health | Einfacher Health-Check (Status \+ Timestamp) |
| GET | /health/full | Erweiterter Check inkl. D1 \+ KV Verfügbarkeit |

## **4.2 Exchanges (/api)**

| Methode | Pfad | Beschreibung |
| :---- | :---- | :---- |
| GET | /api/exchanges | Liste aller verfügbaren Exchange-Keys |
| GET | /api/{exchange}/markets | Live-Marktdaten der Exchange (ruft getMarkets() auf) |

## **4.3 Database (/api/db)**

| Meth. | Pfad | Beschreibung |
| :---- | :---- | :---- |
| GET | /api/db/health | D1 Database Health Check |
| GET | /api/db/{exchange}/market-data | Historische Daten aus Analytics Engine. Query-Params: tickers, period (1-90 Tage) |
| GET | /api/db/{exchange}/market-data/latest | Aktuelle Daten aus KV-Store (schnell). Query-Param: tickers |
| GET | /api/db/best-strategies | Beste Arbitrage-Strategien. Params: count, exchangeNames, period, minVolume24h, minOpenInterest, spotMode, marketTypes |
| GET | /api/db/strategy | Einzelne Strategie mit Historie. Params: longExchange, shortExchange, ticker, period |

## **4.4 Telegram (/api/telegram)**

| Meth. | Pfad | Beschreibung |
| :---- | :---- | :---- |
| POST | /api/telegram/auth/verify | Telegram Login Widget Authentifizierung (HMAC-SHA256) |
| POST | /api/telegram/strategies | Neue Alert-Strategie erstellen (Limit: 5 free, 999 premium) |
| GET | /api/telegram/strategies/:chatId | Strategien eines Benutzers abrufen (angereichert mit aktuellem APR) |
| PATCH | /api/telegram/strategies/:id | Strategie aktualisieren (threshold\_apr, is\_active) |
| DEL | /api/telegram/strategies/:id | Strategie deaktivieren (Soft Delete) |
| GET | /api/telegram/check-strategies | Alle Strategien prüfen und Telegram-Alerts senden (4h Cooldown) |
| POST | /api/telegram/xp-request | XP Kauf/Verkauf-Anfrage an Telegram-Channel senden |

## **4.5 Push Notifications (/api/push)**

| Meth. | Pfad | Beschreibung |
| :---- | :---- | :---- |
| POST | /api/push/register | Expo Push Token registrieren (iOS/Android) |
| POST | /api/push/unregister | Push Token deaktivieren |
| POST | /api/push/test | Test-Notification an alle Geräte eines Users senden |
| GET | /api/push/check-strategies | Strategien prüfen und Push Alerts senden (24h Cooldown) |

## **4.6 User Config (/api/user)**

| Meth. | Pfad | Beschreibung |
| :---- | :---- | :---- |
| GET | /api/user/config/:chatId | Benutzerkonfiguration abrufen (Exchange-Auswahl, Filter) |
| POST | /api/user/config | Config erstellen/aktualisieren (Upsert via body.id) |
| DEL | /api/user/config/:id | Konfiguration löschen |

## **4.7 Internal (/api/internal) – API-Key geschützt**

**Authentifizierung:** Header x-internal-api-key muss mit Environment-Variable INTERNAL\_API\_KEY übereinstimmen.

| Meth. | Pfad | Beschreibung |
| :---- | :---- | :---- |
| POST | /api/internal/execution-cost/batch | Batch-Berechnung der Execution Costs (Taker Fees in BPS). Max 50 pro Batch, Concurrency 3\. |
| GET | /api/internal/execution-cost/supported | Liste der Exchanges mit Gebührendaten |

# **5\. Datenspeicherung & Bindings**

## **5.1 Environment Bindings (wrangler.toml)**

| Binding | Typ | Verwendung |
| :---- | :---- | :---- |
| DB | D1 | SQLite-Datenbank für User-Strategien, Push-Tokens, Notifications, User-Config, XP-Requests, Profile |
| MARKET\_KV | KV | Key-Value Store für aktuelle Marktdaten je Exchange (Key \= exchange name, Value \= JSON Array) |
| CLOUDFLARE\_ACCOUNT\_ID | Secret | Für Analytics Engine API-Zugriff |
| ANALYTICS\_ENGINE\_API\_TOKEN | Secret | Bearer Token für Analytics Engine SQL-Abfragen |
| TELEGRAM\_BOT\_TOKEN | Secret | Telegram Bot API Token für Auth-Verifizierung und Nachrichten |
| EXPO\_ACCESS\_TOKEN | Secret | Expo Push Notification Service Token |
| INTERNAL\_API\_KEY | Secret | API-Key für /api/internal/\* Endpunkte |
| CORS\_ORIGINS | Var | Komma-separierte erlaubte Origins. Zusätzlich: Vercel Preview \+ localhost automatisch erlaubt |

## **5.2 D1 Datenbank-Tabellen (abgeleitet)**

Folgende Tabellen werden im Code referenziert und müssen in D1 existieren:

user\_strategies        ─ telegram\_chat\_id, symbol, short\_exchange, long\_exchange, threshold\_apr, is\_active

sent\_notifications     ─ strategy\_id, apr\_value, sent\_at (Telegram Alert Cooldown: 4h)

push\_tokens            ─ telegram\_chat\_id, expo\_push\_token, platform, device\_name, is\_active

push\_sent\_notifications ─ strategy\_id, apr\_value, sent\_at (Push Alert Cooldown: 24h)

profiles               ─ telegram\_chat\_id, subscription\_tier, subscription\_expires\_at

user\_config            ─ telegram\_chat\_id, name, enabled\_exchanges (JSON), spot\_strategies\_enabled,

                         min\_open\_interest, max\_open\_interest, min\_volume\_24h, max\_volume\_24h

xp\_requests            ─ telegram\_username, xp\_amount, price, action, total\_value

## **5.3 Analytics Engine (FUNDING\_RATES Dataset)**

Historische Marktdaten werden in Cloudflares Analytics Engine gespeichert mit folgendem Schema:

| AE-Feld | SQL-Alias | Inhalt |
| :---- | :---- | :---- |
| blob1 | exchange | Exchange-Key (z.B. 'hyperliquid') |
| blob2 | ticker | Normalisierter Ticker (z.B. 'BTC') |
| double1 | funding\_rate\_apr | Annualisierte Funding Rate |
| double2 | open\_interest | Open Interest in USD |
| double3 | volume\_24h | 24h-Volumen in USD |
| double4 | market\_price | Mark Price in USD |

# **6\. Kernlogik im Detail**

## **6.1 Best-Strategies Algorithmus**

Der /api/db/best-strategies Endpunkt ist das Herzstück der Arbitrage-Erkennung. Er funktioniert in zwei Modi:

### **Modus 1: Pair-Arbitrage (Standard)**

1\. Lade aktuelle Marktdaten aller gewählten Exchanges aus KV-Store (MARKET\_KV).

2\. Gruppiere alle Daten nach normalisiertem Ticker (case-insensitive).

3\. Filtere nach optionalen Kriterien: minVolume24h, minOpenInterest, marketTypes.

4\. Für jeden Ticker mit Daten von mindestens 2 Exchanges: Sortiere Rates absteigend. Wähle höchste Rate als Short-Seite, niedrigste als Long-Seite.

5\. Berechne APR-Differenz \= shortRate \- longRate. Nur positive Differenzen sind profitabel.

6\. Sortiere alle Strategien nach APR-Differenz (absteigend) und gib die Top-N zurück.

### **Modus 2: Spot Mode**

Im Spot-Modus wird nur eine Exchange benötigt. Es werden alle Ticker mit positiver Funding Rate als Strategie ausgegeben (Short Perp \+ Long Spot Hedge). Sortierung ebenfalls nach APR absteigend.

## **6.2 Alert/Notification System**

Das Notification-System arbeitet in zwei parallelen Kanälen:

**Telegram Alerts:** Cooldown 4 Stunden. Prüfung über sent\_notifications Tabelle mit datetime('now', '-4 hours'). HTML-formatierte Nachrichten an die chat\_id des Benutzers.

**Push Alerts (Expo):** Cooldown 24 Stunden. Prüfung über push\_sent\_notifications. Sendet an alle registrierten Geräte eines Users parallel via Expo Push API.

**Trigger-Logik:** Ein Alert wird ausgelöst wenn: currentAPR (shortRate \- longRate) \< threshold\_apr. Das heißt: Der User wird benachrichtigt wenn die Arbitrage-Möglichkeit unter seinen konfigurierten Schwellenwert fällt.

## **6.3 Subscription-Modell**

Das System unterscheidet zwischen Free und Premium Tier:

**Free:** Maximal 5 aktive Alert-Strategien.

**Premium:** Bis zu 999 aktive Alert-Strategien. Ablaufdatum wird geprüft; nach Ablauf wird der User auf Free zurückgestuft.

## **6.4 Telegram Login Widget Authentifizierung**

Die Verifizierung nutzt das offizielle Telegram Login Widget Protokoll:

1\. Empfang der Auth-Daten (id, first\_name, auth\_date, hash).

2\. Data Check String: Alle Felder (außer hash) alphabetisch sortiert, als key=value mit Newline verbunden.

3\. Secret Key: SHA-256 Hash des Bot Tokens.

4\. HMAC-SHA256 Signatur des Data Check Strings mit dem Secret Key.

5\. Vergleich des berechneten Hashes mit dem empfangenen Hash.

# **7\. Exchange-Gebühren (exchangeFees.ts)**

Alle Gebühren sind in Basis Points (BPS) konfiguriert. 1 BPS \= 0.01%. Die Umrechnung erfolgt über bpsToPercent(bps) \= bps / 100\.

| Exchange | Taker Fee (BPS) | Maker Fee (BPS) |
| :---- | :---- | :---- |
| hyperliquid | 4.5 | 0.2 |
| paradex | 0 | 0 |
| lighter | 0 | 0 |
| extended | 2.5 | 1 |
| asterdex | 4 | 0.5 |
| edgex | 2 | 0 |
| vest | 0 | 0 |
| aevo | 3 | 0 |
| dydx | 2.5 | 1 |
| drift | 3 | 0.5 |
| backpack | 3 | 1 |
| grvt | 2.5 | 0.5 |

*Hinweis: Exchanges wie Paradex, Lighter und Vest haben derzeit 0% Gebühren (Promotionphase). Diese Werte sollten regelmäßig aktualisiert werden.*

# **8\. CORS & Sicherheit**

## **8.1 CORS-Konfiguration**

Die CORS-Middleware (Hono cors()) wird auf alle Routen angewendet (\*):

**Erlaubte Origins:** 1\) Aus CORS\_ORIGINS Environment-Variable (komma-separiert). 2\) Jede Vercel-Preview URL (Regex: /^https:\\/\\/.\*-.\*\\.vercel\\.app$/). 3\) Localhost mit beliebigem Port.

**Erlaubte Methoden:** GET, POST, PUT, DELETE, OPTIONS, PATCH

**Erlaubte Header:** Content-Type, Authorization, X-Telegram-Init-Data, X-Internal-Api-Key

## **8.2 Authentifizierung**

Es gibt zwei Authentifizierungsmechanismen:

**1\. Internal API Key:** Die Middleware requireInternalApiKey() schützt /api/internal/\* Routen. Prüft den x-internal-api-key Header gegen INTERNAL\_API\_KEY.

**2\. Telegram Login:** HMAC-SHA256 Verifizierung des Telegram Login Widgets für User-Authentifizierung.

**Hinweis:** *Die meisten öffentlichen Endpunkte (Marktdaten, Strategien) sind nicht authentifiziert. Für eine Produktionsumgebung sollte eine zusätzliche Rate-Limiting oder API-Key Schicht für diese Endpunkte erwägt werden.*

# **9\. Anleitung: Neuen Exchange hinzufügen**

Diese Schritt-für-Schritt-Anleitung zeigt, wie ein neuer Exchange in das System integriert wird:

## **Schritt 1: Exchange-Konfiguration**

In src/config/exchanges.ts einen neuen Eintrag zum EXCHANGES-Array hinzufügen:

{ key: "myexchange", name: "MyExchange", shortLabel: "MYX",

  historyEnabled: true, logoFilename: "myexchange.png",

  referralUrl: "https://myexchange.com/?ref=NAVIX" }

## **Schritt 2: Service-Klasse erstellen**

Neue Datei src/services/exchanges/myexchange.ts:

class MyExchangeService extends BaseExchangeService {

  async getMarkets(): Promise\<UnifiedMarketData\[\]\> {

    // 1\. API aufrufen (axios.get/post)

    // 2\. Funding Rate in APR umrechnen:

    //    \- Hourly: calculateFundingRatesFromHourly(rate)

    //    \- 8-Hourly: calculateFundingRatesFrom8H(rate)

    // 3\. Ticker normalisieren (ggf. Mapper in tickersMapper.ts)

    // 4\. Einheitliches Objekt zurückgeben

  }

}

## **Schritt 3: In ServiceFactory registrieren**

In src/services/exchanges/ServiceFactory.ts:

SERVICE\_REGISTRY\["myexchange"\] \= MyExchangeService;

## **Schritt 4: Optional – Gebühren konfigurieren**

In src/config/exchangeFees.ts:

myexchange: { takerFeeBps: 3, makerFeeBps: 1 }

## **Schritt 5: Optional – Ticker-Mapper**

Falls die Exchange ein eigenes Symbolformat verwendet, eine Mapper-Funktion in tickersMapper.ts hinzufügen:

const myexchangeSymbolToHyperliquid \= (symbol) \=\> {

  return symbol.replace('USDT', ''); // Beispiel

};

# **10\. Optimierungsvorschläge**

## **10.1 Sicherheit**

**SQL Injection:** In database.ts werden SQL-Queries mit String-Interpolation gebaut (z.B. blob1 \= '${exchange}'). Dies sollte durch parametrisierte Queries ersetzt werden, da die Analytics Engine API möglicherweise Injection-Vektoren hat.

**Rate Limiting:** Öffentliche Endpunkte haben kein Rate Limiting. Empfehlung: Cloudflare Rate Limiting Rules oder eine Middleware-Lösung.

**Input Validation:** Systematische Validierung aller Query-Parameter (z.B. mit zod oder hono/validator) statt manueller Prüfungen.

## **10.2 Performance**

**Parallelisierung:** Der best-strategies Endpunkt lädt Exchange-Daten bereits parallel über Promise.all. Die KV-Reads könnten zusätzlich durch KV-Bulk-Reads optimiert werden.

**Caching:** Die Live-Exchange-Endpunkte (/api/{exchange}/markets) haben aktuell kein Caching. Da die Funding Rates sich nur stündlich ändern, könnte ein Cache-Control Header oder KV-basiertes Caching mit 5-10 Minuten TTL implementiert werden.

**Aevo Rate Limiting:** Der Aevo-Service hat bereits ein robustes Rate-Limit-Handling mit Exponential Backoff. Die MAX\_CONCURRENT\_REQUESTS (aktuell 2\) könnte basierend auf Monitoring angepasst werden.

## **10.3 Architektur**

**TypeScript Interfaces:** Das UnifiedMarketData-Interface existiert implizit, sollte aber als explizites TypeScript Interface definiert werden, um die Typsicherheit über alle Exchange-Services zu gewährleisten.

**Error Handling:** Einheitliches Error-Response-Format über eine Error-Middleware statt individueller try/catch Blöcke in jeder Route.

**Testing:** Exchange-Services sollten mit Mock-APIs getestet werden (Vitest \+ MSW empfohlen). Besonders wichtig: Ticker-Normalisierung und Funding-Rate-Berechnungen.

**Monitoring:** Structured Logging (z.B. mit pino) statt console.log/error für bessere Observability in Cloudflare Dashboard.

## **10.4 Funktional**

**Slippage-Berechnung:** Der Execution-Cost Endpunkt gibt aktuell nur die Taker-Fee zurück, ohne echte Slippage-Berechnung. Eine Integration mit Orderbook-Daten (wo verfügbar) würde die Genauigkeit deutlich verbessern.

**Historische Funding-Daten:** Viele Exchange-Services haben auskommentierte getFundingData()-Methoden. Die Reaktivierung würde detailliertere historische Analysen ermöglichen.

**WebSocket-Integration:** Für Echtzeit-Updates könnten Durable Objects mit WebSocket-Verbindungen zu den Exchanges eingesetzt werden (insbesondere HyperLiquid, die eine WebSocket-API anbieten).