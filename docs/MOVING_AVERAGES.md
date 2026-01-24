# Moving Averages - Berechnung und Caching

## Übersicht

Das Moving Average (MA) System berechnet gleitende Durchschnitte der Funding Rates über verschiedene Zeiträume für alle Token und Exchanges. Die Daten werden vorberechnet und gecacht, um schnelle API-Antworten zu ermöglichen und Datenbank-Timeouts zu vermeiden.

## Zeiträume (Timeframes)

Das System berechnet MAs für folgende Zeiträume:

| Timeframe | Dauer | Sekunden |
|-----------|-------|----------|
| 24h | 1 Tag | 86.400 |
| 3d | 3 Tage | 259.200 |
| 7d | 7 Tage | 604.800 |
| 14d | 14 Tage | 1.209.600 |
| 30d | 30 Tage | 2.592.000 |

## Berechnungsmethodik

### 1. Datenquelle

Die Berechnungen basieren auf der `market_stats_1m` Tabelle, die aggregierte 1-Minuten-Daten enthält:
- `normalized_symbol`: Normalisiertes Token-Symbol (z.B. "BTC", "ETH")
- `exchange`: Exchange-Name (z.B. "hyperliquid", "paradex")
- `avg_funding_rate`: Durchschnittliche Funding Rate für diese Minute
- `avg_funding_rate_annual`: Annualisierte Funding Rate in Prozent
- `minute_timestamp`: Unix-Timestamp der Minute

### 2. Berechnungsformel

Für jeden Timeframe wird der **arithmetische Durchschnitt** aller 1-Minuten-Werte berechnet:

```sql
AVG(avg_funding_rate) as avg_funding_rate
AVG(avg_funding_rate_annual) as avg_funding_rate_annual
COUNT(*) as sample_count
```

**Beispiel für 24h MA:**
- Zeitraum: Jetzt - 86.400 Sekunden (24 Stunden)
- Daten: Alle 1-Minuten-Einträge in diesem Zeitraum
- Berechnung: Summe aller Werte / Anzahl der Werte

### 3. Gruppierung

Die Daten werden gruppiert nach:
- `normalized_symbol`: Jedes Token separat
- `exchange`: Jeder Exchange separat

**Resultat:** Für jede Symbol/Exchange-Kombination gibt es einen MA-Wert pro Timeframe.

### 4. Beispiel-Berechnung

**Szenario:** BTC auf Hyperliquid, 24h MA

```
Zeitpunkt: 2026-01-24 09:00:00 (Unix: 1737709200)
Zeitraum: 2026-01-23 09:00:00 bis 2026-01-24 09:00:00

Daten aus market_stats_1m:
- 1440 Einträge (24h × 60 Minuten)
- avg_funding_rate Werte: 0.00005, 0.00006, 0.00004, ...
- avg_funding_rate_annual Werte: 5.48%, 6.57%, 4.38%, ...

Berechnung:
avg_funding_rate = (0.00005 + 0.00006 + 0.00004 + ...) / 1440 = 0.00005124
avg_funding_rate_annual = (5.48 + 6.57 + 4.38 + ...) / 1440 = 5.6104%
sample_count = 1440
```

## Caching-System

### Architektur

```
┌─────────────────┐
│   Cron Job      │  Läuft alle 5 Minuten
│   (*/5 * * * *) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  calculateAndCacheFundingMAs()  │
│  - Berechnet alle 5 Timeframes  │
│  - Sequentielle Verarbeitung    │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│   funding_ma_cache Tabelle      │
│   - normalized_symbol           │
│   - exchange                    │
│   - timeframe                   │
│   - avg_funding_rate            │
│   - avg_funding_rate_annual     │
│   - sample_count                │
│   - calculated_at               │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  /api/funding/ma/bulk Endpoint  │
│  - Liest aus Cache              │
│  - Filtert nach Parametern      │
│  - Berechnet Arbitrage          │
└─────────────────────────────────┘
```

### Workflow

#### 1. Cron-Job Trigger (alle 5 Minuten)

```typescript
// In src/index.ts - scheduled() Handler
if (cron === '*/5 * * * *') {
  await calculateAndCacheFundingMAs(env);
}
```

#### 2. Berechnung (src/maCache.ts)

```typescript
export async function calculateAndCacheFundingMAs(env: Env) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  
  // Für jeden Timeframe
  for (const [timeframeName, timeframeSeconds] of Object.entries(TIMEFRAMES)) {
    const fromTimestamp = nowSeconds - timeframeSeconds;
    
    // SQL: Berechne MAs für alle Symbol/Exchange-Kombinationen
    INSERT OR REPLACE INTO funding_ma_cache (...)
    SELECT 
      normalized_symbol,
      exchange,
      ? as timeframe,
      AVG(avg_funding_rate),
      AVG(avg_funding_rate_annual),
      COUNT(*),
      ? as calculated_at
    FROM market_stats_1m
    WHERE minute_timestamp >= ? AND minute_timestamp <= ?
      AND avg_funding_rate IS NOT NULL
    GROUP BY normalized_symbol, exchange
  }
}
```

**Wichtig:** 
- `INSERT OR REPLACE`: Überschreibt alte Werte, falls vorhanden
- Sequentielle Verarbeitung: Ein Timeframe nach dem anderen
- Dauer: ~2-3 Sekunden für alle 5 Timeframes

#### 3. Cache-Abfrage

```typescript
export async function getCachedFundingMAs(
  env: Env,
  exchanges?: string[],
  symbols?: string[],
  timeframes?: string[]
) {
  // Dynamische WHERE-Klauseln basierend auf Filtern
  SELECT * FROM funding_ma_cache
  WHERE exchange IN (?) 
    AND normalized_symbol IN (?)
    AND timeframe IN (?)
  ORDER BY normalized_symbol, exchange, timeframe
}
```

### Cache-Tabelle Schema

```sql
CREATE TABLE funding_ma_cache (
  normalized_symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  avg_funding_rate REAL,
  avg_funding_rate_annual REAL,
  sample_count INTEGER,
  calculated_at INTEGER,
  PRIMARY KEY (normalized_symbol, exchange, timeframe)
);

-- Indizes für schnelle Abfragen
CREATE INDEX idx_fmc_symbol ON funding_ma_cache(normalized_symbol);
CREATE INDEX idx_fmc_exchange ON funding_ma_cache(exchange);
CREATE INDEX idx_fmc_timeframe ON funding_ma_cache(timeframe);
```

### Performance-Charakteristiken

| Metrik | Wert | Beschreibung |
|--------|------|--------------|
| **Update-Frequenz** | 5 Minuten | Cron-Job läuft alle 5 Minuten |
| **Daten-Aktualität** | Max. 5 Min | Daten sind maximal 5 Minuten alt |
| **Berechnungsdauer** | 2-3 Sekunden | Alle 5 Timeframes |
| **Cache-Größe** | ~1.000-1.300 Einträge | Pro Timeframe |
| **API Response-Zeit** | ~50ms | Lesen aus Cache |
| **Skalierbarkeit** | 100+ User | Gleichzeitige Anfragen kein Problem |

### Vorteile des Caching-Systems

1. **Performance:**
   - Vorher: 2-3 Sekunden Echtzeit-Berechnung
   - Jetzt: ~50ms Cache-Abfrage
   - **60× schneller**

2. **Stabilität:**
   - Keine Timeout-Risiken bei hoher Last
   - Konstante Response-Zeiten

3. **Skalierbarkeit:**
   - 100+ gleichzeitige Nutzer möglich
   - Keine zusätzliche DB-Last pro Request

4. **Konsistenz:**
   - Alle Nutzer sehen dieselben Daten
   - Keine Inkonsistenzen durch parallele Berechnungen

## API-Nutzung

### Endpoint: `/api/funding/ma/bulk`

**Query-Parameter:**
- `exchanges`: Komma-separierte Liste (z.B. `hyperliquid,paradex`)
- `symbols`: Komma-separierte Liste (z.B. `BTC,ETH`)
- `timeframes`: Komma-separierte Liste (z.B. `24h,7d,30d`)

**Beispiel-Request:**
```bash
curl 'https://api.fundingrate.de/api/funding/ma/bulk?symbols=BTC,ETH&timeframes=24h,7d'
```

**Response-Struktur:**
```json
{
  "success": true,
  "data": [
    {
      "symbol": "BTC",
      "exchange": "hyperliquid",
      "timeframes": {
        "24h": {
          "avg_funding_rate": 0.00005124,
          "avg_funding_rate_annual": 5.6104,
          "sample_count": 1440
        },
        "7d": {
          "avg_funding_rate": 0.00004085,
          "avg_funding_rate_annual": 4.473,
          "sample_count": 10080
        }
      }
    }
  ],
  "arbitrage": [...],
  "meta": {
    "total_combinations": 17,
    "timeframes": ["24h", "7d"],
    "arbitrage_opportunities": 5
  }
}
```

## Wartung und Monitoring

### Manuelle Cache-Aktualisierung

Für initiales Befüllen oder Debugging:

```bash
# Einzelner Timeframe (basierend auf aktueller Minute)
curl 'https://api.fundingrate.de/api/admin/cache-ma'

# Alle Timeframes auf einmal (kann Timeout verursachen)
curl 'https://api.fundingrate.de/api/admin/cache-ma?all=true'
```

### Cache-Status prüfen

```bash
# Über Wrangler CLI
wrangler d1 execute defiapi-db --remote --command \
  "SELECT timeframe, COUNT(*) as count, 
   datetime(MAX(calculated_at), 'unixepoch') as last_update 
   FROM funding_ma_cache 
   GROUP BY timeframe"
```

### Logs überwachen

```bash
# Cloudflare Dashboard > Workers > defiapi > Logs
# Suche nach: "[MA Cache]"
```

**Typische Log-Ausgaben:**
```
[MA Cache] Starting moving average calculation for all timeframes...
[MA Cache] Calculating 24h...
[MA Cache] 24h: Cached 1070 combinations
[MA Cache] Calculating 3d...
[MA Cache] 3d: Cached 1070 combinations
...
[MA Cache] All timeframes calculated in 2847ms - Total: 5350 entries
```

## Troubleshooting

### Problem: Keine Daten im Cache

**Ursache:** Cron-Job läuft nicht oder schlägt fehl

**Lösung:**
1. Prüfe Cron-Job-Status im Cloudflare Dashboard
2. Manuell triggern: `curl .../api/admin/cache-ma`
3. Logs prüfen auf Fehler

### Problem: Veraltete Daten

**Ursache:** Cron-Job läuft nicht regelmäßig

**Lösung:**
1. Prüfe `calculated_at` Timestamp in DB
2. Verifiziere Cron-Schedule in `wrangler.toml`
3. Cloudflare Cron Trigger Status prüfen

### Problem: Timeout bei Berechnung

**Ursache:** Zu viele Daten oder langsame DB

**Lösung:**
1. Prüfe `market_stats_1m` Tabellengröße
2. Verifiziere Indizes sind vorhanden
3. Erwäge Batch-Verarbeitung für einzelne Timeframes

## Technische Details

### Datenbank-Abfrage-Optimierung

**Verwendete Indizes:**
- `market_stats_1m`: Index auf `minute_timestamp`
- `funding_ma_cache`: Composite Primary Key + 3 einzelne Indizes

**Query-Plan:**
```sql
EXPLAIN QUERY PLAN
SELECT AVG(avg_funding_rate) 
FROM market_stats_1m 
WHERE minute_timestamp >= ? AND minute_timestamp <= ?
GROUP BY normalized_symbol, exchange;

-- Nutzt: idx_market_stats_1m_timestamp
-- Scan: Index Range Scan (effizient)
```

### Memory-Footprint

- Pro Timeframe: ~1.000 Einträge × ~100 Bytes = ~100 KB
- Gesamt Cache: 5 Timeframes × 100 KB = **~500 KB**
- Vernachlässigbar für Cloudflare Workers

### Concurrency

- Cron-Job: Sequentielle Ausführung (kein Locking nötig)
- API-Requests: Parallel möglich (nur Lesezugriffe)
- Cache-Updates: Atomare `INSERT OR REPLACE` Operationen

## Zusammenfassung

Das MA-Caching-System bietet:
- ✅ Schnelle API-Responses (~50ms)
- ✅ Hohe Skalierbarkeit (100+ User)
- ✅ Aktuelle Daten (max. 5 Min alt)
- ✅ Stabile Performance (keine Timeouts)
- ✅ Einfache Wartung (automatisch via Cron)
