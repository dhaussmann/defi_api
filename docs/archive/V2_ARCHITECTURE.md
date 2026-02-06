# V2 Architecture - Lighter Funding Data Collection

## Übersicht

Die V2 Architektur ist eine vereinfachte, skalierbare Alternative zur aktuellen WebSocket-basierten Datensammlung. Sie fokussiert sich zunächst auf Lighter und wird später auf andere Exchanges erweitert.

## Hauptunterschiede zu V1

| Aspekt | V1 (Aktuell) | V2 (Neu) |
|--------|--------------|----------|
| **Datensammlung** | WebSocket (Echtzeit) | REST API (stündlich) |
| **Komplexität** | Hoch (Durable Objects, Reconnects) | Niedrig (Cron Jobs) |
| **Granularität** | ~15 Sekunden | 1 Stunde |
| **Tabellen** | `market_stats`, `market_history` | `lighter_funding_v2` |
| **Aggregation** | Mehrfach (1m → 1h) | Direkt (1h) |
| **Maintenance** | Komplex | Einfach |

## Datenstruktur

### Tabelle: `lighter_funding_v2`

```sql
CREATE TABLE lighter_funding_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Market Identification
  market_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  
  -- Timestamp (hourly)
  timestamp INTEGER NOT NULL,
  
  -- Funding Rate Data
  rate REAL NOT NULL,                    -- Raw rate (0.0012 = 0.12% per hour)
  rate_hourly REAL NOT NULL,             -- Same as rate
  rate_annual REAL NOT NULL,             -- APR: rate × 24 × 365
  
  -- Direction
  direction TEXT NOT NULL,               -- 'long' or 'short'
  
  -- Cumulative Value
  cumulative_value REAL,
  
  -- Metadata
  collected_at INTEGER NOT NULL,
  source TEXT DEFAULT 'api',             -- 'api' or 'import'
  
  UNIQUE(market_id, timestamp)
);
```

### Tabelle: `lighter_markets_v2`

```sql
CREATE TABLE lighter_markets_v2 (
  market_id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  last_updated INTEGER NOT NULL
);
```

### Tabelle: `lighter_tracker_status_v2`

```sql
CREATE TABLE lighter_tracker_status_v2 (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_run INTEGER,
  last_success INTEGER,
  last_error TEXT,
  total_runs INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle'
);
```

## Komponenten

### 1. Schema Migrations

**Dateien:**
- `migrations/write/v2_0001_lighter_funding.sql`
- `migrations/read/v2_0001_lighter_funding.sql`

**Inhalt:**
- Tabellendefinitionen
- Indexes für Performance
- Views für einfache Queries
- Constraints für Datenintegrität

### 2. Import Script

**Datei:** `scripts/v2_import_lighter_history.sh`

**Funktion:**
- Importiert historische Daten (30 Tage)
- Holt Daten von Lighter REST API
- Berechnet APR direkt beim Import
- Batch-Processing für Performance

**Usage:**
```bash
# Import 30 Tage (Standard)
./scripts/v2_import_lighter_history.sh

# Import 7 Tage
./scripts/v2_import_lighter_history.sh 7

# Import in DB_READ
./scripts/v2_import_lighter_history.sh 30 defiapi-db-read
```

### 3. Cron Tracker

**Datei:** `src/v2_LighterTrackerCron.ts`

**Funktion:**
- Läuft stündlich (zur vollen Stunde)
- Holt Funding Rates von Lighter API
- Speichert in `lighter_funding_v2`
- Berechnet APR automatisch
- Synct zu DB_READ

**Integration in `index.ts`:**
```typescript
import { collectLighterFundingV2, syncLighterFundingV2ToRead } from './v2_LighterTrackerCron';

// In scheduled() function
if (cron === '0 * * * *') {  // Every hour at :00
  await collectLighterFundingV2(env);
  await syncLighterFundingV2ToRead(env);
}
```

## Workflow

### Initialer Setup

1. **Migrations ausführen:**
```bash
# DB_WRITE
npx wrangler d1 execute defiapi-db-write --remote --file=migrations/write/v2_0001_lighter_funding.sql

# DB_READ
npx wrangler d1 execute defiapi-db-read --remote --file=migrations/read/v2_0001_lighter_funding.sql
```

2. **Historische Daten importieren:**
```bash
./scripts/v2_import_lighter_history.sh 30
```

3. **Cron Job aktivieren:**
- Code in `index.ts` integrieren
- Worker deployen

### Laufender Betrieb

**Stündlich (automatisch):**
1. Cron Job triggert um :00
2. `collectLighterFundingV2()` wird aufgerufen
3. Aktive Markets werden geholt
4. Funding Rates für letzte 2 Stunden werden geholt
5. Daten werden in DB_WRITE gespeichert
6. APR wird berechnet und gespeichert
7. Daten werden zu DB_READ synct

**Monitoring:**
```sql
-- Tracker Status prüfen
SELECT * FROM lighter_tracker_status_v2;

-- Letzte Daten prüfen
SELECT * FROM lighter_funding_latest_v2 LIMIT 10;

-- Tägliche Statistiken
SELECT * FROM lighter_funding_daily_stats_v2 
WHERE date >= date('now', '-7 days')
ORDER BY date DESC, avg_apr DESC;
```

## APR Berechnung

**Formel:**
```typescript
const rate = parseFloat(funding.rate);  // z.B. 0.0012
const rateAnnual = rate * 24 * 365;     // 10.512
```

**Beispiel:**
- API liefert: `rate: "0.0012"` (0.12% per hour)
- Gespeichert als: `rate: 0.0012`, `rate_annual: 10.512`
- Interpretation: 0.12% pro Stunde = 10.51% APR

## Vorteile

1. **Einfachheit:** Kein WebSocket-Management, keine Durable Objects
2. **Zuverlässigkeit:** REST API ist stabiler als WebSocket
3. **Wartbarkeit:** Klarer Code, einfaches Debugging
4. **Skalierbarkeit:** Leicht auf andere Exchanges erweiterbar
5. **Kosten:** Weniger Compute-Zeit als WebSocket
6. **Datenqualität:** Direkt von offizieller API, keine Aggregation nötig

## Nachteile

1. **Granularität:** Nur stündliche Daten (vs. 15s bei V1)
2. **Latenz:** Bis zu 1 Stunde Verzögerung
3. **Echtzeit:** Keine Live-Updates möglich

## Migration von V1 zu V2

**Phase 1: Parallel-Betrieb (aktuell)**
- V1 läuft weiter
- V2 sammelt parallel Daten
- Beide Systeme koexistieren

**Phase 2: Vergleich & Validierung**
- Datenqualität vergleichen
- Performance messen
- API Endpoints testen

**Phase 3: Umstellung**
- API Endpoints auf V2 umstellen
- V1 WebSocket deaktivieren
- V1 Tabellen als Backup behalten

**Phase 4: Cleanup**
- V1 Code entfernen
- V1 Tabellen löschen (nach Backup)
- Dokumentation aktualisieren

## Erweiterung auf andere Exchanges

Die V2 Architektur ist so designed, dass sie leicht auf andere Exchanges erweitert werden kann:

```typescript
// Beispiel: Hyperliquid V2
export async function collectHyperliquidFundingV2(env: Env): Promise<void> {
  // Ähnliche Struktur wie Lighter
  // Andere API Endpoints
  // Gleiche Tabellenstruktur
}
```

**Tabellen:**
- `hyperliquid_funding_v2`
- `paradex_funding_v2`
- `variational_funding_v2`
- etc.

## Queries & API Integration

### Beispiel-Queries

```sql
-- Aktuelle Funding Rates
SELECT symbol, rate_annual, direction, datetime(timestamp, 'unixepoch') as time
FROM lighter_funding_v2
WHERE timestamp = (SELECT MAX(timestamp) FROM lighter_funding_v2)
ORDER BY rate_annual DESC;

-- 7-Tage Durchschnitt
SELECT 
  symbol,
  AVG(rate_annual) as avg_apr,
  MIN(rate_annual) as min_apr,
  MAX(rate_annual) as max_apr
FROM lighter_funding_v2
WHERE timestamp >= strftime('%s', 'now', '-7 days')
GROUP BY symbol
ORDER BY avg_apr DESC;

-- Zeitreihe für Chart
SELECT 
  timestamp,
  rate_annual,
  direction
FROM lighter_funding_v2
WHERE symbol = 'BTC'
  AND timestamp >= strftime('%s', 'now', '-30 days')
ORDER BY timestamp ASC;
```

### API Endpoint (Beispiel)

```typescript
async function getLighterFundingV2(env: Env, url: URL): Promise<Response> {
  const symbol = url.searchParams.get('symbol');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let query = `SELECT * FROM lighter_funding_v2 WHERE 1=1`;
  const params: any[] = [];

  if (symbol) {
    query += ` AND symbol = ?`;
    params.push(symbol);
  }

  if (from) {
    query += ` AND timestamp >= ?`;
    params.push(parseInt(from));
  }

  if (to) {
    query += ` AND timestamp <= ?`;
    params.push(parseInt(to));
  }

  query += ` ORDER BY timestamp DESC LIMIT 1000`;

  const result = await env.DB_READ.prepare(query).bind(...params).all();

  return Response.json({
    success: true,
    data: result.results
  });
}
```

## Monitoring & Alerts

**Wichtige Metriken:**
- Letzte erfolgreiche Collection
- Anzahl Records pro Stunde
- Fehlerrate
- API Response Times

**Alerts:**
```sql
-- Keine Daten in letzter Stunde
SELECT CASE 
  WHEN MAX(timestamp) < strftime('%s', 'now', '-2 hours') 
  THEN 'ALERT: No data in last 2 hours'
  ELSE 'OK'
END as status
FROM lighter_funding_v2;

-- Tracker Fehler
SELECT * FROM lighter_tracker_status_v2 
WHERE status = 'error' OR last_error IS NOT NULL;
```

## Zusammenfassung

Die V2 Architektur bietet eine **einfache, zuverlässige und skalierbare** Alternative zur aktuellen WebSocket-basierten Lösung. Sie ist perfekt für:

- ✅ Historische Analysen
- ✅ Tägliche/stündliche Statistiken
- ✅ Moving Averages
- ✅ Arbitrage Detection
- ✅ Charts und Visualisierungen

Die stündliche Granularität ist für die meisten Use Cases ausreichend und bietet einen guten Trade-off zwischen Datenqualität und Komplexität.
