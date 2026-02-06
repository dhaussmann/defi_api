# V2 Setup Guide - Lighter Funding Data Collection

## Schnellstart

Die V2 Architektur ist jetzt bereit für den Einsatz. Folge diesen Schritten:

### 1. Migrations ausführen ✅

**Status:** Bereits durchgeführt!

```bash
# DB_WRITE
npx wrangler d1 execute defiapi-db-write --remote --file=migrations/write/v2_0001_lighter_funding.sql

# DB_READ
npx wrangler d1 execute defiapi-db-read --remote --file=migrations/read/v2_0001_lighter_funding.sql
```

### 2. Historische Daten importieren

**30 Tage Lighter Funding History:**

```bash
# Import in DB_WRITE
./scripts/v2_import_lighter_history.sh 30 defiapi-db-write

# Import in DB_READ
./scripts/v2_import_lighter_history.sh 30 defiapi-db-read
```

**Erwartete Dauer:** ~5-10 Minuten (129 Markets × 720 Stunden = ~93k Records)

**Alternative:** Falls Timeouts auftreten, in kleineren Batches:

```bash
# 7 Tage Batches
for i in 0 7 14 21; do
  echo "Importing days $i to $((i+7))..."
  ./scripts/v2_import_lighter_history.sh 7 defiapi-db-write
  sleep 5
done
```

### 3. Worker deployen

**Code-Integration ist bereits erfolgt!**

Die V2 Cron Jobs sind in `src/index.ts` integriert:

```typescript
// Zeile 19: Import
import { collectLighterFundingV2, syncLighterFundingV2ToRead } from './v2_LighterTrackerCron';

// Zeile 75-80: Hourly Cron
if (cronType === '0 * * * *') {
  // ... existing code ...
  
  // V2: Collect Lighter funding data (hourly)
  await collectLighterFundingV2(env);
  await syncLighterFundingV2ToRead(env);
}
```

**Deployen:**

```bash
npm run deploy
```

### 4. Verifikation

**Nach dem Import:**

```bash
# Anzahl Records prüfen
npx wrangler d1 execute defiapi-db-write --remote --command="SELECT COUNT(*) as total FROM lighter_funding_v2"

# Anzahl Markets prüfen
npx wrangler d1 execute defiapi-db-write --remote --command="SELECT COUNT(DISTINCT symbol) as markets FROM lighter_funding_v2"

# Zeitraum prüfen
npx wrangler d1 execute defiapi-db-write --remote --command="SELECT MIN(datetime(timestamp, 'unixepoch')) as earliest, MAX(datetime(timestamp, 'unixepoch')) as latest FROM lighter_funding_v2"

# Beispiel-Daten anzeigen
npx wrangler d1 execute defiapi-db-write --remote --command="SELECT symbol, rate_annual, direction, datetime(timestamp, 'unixepoch') as time FROM lighter_funding_v2 WHERE symbol = 'BTC' ORDER BY timestamp DESC LIMIT 10"
```

**Nach dem ersten Cron Run (zur vollen Stunde):**

```bash
# Tracker Status prüfen
npx wrangler d1 execute defiapi-db-write --remote --command="SELECT * FROM lighter_tracker_status_v2"

# Neueste Daten prüfen
npx wrangler d1 execute defiapi-db-read --remote --command="SELECT * FROM lighter_funding_latest_v2 LIMIT 10"
```

## Dateien Übersicht

### Migrations
- ✅ `migrations/write/v2_0001_lighter_funding.sql` - Schema für DB_WRITE
- ✅ `migrations/read/v2_0001_lighter_funding.sql` - Schema für DB_READ

### Scripts
- ✅ `scripts/v2_import_lighter_history.sh` - Import historischer Daten

### Source Code
- ✅ `src/v2_LighterTrackerCron.ts` - Hourly Cron Tracker
- ✅ `src/index.ts` - Integration in Worker (Zeile 19, 75-80)

### Dokumentation
- ✅ `docs/V2_ARCHITECTURE.md` - Vollständige Architektur-Dokumentation
- ✅ `docs/V2_SETUP_GUIDE.md` - Diese Anleitung

## Tabellen-Schema

### lighter_funding_v2

```sql
CREATE TABLE lighter_funding_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  rate REAL NOT NULL,
  rate_hourly REAL NOT NULL,
  rate_annual REAL NOT NULL,
  direction TEXT NOT NULL,
  cumulative_value REAL,
  collected_at INTEGER NOT NULL,
  source TEXT DEFAULT 'api',
  UNIQUE(market_id, timestamp)
);
```

### lighter_markets_v2

```sql
CREATE TABLE lighter_markets_v2 (
  market_id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  last_updated INTEGER NOT NULL
);
```

### lighter_tracker_status_v2

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

## Cron Schedule

**Hourly Collection:** `0 * * * *` (jede volle Stunde)

**Was passiert:**
1. Fetch active markets von Lighter API
2. Update market metadata
3. Fetch funding rates (letzte 2 Stunden)
4. Calculate APR: `rate × 24 × 365`
5. Store in `lighter_funding_v2` (DB_WRITE)
6. Sync to DB_READ
7. Update tracker status

## Monitoring

### Logs anzeigen

```bash
# Worker Logs (Live)
npx wrangler tail

# Nur V2 Logs
npx wrangler tail | grep "V2 Lighter"
```

### Tracker Status

```sql
-- Status prüfen
SELECT 
  status,
  datetime(last_run, 'unixepoch') as last_run,
  datetime(last_success, 'unixepoch') as last_success,
  last_error,
  total_runs,
  total_records
FROM lighter_tracker_status_v2;
```

### Daten-Qualität

```sql
-- Letzte 24 Stunden Coverage
SELECT 
  COUNT(DISTINCT symbol) as markets,
  COUNT(*) as records,
  MIN(datetime(timestamp, 'unixepoch')) as earliest,
  MAX(datetime(timestamp, 'unixepoch')) as latest
FROM lighter_funding_v2
WHERE timestamp >= strftime('%s', 'now', '-24 hours');

-- Fehlende Stunden (Gaps)
WITH RECURSIVE hours AS (
  SELECT strftime('%s', 'now', '-24 hours') as ts
  UNION ALL
  SELECT ts + 3600 FROM hours WHERE ts < strftime('%s', 'now')
)
SELECT 
  datetime(h.ts, 'unixepoch') as missing_hour
FROM hours h
LEFT JOIN lighter_funding_v2 lf ON lf.timestamp = h.ts AND lf.symbol = 'BTC'
WHERE lf.timestamp IS NULL;
```

## Troubleshooting

### Problem: Import schlägt fehl mit Timeout

**Lösung:** Kleinere Batches verwenden

```bash
# Statt 30 Tage auf einmal
./scripts/v2_import_lighter_history.sh 7 defiapi-db-write
```

### Problem: Cron Job läuft nicht

**Prüfen:**
1. Worker deployed? `npm run deploy`
2. Cron Schedule aktiv? Check wrangler.toml
3. Logs prüfen: `npx wrangler tail`

### Problem: Keine Daten in DB_READ

**Lösung:** Sync manuell ausführen

```bash
# In Worker Console oder via API
curl "https://your-worker.workers.dev/api/admin/sync-v2-lighter"
```

### Problem: APR Werte scheinen falsch

**Prüfen:**
```sql
-- Beispiel-Berechnung für BTC
SELECT 
  symbol,
  rate,
  rate_annual,
  rate * 24 * 365 as calculated_apr,
  direction,
  datetime(timestamp, 'unixepoch') as time
FROM lighter_funding_v2
WHERE symbol = 'BTC'
ORDER BY timestamp DESC
LIMIT 5;
```

**Erwartung:** `rate_annual` sollte gleich `rate × 24 × 365` sein

## Nächste Schritte

### Phase 1: Testing (1-2 Wochen)
- ✅ V2 läuft parallel zu V1
- ✅ Datenqualität vergleichen
- ✅ Performance messen
- ✅ Bugs fixen

### Phase 2: API Integration
- [ ] Neuen Endpoint `/api/v2/lighter/funding` erstellen
- [ ] Frontend auf V2 umstellen
- [ ] A/B Testing

### Phase 3: Expansion
- [ ] Hyperliquid V2 Tracker
- [ ] Paradex V2 Tracker
- [ ] Andere Exchanges

### Phase 4: Migration
- [ ] V1 WebSocket deaktivieren
- [ ] V1 Tabellen als Backup behalten
- [ ] Dokumentation aktualisieren

## Beispiel-Queries

### Aktuelle Funding Rates

```sql
SELECT 
  symbol,
  rate_annual,
  direction,
  datetime(timestamp, 'unixepoch') as time
FROM lighter_funding_latest_v2
ORDER BY rate_annual DESC
LIMIT 20;
```

### 7-Tage Moving Average

```sql
SELECT 
  symbol,
  AVG(rate_annual) as avg_apr_7d,
  MIN(rate_annual) as min_apr,
  MAX(rate_annual) as max_apr,
  COUNT(*) as sample_count
FROM lighter_funding_v2
WHERE timestamp >= strftime('%s', 'now', '-7 days')
GROUP BY symbol
ORDER BY avg_apr_7d DESC;
```

### Zeitreihe für Chart (BTC, 30 Tage)

```sql
SELECT 
  timestamp,
  rate_annual,
  direction,
  datetime(timestamp, 'unixepoch') as time_iso
FROM lighter_funding_v2
WHERE symbol = 'BTC'
  AND timestamp >= strftime('%s', 'now', '-30 days')
ORDER BY timestamp ASC;
```

### Tägliche Statistiken

```sql
SELECT * FROM lighter_funding_daily_stats_v2
WHERE date >= date('now', '-7 days')
ORDER BY date DESC, avg_apr DESC;
```

## Support

Bei Fragen oder Problemen:
1. Logs prüfen: `npx wrangler tail`
2. Tracker Status prüfen: `SELECT * FROM lighter_tracker_status_v2`
3. Dokumentation lesen: `docs/V2_ARCHITECTURE.md`

## Checkliste

- [x] Migrations ausgeführt (DB_WRITE & DB_READ)
- [ ] Historische Daten importiert (30 Tage)
- [ ] Worker deployed mit V2 Integration
- [ ] Erster Cron Run erfolgreich
- [ ] Daten in DB_READ verfügbar
- [ ] Monitoring eingerichtet
- [ ] API Endpoint getestet

**Status:** Ready for Import & Deploy! 🚀
