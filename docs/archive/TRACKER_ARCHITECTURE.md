# Tracker-Architektur und Datenverarbeitung

## Inhaltsverzeichnis
1. [Übersicht](#übersicht)
2. [Tracker-Typen](#tracker-typen)
3. [Datenfluss](#datenfluss)
4. [Datenspeicherung](#datenspeicherung)
5. [Normalisierung](#normalisierung)
6. [Inkonsistenzen](#inkonsistenzen)
7. [Verbesserungsvorschläge](#verbesserungsvorschläge)

---

## Übersicht

Das System verwendet **Cloudflare Durable Objects** als Tracker für verschiedene DeFi-Exchanges. Jeder Tracker ist ein persistentes Objekt, das kontinuierlich Marktdaten sammelt und in Cloudflare D1 Datenbanken speichert.

### Architektur-Komponenten

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Durable Objects (Tracker)                │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │   │
│  │  │ Lighter  │  │ Paradex  │  │Hyperliquid│  ...     │   │
│  │  │ Tracker  │  │ Tracker  │  │ Tracker  │           │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘           │   │
│  └───────┼─────────────┼─────────────┼──────────────────┘   │
│          │             │             │                       │
│          └─────────────┴─────────────┘                       │
│                        │                                     │
│                        ▼                                     │
│          ┌─────────────────────────────┐                    │
│          │   D1 Database (DB_WRITE)    │                    │
│          │   - market_stats (15s)      │                    │
│          │   - market_stats_1m (1m)    │                    │
│          │   - tracker_status          │                    │
│          └─────────────┬───────────────┘                    │
│                        │                                     │
│                        │ Cron Aggregation                    │
│                        ▼                                     │
│          ┌─────────────────────────────┐                    │
│          │   D1 Database (DB_READ)     │                    │
│          │   - market_history (1h)     │                    │
│          │   - funding_ma_cache        │                    │
│          │   - normalized_tokens       │                    │
│          └─────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Tracker-Typen

### 1. WebSocket-basierte Tracker

**Exchanges:** Lighter, Paradex, EdgeX, Aster, Extended, HyENA, XYZ, FLX, VNTL, KM

**Funktionsweise:**
- Persistente WebSocket-Verbindung zum Exchange
- Empfangen von Echtzeit-Updates
- Buffering der Daten im Speicher
- Periodisches Speichern (alle 15 Sekunden)

**Beispiel: LighterTracker**

```typescript
class LighterTracker implements DurableObject {
  private ws: WebSocket | null = null;
  private dataBuffer: Map<string, LighterMarketStats> = new Map();
  
  // Verbindung herstellen
  async connect() {
    this.ws = new WebSocket('wss://api.lighter.xyz/v1/ws');
    
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'update/market_stats') {
        // Daten in Buffer speichern
        this.dataBuffer.set(message.market_stats.symbol, message.market_stats);
      }
    });
  }
  
  // Alle 15 Sekunden: Snapshot in DB speichern
  async saveSnapshot() {
    const records = Array.from(this.dataBuffer.values()).map(data => ({
      exchange: 'lighter',
      symbol: data.symbol,
      funding_rate: data.funding_rate,
      // ... weitere Felder
    }));
    
    await this.env.DB_WRITE.batch(insertStatements);
  }
}
```

**Besonderheiten:**
- **Paradex:** Präventives Reconnect alle 45s (vor 60s Timeout)
- **Lighter:** Ping/Pong Keep-Alive alle 30s
- **EdgeX:** Komplexes Message-Handling mit verschiedenen Channels

### 2. API-Polling-basierte Tracker

**Exchanges:** Hyperliquid, Variational, Pacifica

**Funktionsweise:**
- Periodische API-Abfragen (alle 15 Sekunden)
- Zeitgesteuerte Abfragen auf :00, :15, :30, :45 Sekunden
- Sofortige Speicherung nach jedem Poll

**Beispiel: HyperliquidTracker**

```typescript
class HyperliquidTracker implements DurableObject {
  private readonly POLL_INTERVAL = 15000; // 15 Sekunden
  private readonly API_URL = 'https://api.hyperliquid.xyz/info';
  
  async pollAndSave() {
    // API aufrufen
    const response = await fetch(this.API_URL, {
      method: 'POST',
      body: JSON.stringify({ type: 'metaAndAssetCtxs' })
    });
    
    const [meta, assetCtxs] = await response.json();
    
    // Daten direkt speichern
    for (let i = 0; i < meta.universe.length; i++) {
      const symbol = meta.universe[i].name;
      const ctx = assetCtxs[i];
      
      await this.env.DB_WRITE.prepare(`
        INSERT INTO market_stats (exchange, symbol, funding_rate, ...)
        VALUES (?, ?, ?, ...)
      `).bind('hyperliquid', symbol, ctx.funding, ...).run();
    }
  }
  
  // Nächsten Poll zeitgesteuert planen
  scheduleNextPoll() {
    const now = new Date();
    const currentSeconds = now.getSeconds();
    const targetSeconds = [0, 15, 30, 45];
    
    // Nächsten Target-Zeitpunkt finden
    const nextTarget = targetSeconds.find(t => t > currentSeconds) || 60;
    const msUntilNext = (nextTarget - currentSeconds) * 1000;
    
    setTimeout(() => this.pollAndSave(), msUntilNext);
  }
}
```

**Besonderheiten:**
- **Hyperliquid:** Mapping von universe-Array zu assetCtxs-Array über Index
- **Variational:** Funding Rate Division durch 1000 (API gibt Werte in Promille)
- **Pacifica:** Spezielle Datenstruktur mit nested objects

---

## Datenfluss

### 1. Datenerfassung (15-Sekunden-Snapshots)

```
Exchange API/WebSocket
        │
        ▼
   Tracker Buffer (Memory)
        │
        ▼ (alle 15s)
   market_stats (DB_WRITE)
```

**Tabelle: `market_stats`**
- Rohdaten von allen Exchanges
- Snapshot alle 15 Sekunden
- Retention: ~5 Minuten (dann aggregiert und gelöscht)

**Felder:**
```sql
CREATE TABLE market_stats (
  id INTEGER PRIMARY KEY,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market_id INTEGER,
  index_price TEXT,
  mark_price TEXT,
  open_interest TEXT,
  funding_rate TEXT,
  current_funding_rate TEXT,
  funding_timestamp INTEGER,
  daily_base_token_volume REAL,
  daily_quote_token_volume REAL,
  recorded_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

### 2. Erste Aggregation (1-Minuten-Aggregate)

```
Cron Job (alle 5 Minuten)
        │
        ▼
   Aggregiere 15s → 1m
        │
        ▼
   market_stats_1m (DB_WRITE)
        │
        ▼
   Lösche alte market_stats
```

**Tabelle: `market_stats_1m`**
- 1-Minuten-Aggregate
- Retention: ~1 Stunde
- Verwendet für kurzfristige Analysen und MA-Berechnungen

**Aggregationslogik:**
```sql
INSERT INTO market_stats_1m (
  exchange, symbol, normalized_symbol,
  avg_mark_price, avg_funding_rate,
  min_price, max_price,
  minute_timestamp, sample_count
)
SELECT 
  exchange,
  symbol,
  COALESCE(nt.normalized_symbol, symbol) as normalized_symbol,
  AVG(CAST(mark_price AS REAL)) as avg_mark_price,
  AVG(CAST(funding_rate AS REAL)) as avg_funding_rate,
  MIN(CAST(mark_price AS REAL)) as min_price,
  MAX(CAST(mark_price AS REAL)) as max_price,
  (recorded_at / 60) * 60 as minute_timestamp,
  COUNT(*) as sample_count
FROM market_stats
LEFT JOIN normalized_tokens nt ON nt.symbol = market_stats.symbol
WHERE created_at < strftime('%s', 'now') - 300
GROUP BY exchange, symbol, minute_timestamp
```

### 3. Zweite Aggregation (Stündliche Aggregate)

```
Cron Job (stündlich)
        │
        ▼
   Aggregiere 1m → 1h
        │
        ▼
   market_history (DB_READ)
        │
        ▼
   Lösche alte market_stats_1m
```

**Tabelle: `market_history`**
- Stündliche Aggregate
- Permanente Speicherung
- Verwendet für historische Analysen, Charts, Moving Averages

**Aggregationslogik:**
```sql
INSERT INTO market_history (
  exchange, symbol, normalized_symbol,
  avg_mark_price, avg_funding_rate,
  min_price, max_price,
  volume_base, volume_quote,
  avg_open_interest_usd,
  hour_timestamp, sample_count
)
SELECT 
  exchange,
  symbol,
  normalized_symbol,
  AVG(avg_mark_price) as avg_mark_price,
  AVG(avg_funding_rate) as avg_funding_rate,
  MIN(min_price) as min_price,
  MAX(max_price) as max_price,
  SUM(volume_base) as volume_base,
  SUM(volume_quote) as volume_quote,
  AVG(avg_open_interest_usd) as avg_open_interest_usd,
  (minute_timestamp / 3600) * 3600 as hour_timestamp,
  SUM(sample_count) as sample_count
FROM market_stats_1m
WHERE created_at < strftime('%s', 'now') - 3600
GROUP BY exchange, symbol, hour_timestamp
```

### 4. Synchronisation zu DB_READ

```
Cron Job (alle 5 Minuten)
        │
        ▼
   Kopiere market_history
   DB_WRITE → DB_READ
```

**Zweck:**
- Trennung von Write- und Read-Operationen
- Read-Optimierung für API-Abfragen
- Vermeidung von Lock-Konflikten

---

## Datenspeicherung

### Datenbank-Architektur

**DB_WRITE (Primäre Datenbank)**
- `market_stats` - 15s Snapshots (kurzlebig)
- `market_stats_1m` - 1m Aggregate (kurzlebig)
- `tracker_status` - Tracker-Status
- `funding_ma_cache` - Moving Average Cache

**DB_READ (Read-Only Replica)**
- `market_history` - Stündliche Aggregate (permanent)
- `normalized_tokens` - Token-Normalisierung
- `funding_ma_cache` - MA Cache (kopiert)

### Datenretention

| Tabelle | Intervall | Retention | Zweck |
|---------|-----------|-----------|-------|
| `market_stats` | 15s | ~5 Minuten | Rohdaten-Erfassung |
| `market_stats_1m` | 1m | ~1 Stunde | Kurzfristige Analysen |
| `market_history` | 1h | Permanent | Langzeit-Analysen |
| `funding_ma_cache` | Variabel | Bis Neuberechnung | MA-Performance |

### Speicheroptimierung

**Problem:** Hohe Schreiblast durch 13 Tracker × ~100 Symbole × 4 Snapshots/Minute

**Lösung:**
1. **Batch Inserts:** Alle Symbole eines Snapshots in einer Transaktion
2. **Aggressive Cleanup:** Alte Daten nach Aggregation sofort löschen
3. **Indexierung:** Optimierte Indizes für häufige Queries
4. **Caching:** MA-Cache zur Vermeidung wiederholter Berechnungen

```typescript
// Batch Insert Beispiel
async saveSnapshot() {
  const records = Array.from(this.dataBuffer.values());
  
  // Alle Inserts in einer Transaktion
  const statements = records.map(record => 
    this.env.DB_WRITE.prepare(`INSERT INTO market_stats (...) VALUES (...)`)
      .bind(record.exchange, record.symbol, ...)
  );
  
  await this.env.DB_WRITE.batch(statements);
}
```

---

## Normalisierung

### Symbol-Normalisierung

**Problem:** Verschiedene Exchanges verwenden unterschiedliche Symbol-Formate

**Beispiele:**
- Lighter: `BTC`
- Paradex: `BTC-USD-PERP`
- EdgeX: `BTCUSD`
- HyENA: `hyna:BTC`
- Extended: `BTC-USD`

**Lösung: `normalized_tokens` Tabelle**

```sql
CREATE TABLE normalized_tokens (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  normalized_symbol TEXT NOT NULL,
  base_token TEXT,
  quote_token TEXT,
  exchange TEXT,
  last_seen INTEGER
);
```

**Normalisierungslogik:**

```typescript
function normalizeSymbol(symbol: string): string {
  // Entferne Exchange-spezifische Präfixe
  symbol = symbol.replace(/^(hyna:|flx:)/, '');
  
  // Entferne Suffixe
  symbol = symbol.replace(/(-USD-PERP|-USD|USD)$/, '');
  
  // Spezialfälle
  if (symbol.startsWith('1000')) {
    symbol = symbol.substring(4); // 1000PEPE → PEPE
  }
  if (symbol.startsWith('k') || symbol.startsWith('K')) {
    symbol = symbol.substring(1); // kPEPE → PEPE
  }
  
  return symbol.toUpperCase();
}
```

**Auto-Update via Cron:**
```sql
-- Alle 5 Minuten: Neue Symbole aus market_stats extrahieren
INSERT OR REPLACE INTO normalized_tokens (symbol, normalized_symbol, exchange)
SELECT DISTINCT 
  symbol,
  -- Normalisierungslogik hier
  CASE 
    WHEN symbol LIKE 'hyna:%' THEN SUBSTR(symbol, 6)
    WHEN symbol LIKE '%-USD-PERP' THEN SUBSTR(symbol, 1, INSTR(symbol, '-') - 1)
    ELSE symbol
  END as normalized_symbol,
  exchange
FROM market_stats
WHERE symbol NOT IN (SELECT symbol FROM normalized_tokens);
```

### Funding Rate Normalisierung

**Problem:** Exchanges geben Funding Rates in verschiedenen Formaten

| Exchange | Format | Beispiel | Normalisierung |
|----------|--------|----------|----------------|
| Lighter | Decimal | 0.0001 | Keine |
| Paradex | Decimal | 0.0001 | Keine |
| Hyperliquid | Decimal | 0.0001 | Keine |
| Variational | Promille | 0.1 | ÷ 1000 |
| EdgeX | Percentage | 0.01 | ÷ 100 |

**Implementierung:**

```typescript
// VariationalTracker.ts
const fundingRateDecimal = parseFloat(marketData.funding_rate) / 1000;

// EdgeXTracker.ts
const fundingRateDecimal = parseFloat(marketData.funding_rate) / 100;
```

### Zeitstempel-Normalisierung

**Alle Zeitstempel werden in Unix Seconds (UTC) gespeichert:**

```typescript
const recordedAt = Math.floor(Date.now() / 1000);
```

**Aggregations-Timestamps:**
```typescript
// 1-Minuten-Aggregation: Runde auf Minute
const minuteTimestamp = Math.floor(recordedAt / 60) * 60;

// Stündliche Aggregation: Runde auf Stunde
const hourTimestamp = Math.floor(recordedAt / 3600) * 3600;
```

---

## Inkonsistenzen

### 1. Symbol-Format-Inkonsistenzen

**Problem:** Keine einheitliche Symbol-Konvention

**Beispiele:**
```
Lighter:     BTC, ETH, PEPE
Paradex:     BTC-USD-PERP, ETH-USD-PERP
EdgeX:       BTCUSD, ETHUSD
HyENA:       hyna:BTC, hyna:ETH
Extended:    BTC-USD, ETH-USD
FLX:         flx:BTC, flx:ETH
Hyperliquid: BTC, 1000PEPE, kPEPE
```

**Auswirkung:**
- Erschwert Cross-Exchange-Vergleiche
- Komplexe Symbol-Resolution in API-Endpoints
- Potenzielle Fehler bei Aggregationen

**Aktueller Workaround:**
```typescript
// API Endpoint: Symbol-Variationen durchsuchen
const symbolVariations = [
  symbol,                    // BTC
  `${symbol}USD`,           // BTCUSD
  `${symbol}-USD`,          // BTC-USD
  `${symbol}-USD-PERP`,     // BTC-USD-PERP
  `hyna:${symbol}`,         // hyna:BTC
  `flx:${symbol}`,          // flx:BTC
  `1000${symbol}`,          // 1000PEPE
  `k${symbol}`,             // kPEPE
];
```

### 2. Funding Rate Format-Inkonsistenzen

**Problem:** Verschiedene Dezimal-Formate

| Exchange | API-Wert | Gespeicherter Wert | Konversion |
|----------|----------|-------------------|------------|
| Lighter | 0.0001 | 0.0001 | Keine |
| Variational | 0.1 | 0.0001 | ÷ 1000 |
| EdgeX | 0.01 | 0.0001 | ÷ 100 |

**Risiko:** Vergessene Konversion führt zu 10x oder 1000x Fehlern

### 3. Datenfeld-Inkonsistenzen

**Problem:** Nicht alle Exchanges liefern alle Felder

| Feld | Lighter | Paradex | Hyperliquid | Variational |
|------|---------|---------|-------------|-------------|
| `funding_rate` | ✅ | ✅ | ✅ | ✅ |
| `next_funding_time` | ✅ | ✅ | ❌ | ❌ |
| `funding_interval_hours` | ✅ | ✅ | ❌ | ✅ |
| `open_interest_usd` | ✅ | ✅ | ❌ | ❌ |
| `daily_volume` | ✅ | ✅ | ❌ | ❌ |

**Auswirkung:**
- NULL-Werte in Aggregationen
- Unvollständige Daten für manche Exchanges
- Komplexere Queries mit COALESCE

### 4. Tracker-Implementierungs-Inkonsistenzen

**Problem:** Verschiedene Implementierungsmuster

**WebSocket-Tracker:**
- Manche verwenden Ping/Pong (Lighter)
- Manche verwenden präventives Reconnect (Paradex)
- Manche haben kein Keep-Alive (EdgeX)

**API-Tracker:**
- Manche pollen zeitgesteuert (Hyperliquid)
- Manche pollen mit festem Intervall (Variational)

**Snapshot-Timing:**
- Manche speichern sofort nach Poll (Hyperliquid)
- Manche buffern und speichern periodisch (Lighter)

### 5. Datenbank-Inkonsistenzen

**Problem:** `market_history` existiert nicht in `DB_WRITE`

**Auswirkung:**
- MA-Cache kann nicht aus `DB_WRITE` berechnet werden
- Cron-Job schlägt fehl: `no such table: market_history`
- Bulk-MA-Endpoint verwendet veraltete Cache-Werte

**Aktueller Workaround:**
- Single-MA-Endpoint berechnet live aus `DB_READ.market_history`
- Bulk-MA-Endpoint verwendet Cache aus `DB_WRITE.funding_ma_cache`

---

## Verbesserungsvorschläge

### 1. Einheitliche Tracker-Basisklasse

**Problem:** Code-Duplikation in allen Trackern

**Lösung:** Abstract Base Class

```typescript
abstract class BaseTracker implements DurableObject {
  protected state: DurableObjectState;
  protected env: Env;
  protected dataBuffer: Map<string, any> = new Map();
  protected isRunning = false;
  
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }
  
  // Gemeinsame Methoden
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (path !== '/stop' && !this.isRunning) {
      await this.start();
    }
    
    switch (path) {
      case '/start': return this.handleStart();
      case '/stop': return this.handleStop();
      case '/status': return this.handleStatus();
      default: return new Response('Not found', { status: 404 });
    }
  }
  
  // Abstract methods - von Subklassen implementiert
  abstract start(): Promise<void>;
  abstract stop(): void;
  abstract saveSnapshot(): Promise<void>;
  
  // Gemeinsame Snapshot-Logik
  protected async batchInsert(records: MarketStatsRecord[]) {
    const statements = records.map(r => 
      this.env.DB_WRITE.prepare(`
        INSERT INTO market_stats (exchange, symbol, funding_rate, ...)
        VALUES (?, ?, ?, ...)
      `).bind(r.exchange, r.symbol, r.funding_rate, ...)
    );
    
    await this.env.DB_WRITE.batch(statements);
  }
}

// Verwendung
class LighterTracker extends BaseTracker {
  async start() {
    // Lighter-spezifische WebSocket-Logik
  }
  
  async saveSnapshot() {
    const records = this.prepareRecords();
    await this.batchInsert(records);
  }
}
```

**Vorteile:**
- Reduziert Code-Duplikation um ~40%
- Einheitliches Error-Handling
- Einfachere Wartung

### 2. Einheitliche Symbol-Normalisierung

**Lösung:** Zentrale Normalisierungsfunktion

```typescript
// src/symbolNormalizer.ts
export class SymbolNormalizer {
  private static exchangePatterns: Record<string, RegExp[]> = {
    paradex: [/-USD-PERP$/],
    edgex: [/USD$/],
    hyena: [/^hyna:/],
    flx: [/^flx:/],
    extended: [/-USD$/],
  };
  
  static normalize(symbol: string, exchange: string): string {
    let normalized = symbol;
    
    // Exchange-spezifische Patterns
    const patterns = this.exchangePatterns[exchange] || [];
    for (const pattern of patterns) {
      normalized = normalized.replace(pattern, '');
    }
    
    // Globale Patterns
    if (normalized.startsWith('1000')) {
      normalized = normalized.substring(4);
    }
    if (normalized.match(/^[kK]/)) {
      normalized = normalized.substring(1);
    }
    
    return normalized.toUpperCase();
  }
  
  static denormalize(symbol: string, exchange: string): string {
    // Rückkonvertierung für API-Calls
    switch (exchange) {
      case 'paradex': return `${symbol}-USD-PERP`;
      case 'edgex': return `${symbol}USD`;
      case 'hyena': return `hyna:${symbol}`;
      case 'flx': return `flx:${symbol}`;
      default: return symbol;
    }
  }
}

// Verwendung in Trackern
const normalizedSymbol = SymbolNormalizer.normalize(rawSymbol, 'paradex');
```

### 3. Einheitliche Funding Rate Konversion

**Lösung:** Exchange-spezifische Konverter

```typescript
// src/fundingRateConverter.ts
export class FundingRateConverter {
  private static conversionFactors: Record<string, number> = {
    lighter: 1,
    paradex: 1,
    hyperliquid: 1,
    variational: 1000,  // API gibt Promille
    edgex: 100,         // API gibt Prozent
    // ... weitere Exchanges
  };
  
  static toDecimal(value: string | number, exchange: string): number {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    const factor = this.conversionFactors[exchange] || 1;
    return numValue / factor;
  }
  
  static toAnnual(decimalRate: number, fundingIntervalHours: number): number {
    const paymentsPerYear = (365 * 24) / fundingIntervalHours;
    return decimalRate * paymentsPerYear;
  }
}

// Verwendung
const fundingRateDecimal = FundingRateConverter.toDecimal(
  apiData.funding_rate,
  'variational'
);
const fundingRateAnnual = FundingRateConverter.toAnnual(
  fundingRateDecimal,
  8 // 8-Stunden-Intervall
);
```

### 4. Verbesserte Datenbank-Architektur

**Problem:** `market_history` fehlt in `DB_WRITE`

**Lösung A: Repliziere market_history zu DB_WRITE**

```sql
-- Cron Job: Kopiere market_history von DB_READ zu DB_WRITE
-- Ermöglicht MA-Cache-Berechnung in DB_WRITE
```

**Lösung B: Vereinfache zu einer Datenbank**

```
Vorteile:
- Keine Synchronisation nötig
- Konsistente Daten
- Einfachere Architektur

Nachteile:
- Potenzielle Lock-Konflikte
- Schlechtere Read-Performance
```

**Empfehlung:** Lösung A - Behalte Trennung, aber repliziere `market_history`

### 5. Monitoring und Alerting

**Lösung:** Strukturiertes Logging und Health Checks

```typescript
// src/monitoring.ts
export class TrackerMonitoring {
  static async checkHealth(env: Env): Promise<HealthReport> {
    const trackers = [
      'lighter', 'paradex', 'hyperliquid', 'variational',
      // ... alle Tracker
    ];
    
    const health: HealthReport = {
      timestamp: Date.now(),
      trackers: {},
      issues: [],
    };
    
    for (const tracker of trackers) {
      const status = await env.DB_WRITE.prepare(`
        SELECT status, last_message_at, error_message
        FROM tracker_status
        WHERE exchange = ?
      `).bind(tracker).first();
      
      const isHealthy = 
        status?.status === 'running' &&
        Date.now() - (status.last_message_at || 0) < 60000; // < 1 Minute
      
      health.trackers[tracker] = {
        status: status?.status || 'unknown',
        healthy: isHealthy,
        lastSeen: status?.last_message_at,
        error: status?.error_message,
      };
      
      if (!isHealthy) {
        health.issues.push({
          tracker,
          severity: 'warning',
          message: `Tracker ${tracker} unhealthy`,
        });
      }
    }
    
    return health;
  }
  
  static async logMetric(
    env: Env,
    metric: string,
    value: number,
    tags: Record<string, string>
  ) {
    // Logging zu externem Service (z.B. Cloudflare Analytics)
    console.log(JSON.stringify({
      type: 'metric',
      metric,
      value,
      tags,
      timestamp: Date.now(),
    }));
  }
}

// Verwendung im Cron
await TrackerMonitoring.checkHealth(env);
await TrackerMonitoring.logMetric(env, 'aggregation.duration', duration, {
  type: '1m_to_1h',
});
```

### 6. Verbesserte Error Recovery

**Problem:** Tracker können in Fehlerzustand hängen bleiben

**Lösung:** Automatisches Recovery

```typescript
abstract class BaseTracker {
  private errorCount = 0;
  private readonly MAX_ERRORS = 5;
  
  protected async handleError(error: Error, context: string) {
    this.errorCount++;
    
    console.error(`[${this.constructor.name}] Error in ${context}:`, error);
    
    // Update Status
    await this.updateTrackerStatus('error', error.message);
    
    // Auto-Recovery nach mehreren Fehlern
    if (this.errorCount >= this.MAX_ERRORS) {
      console.log(`[${this.constructor.name}] Max errors reached, attempting recovery`);
      
      await this.stop();
      await new Promise(resolve => setTimeout(resolve, 5000));
      await this.start();
      
      this.errorCount = 0;
    }
  }
  
  protected resetErrorCount() {
    this.errorCount = 0;
  }
}
```

### 7. Konfigurationsmanagement

**Problem:** Hardcodierte Konfiguration in jedem Tracker

**Lösung:** Zentrale Konfiguration

```typescript
// src/config.ts
export const TRACKER_CONFIG = {
  lighter: {
    type: 'websocket',
    url: 'wss://api.lighter.xyz/v1/ws',
    pingInterval: 30000,
    reconnectDelay: 5000,
    fundingRateFactor: 1,
  },
  paradex: {
    type: 'websocket',
    url: 'wss://ws.api.prod.paradex.trade/v1',
    reconnectInterval: 45000,
    fundingRateFactor: 1,
  },
  hyperliquid: {
    type: 'api',
    url: 'https://api.hyperliquid.xyz/info',
    pollInterval: 15000,
    fundingRateFactor: 1,
  },
  variational: {
    type: 'api',
    url: 'https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats',
    pollInterval: 15000,
    fundingRateFactor: 1000, // API gibt Promille
  },
  // ... weitere Exchanges
};

// Verwendung
const config = TRACKER_CONFIG[this.exchange];
this.ws = new WebSocket(config.url);
```

### 8. Testing-Infrastruktur

**Lösung:** Unit Tests und Integration Tests

```typescript
// tests/tracker.test.ts
describe('BaseTracker', () => {
  it('should normalize symbols correctly', () => {
    expect(SymbolNormalizer.normalize('BTC-USD-PERP', 'paradex')).toBe('BTC');
    expect(SymbolNormalizer.normalize('hyna:ETH', 'hyena')).toBe('ETH');
    expect(SymbolNormalizer.normalize('1000PEPE', 'hyperliquid')).toBe('PEPE');
  });
  
  it('should convert funding rates correctly', () => {
    expect(FundingRateConverter.toDecimal(0.1, 'variational')).toBe(0.0001);
    expect(FundingRateConverter.toDecimal(0.01, 'edgex')).toBe(0.0001);
  });
});

// tests/integration/aggregation.test.ts
describe('Aggregation Pipeline', () => {
  it('should aggregate 15s to 1m correctly', async () => {
    // Insert test data
    await insertTestSnapshots();
    
    // Run aggregation
    await aggregateTo1Minute(env);
    
    // Verify results
    const result = await env.DB_WRITE.prepare(`
      SELECT * FROM market_stats_1m WHERE symbol = 'BTC'
    `).first();
    
    expect(result.sample_count).toBe(4); // 4 × 15s snapshots
    expect(result.avg_funding_rate).toBeCloseTo(0.0001, 6);
  });
});
```

---

## Zusammenfassung

### Aktuelle Stärken
✅ Skalierbare Architektur mit Durable Objects  
✅ Effiziente Aggregations-Pipeline  
✅ Trennung von Write/Read-Datenbanken  
✅ Automatische Symbol-Normalisierung  
✅ Robuste WebSocket-Handling  

### Hauptprobleme
❌ Code-Duplikation in Trackern  
❌ Inkonsistente Symbol-Formate  
❌ Manuelle Funding Rate Konversionen  
❌ Fehlende `market_history` in DB_WRITE  
❌ Unvollständiges Error-Handling  

### Prioritäre Verbesserungen
1. **Einheitliche Tracker-Basisklasse** (Reduziert Duplikation)
2. **Zentrale Symbol-Normalisierung** (Verhindert Fehler)
3. **Zentrale Funding Rate Konversion** (Verhindert 10x/1000x Fehler)
4. **Repliziere market_history zu DB_WRITE** (Ermöglicht MA-Cache)
5. **Monitoring und Alerting** (Verbessert Zuverlässigkeit)

### Geschätzter Aufwand
- Basisklasse: 2-3 Tage
- Normalisierung: 1 Tag
- DB-Replikation: 1 Tag
- Monitoring: 2 Tage
- Testing: 2-3 Tage

**Total: ~2 Wochen für vollständige Refaktorierung**
