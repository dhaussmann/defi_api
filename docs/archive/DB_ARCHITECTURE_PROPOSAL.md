# Multi-Database Architecture Proposal

## Problem

Mit ~1500 Markets (nach Variational Integration) und 15-Sekunden-Snapshots haben wir:
- **market_stats**: ~360.000 Inserts/Tag (1500 markets × 4/min × 60 min × 24h)
- **normalized_tokens**: 1500 UPSERTs alle 5 Minuten
- **Aggregation Queries**: Alle 5 Minuten über alte Daten
- **API Queries**: Häufige Abfragen auf normalized_tokens

→ **D1 DB Overload**: "Too many requests queued"

## Lösung: Multi-Database Sharding

### Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                     WRITE DATABASE (DB_WRITE)               │
│  - market_stats (15s snapshots, hot data)                   │
│  - tracker_status                                            │
│  - Nur Writes von Trackern                                  │
│  - TTL: 1 Stunde (dann aggregiert & gelöscht)              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ↓ (Aggregation alle 5 min)
┌─────────────────────────────────────────────────────────────┐
│                   AGGREGATION DATABASE (DB_AGG)             │
│  - market_stats_1m (1-minute aggregates)                    │
│  - market_stats_1h (hourly aggregates)                      │
│  - Nur Aggregation Queries                                  │
│  - TTL: 1m data → 24h, 1h data → 30 Tage                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      READ DATABASE (DB_READ)                │
│  - normalized_tokens (aktuelle Market-Daten)                │
│  - Nur API Reads                                            │
│  - Update alle 5 Minuten von market_stats                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    HISTORY DATABASE (DB_HISTORY)            │
│  - funding_rate_history (historische Funding Rates)         │
│  - market_history (historische Market Daten)                │
│  - funding_ma_cache (Moving Averages)                       │
│  - Nur für historische Analysen                             │
└─────────────────────────────────────────────────────────────┘
```

## Vorteile

### 1. **Last-Verteilung**
- **DB_WRITE**: Nur Tracker-Writes (360k/Tag)
- **DB_READ**: Nur API-Reads (häufig, aber cached)
- **DB_AGG**: Nur Aggregation (alle 5 min)
- **DB_HISTORY**: Selten genutzt

### 2. **Performance**
- API Queries auf DB_READ ohne Konkurrenz von Writes
- Aggregation läuft isoliert ohne API-Traffic zu blockieren
- Tracker schreiben ohne Read-Queries zu stören

### 3. **Skalierbarkeit**
- Jede DB kann unabhängig skaliert werden
- DB_WRITE kann klein bleiben (nur 1h Daten)
- DB_READ optimiert für Reads (Indizes)
- DB_HISTORY kann groß werden ohne Performance-Impact

### 4. **Wartbarkeit**
- Klare Trennung der Verantwortlichkeiten
- Einfacheres Debugging
- Backup-Strategien pro DB-Typ

## Implementation

### Phase 1: Setup (30 min)
```bash
# Neue D1 Datenbanken erstellen
wrangler d1 create defiapi-db-write
wrangler d1 create defiapi-db-agg
wrangler d1 create defiapi-db-read
wrangler d1 create defiapi-db-history

# wrangler.toml updaten
[[d1_databases]]
binding = "DB_WRITE"
database_name = "defiapi-db-write"
database_id = "xxx"

[[d1_databases]]
binding = "DB_AGG"
database_name = "defiapi-db-agg"
database_id = "xxx"

[[d1_databases]]
binding = "DB_READ"
database_name = "defiapi-db-read"
database_id = "xxx"

[[d1_databases]]
binding = "DB_HISTORY"
database_name = "defiapi-db-history"
database_id = "xxx"
```

### Phase 2: Schema Migration (1h)
```sql
-- DB_WRITE: Nur hot data
CREATE TABLE market_stats (...);
CREATE TABLE tracker_status (...);

-- DB_AGG: Aggregierte Daten
CREATE TABLE market_stats_1m (...);
CREATE TABLE market_stats_1h (...);

-- DB_READ: API-optimiert
CREATE TABLE normalized_tokens (...);
CREATE INDEX idx_exchange ON normalized_tokens(exchange);
CREATE INDEX idx_symbol ON normalized_tokens(symbol);

-- DB_HISTORY: Historische Daten
CREATE TABLE funding_rate_history (...);
CREATE TABLE market_history (...);
CREATE TABLE funding_ma_cache (...);
```

### Phase 3: Code Anpassung (2h)
```typescript
// types.ts
export interface Env {
  DB_WRITE: D1Database;    // Tracker writes
  DB_AGG: D1Database;      // Aggregation
  DB_READ: D1Database;     // API reads
  DB_HISTORY: D1Database;  // Historical data
  // ... rest
}

// Tracker: Nur DB_WRITE
await this.env.DB_WRITE.prepare(`INSERT INTO market_stats ...`);

// API: Nur DB_READ
const result = await env.DB_READ.prepare(`SELECT * FROM normalized_tokens ...`);

// Aggregation: DB_WRITE → DB_AGG
const source = await env.DB_WRITE.prepare(`SELECT * FROM market_stats ...`);
await env.DB_AGG.prepare(`INSERT INTO market_stats_1m ...`);

// History: DB_HISTORY
await env.DB_HISTORY.prepare(`INSERT INTO funding_rate_history ...`);
```

### Phase 4: Deployment (30 min)
1. Deploy mit neuen DB-Bindings
2. Tracker neu starten
3. Monitoring für 1 Stunde
4. Alte DB (DB) als Backup behalten

## Alternative: Einfachere Lösung

Falls Multi-DB zu komplex ist, können wir auch:

### Option A: Nur 2 DBs (Write + Read)
```
DB_WRITE: market_stats, tracker_status, aggregates
DB_READ:  normalized_tokens (nur API queries)
```
**Vorteil**: Einfacher, 80% der Last-Reduktion
**Nachteil**: Aggregation konkurriert noch mit Writes

### Option B: Aggressiveres Caching
```typescript
// Cache TTL erhöhen
const MARKETS_CACHE_TTL = 60000; // 60 Sekunden statt 30

// Per-Exchange Cache
const exchangeCaches = new Map<string, CacheEntry>();

// Stale-While-Revalidate Pattern
if (cache.age > TTL && cache.age < TTL * 2) {
  // Return stale data immediately
  // Revalidate in background
}
```

### Option C: Read Replicas (wenn D1 unterstützt)
```
Primary DB: Writes
Replica 1: API Reads
Replica 2: Aggregation Reads
```

## Empfehlung

**Start mit Option A (2 DBs)**:
1. **DB_WRITE**: Alle Writes (market_stats, aggregates, tracker_status)
2. **DB_READ**: Nur normalized_tokens für API

**Vorteile**:
- 80% der Performance-Verbesserung
- Einfach zu implementieren (2-3h)
- Kann später zu 4-DB-Architektur erweitert werden
- Geringes Risiko

**Wenn das nicht reicht → Full 4-DB Architecture**

## Kosten

D1 Pricing (Stand 2024):
- Erste 5 GB Storage: Kostenlos
- Erste 5M Reads/Tag: Kostenlos
- Erste 100k Writes/Tag: Kostenlos

Mit 4 DBs:
- Writes: ~360k/Tag (über Limit, aber verteilt)
- Reads: ~2M/Tag (unter Limit)
- Storage: ~2 GB total (unter Limit)

**Geschätzte Mehrkosten**: $5-10/Monat

## Nächste Schritte

1. **Entscheidung**: 2-DB oder 4-DB Architektur?
2. **Backup**: Aktuellen DB-Stand sichern
3. **Implementation**: Neue DBs erstellen + Code anpassen
4. **Testing**: Lokal mit wrangler dev testen
5. **Deployment**: Schrittweise Migration
6. **Monitoring**: Performance über 24h beobachten

## Fragen

- Welche Option bevorzugst du? (2-DB oder 4-DB)
- Soll ich mit der Implementation starten?
- Gibt es spezifische Performance-Anforderungen?
