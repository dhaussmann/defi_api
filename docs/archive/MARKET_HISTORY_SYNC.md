# Market History Sync - Implementierung

## Übersicht

Dieses Dokument beschreibt die Implementierung der `market_history` Replikation von `DB_WRITE` zu `DB_READ`, um das Problem zu lösen, dass Moving Average (MA) Berechnungen fehlschlugen.

## Problem

**Ursprüngliche Situation:**
- `market_history` Tabelle existierte nur in `DB_READ`
- `aggregateTo1Hour()` versuchte in `DB_WRITE.market_history` zu schreiben → **Fehler**
- MA-Cache (`calculateAndCacheFundingMAs`) versuchte aus `DB_WRITE.market_history` zu lesen → **Fehler: no such table**
- Single MA Endpoint funktionierte (liest aus `DB_READ`)
- Bulk MA Endpoint verwendete veraltete Cache-Daten

## Lösung: Option 1 - Replikation

### 1. Migration: `market_history` Tabelle in DB_WRITE erstellen

**Datei:** `migrations/write/0002_add_market_history.sql`

```sql
CREATE TABLE IF NOT EXISTS market_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  normalized_symbol TEXT NOT NULL,
  avg_mark_price REAL,
  avg_index_price REAL,
  min_price REAL,
  max_price REAL,
  price_volatility REAL,
  volume_base REAL,
  volume_quote REAL,
  avg_open_interest REAL,
  avg_open_interest_usd REAL,
  max_open_interest_usd REAL,
  avg_funding_rate REAL,
  avg_funding_rate_annual REAL,
  min_funding_rate REAL,
  max_funding_rate REAL,
  hour_timestamp INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  aggregated_at INTEGER NOT NULL,
  UNIQUE(exchange, symbol, hour_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_market_history_exchange ON market_history(exchange);
CREATE INDEX IF NOT EXISTS idx_market_history_symbol ON market_history(normalized_symbol);
CREATE INDEX IF NOT EXISTS idx_market_history_hour ON market_history(hour_timestamp);
CREATE INDEX IF NOT EXISTS idx_market_history_exchange_symbol ON market_history(exchange, normalized_symbol);
CREATE INDEX IF NOT EXISTS idx_market_history_exchange_hour ON market_history(exchange, hour_timestamp);
CREATE INDEX IF NOT EXISTS idx_market_history_aggregated_at ON market_history(aggregated_at);
```

**Ausführung:**
```bash
# Lokal
wrangler d1 execute defiapi-db-write --file=migrations/write/0002_add_market_history.sql

# Remote (Produktion)
wrangler d1 execute defiapi-db-write --remote --file=migrations/write/0002_add_market_history.sql
```

### 2. Sync-Funktion: `syncMarketHistoryToRead()`

**Datei:** `src/index.ts`

```typescript
// Sync market_history from DB_WRITE to DB_READ
async function syncMarketHistoryToRead(env: Env): Promise<void> {
  try {
    console.log('[Sync] Starting market_history sync from DB_WRITE to DB_READ');

    // Get the latest synced timestamp from DB_READ
    const lastSyncQuery = await env.DB_READ.prepare(
      'SELECT MAX(aggregated_at) as last_sync FROM market_history'
    ).first<{ last_sync: number }>();

    const lastSync = lastSyncQuery?.last_sync || 0;
    console.log(`[Sync] Last market_history sync: ${lastSync} (${new Date(lastSync * 1000).toISOString()})`);

    // Get new hourly aggregates from DB_WRITE
    const newDataQuery = await env.DB_WRITE.prepare(
      'SELECT * FROM market_history WHERE aggregated_at > ? ORDER BY aggregated_at ASC LIMIT 5000'
    ).bind(lastSync).all();

    if (!newDataQuery.success || !newDataQuery.results || newDataQuery.results.length === 0) {
      console.log('[Sync] No new market_history to sync');
      return;
    }

    console.log(`[Sync] Found ${newDataQuery.results.length} new hourly aggregates to sync`);

    // Batch insert into DB_READ
    const insertStatements = newDataQuery.results.map((row: any) =>
      env.DB_READ.prepare(`
        INSERT OR REPLACE INTO market_history (
          exchange, symbol, normalized_symbol,
          avg_mark_price, avg_index_price, min_price, max_price, price_volatility,
          volume_base, volume_quote,
          avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
          avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
          hour_timestamp, sample_count, aggregated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        row.exchange, row.symbol, row.normalized_symbol,
        row.avg_mark_price, row.avg_index_price, row.min_price, row.max_price, row.price_volatility,
        row.volume_base, row.volume_quote,
        row.avg_open_interest, row.avg_open_interest_usd, row.max_open_interest_usd,
        row.avg_funding_rate, row.avg_funding_rate_annual, row.min_funding_rate, row.max_funding_rate,
        row.hour_timestamp, row.sample_count, row.aggregated_at
      )
    );

    await env.DB_READ.batch(insertStatements);

    console.log(`[Sync] Successfully synced ${newDataQuery.results.length} hourly aggregates to DB_READ`);

  } catch (error) {
    console.error('[Sync] Failed to sync market_history:', error);
  }
}
```

### 3. Integration in Cron Job

**Datei:** `src/index.ts` (Zeile 40-41)

```typescript
// Every 5 minutes: Health check + normalized_tokens update + 1-minute aggregation + MA cache + sync aggregations
if (cronType === '*/5 * * * *') {
  try {
    console.log('[Cron] Running WebSocket health check');
    await checkTrackerHealth(env);

    console.log('[Cron] Updating normalized_tokens table');
    await updateNormalizedTokens(env);

    console.log('[Cron] Running 15s → 1m aggregation');
    await aggregateTo1Minute(env);

    console.log('[Cron] Syncing aggregations to DB_READ');
    await syncAggregationsToRead(env);

    console.log('[Cron] Syncing market_history to DB_READ');  // ← NEU
    await syncMarketHistoryToRead(env);                        // ← NEU

    console.log('[Cron] Calculating and caching moving averages');
    await calculateAndCacheFundingMAs(env);

    console.log('[Cron] 5-minute tasks completed successfully');
  } catch (error) {
    console.error('[Cron] Error in 5-minute tasks:', error);
  }
}
```

## Datenfluss (Neu)

```
┌─────────────────────────────────────────────────────────────┐
│                    DATENFLUSS                                │
└─────────────────────────────────────────────────────────────┘

1. ERFASSUNG (alle 15s)
   Tracker → market_stats (DB_WRITE)

2. ERSTE AGGREGATION (alle 5min)
   market_stats → market_stats_1m (DB_WRITE)
   └─ Cron: aggregateTo1Minute()

3. ZWEITE AGGREGATION (stündlich)
   market_stats_1m → market_history (DB_WRITE)  ← JETZT IN DB_WRITE!
   └─ Cron: aggregateTo1Hour()

4. SYNC ZU DB_READ (alle 5min)
   market_history (DB_WRITE) → market_history (DB_READ)
   └─ Cron: syncMarketHistoryToRead()

5. MA CACHE BERECHNUNG (alle 5min)
   market_history (DB_WRITE) → funding_ma_cache (DB_WRITE)
   └─ Cron: calculateAndCacheFundingMAs()
   └─ FUNKTIONIERT JETZT! ✅

6. API ENDPOINTS
   - Single MA: Liest aus DB_READ.market_history ✅
   - Bulk MA: Liest aus DB_WRITE.funding_ma_cache ✅
```

## Vorteile dieser Lösung

### ✅ Funktionalität
- **MA-Cache funktioniert:** `calculateAndCacheFundingMAs()` kann jetzt aus `DB_WRITE.market_history` lesen
- **Stündliche Aggregation funktioniert:** `aggregateTo1Hour()` schreibt erfolgreich in `DB_WRITE.market_history`
- **Beide API-Endpoints funktionieren:** Single MA (live) und Bulk MA (cache)

### ✅ Architektur
- **Trennung von Hot/Cold Data bleibt erhalten:** DB_WRITE für Schreiblast, DB_READ für Leselast
- **Keine Lock-Konflikte:** Schreib- und Lese-Operationen sind getrennt
- **Inkrementeller Sync:** Nur neue Daten werden synchronisiert (basierend auf `aggregated_at`)

### ✅ Performance
- **Batch-Operationen:** Sync verwendet Batch-Inserts (bis zu 5000 Records)
- **Minimale Latenz:** Sync läuft alle 5 Minuten, maximale Verzögerung = 5 Minuten
- **Effiziente Queries:** Index auf `aggregated_at` für schnelle Sync-Queries

## Monitoring

### Logs überprüfen

```bash
# Cron Job Logs
wrangler tail --format pretty

# Suche nach Sync-Logs
[Sync] Starting market_history sync from DB_WRITE to DB_READ
[Sync] Last market_history sync: 1738408800 (2026-02-01T10:00:00.000Z)
[Sync] Found 150 new hourly aggregates to sync
[Sync] Successfully synced 150 hourly aggregates to DB_READ
```

### Datenbank-Checks

```bash
# Anzahl Einträge in DB_WRITE
wrangler d1 execute defiapi-db-write --remote \
  --command="SELECT COUNT(*) as count FROM market_history"

# Anzahl Einträge in DB_READ
wrangler d1 execute defiapi-db-read --remote \
  --command="SELECT COUNT(*) as count FROM market_history"

# Neueste Einträge vergleichen
wrangler d1 execute defiapi-db-write --remote \
  --command="SELECT MAX(aggregated_at) as latest FROM market_history"

wrangler d1 execute defiapi-db-read --remote \
  --command="SELECT MAX(aggregated_at) as latest FROM market_history"
```

### API-Tests

```bash
# Single MA Endpoint (liest aus DB_READ)
curl "https://api.fundingrate.de/api/funding/ma?symbol=BTC&exchange=paradex" | jq '.data'

# Bulk MA Endpoint (liest aus DB_WRITE cache)
curl "https://api.fundingrate.de/api/funding/ma/bulk?exchanges=paradex,hyperliquid&symbols=BTC&timeframes=24h,30d" | jq '.data'

# MA Cache manuell triggern
curl "https://api.fundingrate.de/api/admin/cache-ma" | jq '.'
```

## Troubleshooting

### Problem: Sync findet keine neuen Daten

**Ursache:** Noch keine stündlichen Aggregate vorhanden (benötigt Daten älter als 1 Stunde)

**Lösung:** Warten bis genug Daten vorhanden sind, oder manuell Aggregation triggern:
```bash
curl "https://api.fundingrate.de/api/admin/aggregate-1h"
```

### Problem: MA-Cache ist leer

**Ursache:** Noch keine historischen Daten in `market_history`

**Lösung:** 
1. Prüfe ob `market_stats_1m` Daten älter als 1h hat
2. Trigger stündliche Aggregation
3. Warte auf nächsten Cron-Lauf (alle 5min)

### Problem: Sync-Verzögerung > 5 Minuten

**Ursache:** Cron Job überlastet oder fehlgeschlagen

**Lösung:**
1. Prüfe Logs: `wrangler tail`
2. Prüfe Cron-Status im Cloudflare Dashboard
3. Manuell triggern: Deployment neu starten

## Deployment-Checklist

- [x] Migration `0002_add_market_history.sql` erstellt
- [x] Migration lokal getestet
- [x] Migration remote ausgeführt
- [x] `syncMarketHistoryToRead()` Funktion implementiert
- [x] Cron Job aktualisiert
- [x] Code deployed
- [x] MA-Cache getestet (kein Fehler mehr)
- [x] API-Endpoints getestet

## Nächste Schritte

1. **Monitoring einrichten:** Alerts für Sync-Fehler
2. **Performance-Optimierung:** Batch-Größe anpassen falls nötig
3. **Cleanup:** Alte `market_history` Einträge in DB_WRITE löschen (optional, nach 30+ Tagen)
4. **Dokumentation:** Architektur-Diagramm aktualisieren

## Zusammenfassung

Die Implementierung von Option 1 (Replikation) ist **erfolgreich abgeschlossen**. Die `market_history` Tabelle existiert jetzt in beiden Datenbanken:

- **DB_WRITE:** Primäre Quelle, wird stündlich befüllt, dient als Quelle für MA-Cache
- **DB_READ:** Replica, wird alle 5 Minuten synchronisiert, dient API-Endpoints

**Alle Funktionen arbeiten jetzt korrekt:**
✅ Stündliche Aggregation  
✅ MA-Cache Berechnung  
✅ Single MA Endpoint  
✅ Bulk MA Endpoint  
✅ Automatischer Sync  
