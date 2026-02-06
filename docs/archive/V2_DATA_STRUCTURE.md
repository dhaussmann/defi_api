# V2 Data Structure - Übersicht

## 📊 Zusammenfassung

Die V2 Datenstruktur ist eine **isolierte, parallele Implementierung** zur bestehenden V1 Architektur. Sie sammelt stündlich Funding Rate Daten von drei Exchanges und speichert sie in separaten Tabellen.

## 🏗️ Architektur

### Grundprinzip
- **Komplett isoliert** von V1 (keine Berührungspunkte)
- **Nur DB_WRITE** (keine Sync zu DB_READ während Testphase)
- **Stündliche Cron Jobs** (läuft zur vollen Stunde)
- **Rohdaten-Fokus** (minimale Verarbeitung)

---

## 📁 Datenbank-Struktur

### 1. **Lighter** (1-Stunden-Intervalle)

#### Tabellen:
```sql
lighter_raw_data          -- Funding Rate Rohdaten
lighter_markets           -- Market Metadata
lighter_tracker_status    -- Tracker Status & Statistiken
```

#### Datenstruktur `lighter_raw_data`:
| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `id` | INTEGER | Primary Key |
| `symbol` | TEXT | Market Symbol (z.B. 'BTC-USD') |
| `base_asset` | TEXT | Base Asset (z.B. 'BTC') |
| `timestamp` | INTEGER | Unix Millisekunden |
| `rate` | REAL | Raw Rate (decimal, z.B. 0.0001) |
| `rate_percent` | REAL | Rate × 100 |
| `rate_annual` | REAL | **APR: rate × 24 × 365** |
| `collected_at` | INTEGER | Collection Timestamp (Unix Sekunden) |
| `source` | TEXT | 'api' oder 'import' |

#### Besonderheiten:
- **Feste 1h Intervalle** (wie im Original)
- ~130+ aktive Markets
- API: `https://mainnet.zklighter.elliot.ai/api/v1/fundings`

---

### 2. **Aster** (Variable Intervalle mit Auto-Erkennung)

#### Tabellen:
```sql
aster_raw_data            -- Funding Rate Rohdaten
aster_markets             -- Market Metadata mit Intervall-Info
aster_tracker_status      -- Tracker Status & Statistiken
```

#### Datenstruktur `aster_raw_data`:
| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `id` | INTEGER | Primary Key |
| `symbol` | TEXT | Market Symbol (z.B. 'BTCUSDT') |
| `base_asset` | TEXT | Base Asset (z.B. 'BTC') |
| `funding_time` | INTEGER | Unix Millisekunden |
| `rate_raw` | REAL | Raw Rate (decimal) |
| `rate_raw_percent` | REAL | Rate × 100 |
| `rate_hourly` | REAL | **Normalisiert: rate_raw_percent / interval_hours** |
| `rate_annual` | REAL | **APR: rate_raw_percent × events_per_year** |
| `interval_hours` | INTEGER | **Erkanntes Intervall (1, 4, 8h)** |
| `events_per_year` | REAL | **365 × (24 / interval_hours)** |
| `collected_at` | INTEGER | Collection Timestamp |
| `source` | TEXT | 'api' oder 'import' |

#### Besonderheiten:
- **Automatische Intervall-Erkennung** via Median der Zeitdifferenzen
- **3 Werte**: Raw, Normalized Hourly, APR
- `rate_hourly` ermöglicht direkten Vergleich zwischen verschiedenen Intervallen
- ~260+ aktive Perpetual Markets
- API: `https://fapi.asterdex.com/fapi/v1/exchangeInfo`
- Proxy: `https://aster.wirewaving.workers.dev`

---

### 3. **Extended** (1-Stunden-Intervalle)

#### Tabellen:
```sql
extended_raw_data         -- Funding Rate Rohdaten
extended_markets          -- Market Metadata
extended_tracker_status   -- Tracker Status & Statistiken
```

#### Datenstruktur `extended_raw_data`:
| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `id` | INTEGER | Primary Key |
| `symbol` | TEXT | Market Symbol (z.B. 'BTC-USD') |
| `base_asset` | TEXT | Base Asset (z.B. 'BTC') |
| `timestamp` | INTEGER | Unix Millisekunden |
| `rate` | REAL | Raw Rate (decimal) |
| `rate_percent` | REAL | Rate × 100 |
| `rate_annual` | REAL | **APR: rate × 24 × 365** |
| `collected_at` | INTEGER | Collection Timestamp |
| `source` | TEXT | 'api' oder 'import' |

#### Besonderheiten:
- **Feste 1h Intervalle** (wie Lighter)
- Nur **4 Tokens**: BTC, ETH, SOL, STRK
- API: `https://api.starknet.extended.exchange/api/v1/info/{TOKEN}-USD/funding`
- Proxy: `https://extended.wirewaving.workers.dev`

---

## 🔄 Datenfluss

### Stündlicher Cron Job (zur vollen Stunde)

```
┌─────────────────────────────────────────────────────────┐
│  Cron: 0 * * * * (jede volle Stunde)                   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │  collectLighterData(env)        │
        │  collectAsterData(env)          │
        │  collectExtendedData(env)       │
        └─────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │  1. Fetch Active Markets        │
        │  2. Update Market Metadata      │
        │  3. Fetch Last 2h Funding Data  │
        │  4. Calculate APR               │
        │  5. Store in *_raw_data         │
        │  6. Update Tracker Status       │
        └─────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────┐
        │  DB_WRITE (defiapi-db-write)    │
        │  - lighter_raw_data             │
        │  - aster_raw_data               │
        │  - extended_raw_data            │
        └─────────────────────────────────┘
```

---

## 📂 Dateien-Übersicht

### Migrations
```
migrations/write/v2_0001_lighter_raw_data.sql    ✅ Angewendet
migrations/write/v2_0002_aster_raw_data.sql      ✅ Angewendet
migrations/write/v2_0003_extended_raw_data.sql   ✅ Angewendet
```

### Collectors (TypeScript)
```
src/v2_LighterCollector.ts     -- Lighter Datensammlung
src/v2_AsterCollector.ts        -- Aster Datensammlung (mit Intervall-Erkennung)
src/v2_ExtendedCollector.ts    -- Extended Datensammlung
```

### Import Scripts (Bash)
```
scripts/v2_import_lighter_raw.sh    -- 30 Tage Lighter Import
scripts/v2_import_aster_raw.sh      -- 30 Tage Aster Import
scripts/v2_import_extended_raw.sh   -- 30 Tage Extended Import
```

### Integration
```
src/index.ts:20-22              -- Imports der Collector-Funktionen
src/index.ts:75-88              -- Cron Job Integration (0 * * * *)
```

---

## 📊 Nützliche Views

### Lighter
```sql
lighter_latest           -- Neueste Rate pro Market
lighter_daily_stats      -- Tagesstatistiken
lighter_recent_24h       -- Letzte 24h Daten
```

### Aster
```sql
aster_latest                  -- Neueste Rate pro Market
aster_daily_stats             -- Tagesstatistiken
aster_recent_24h              -- Letzte 24h Daten
aster_interval_distribution   -- Intervall-Verteilung (1h/4h/8h)
```

### Extended
```sql
extended_latest          -- Neueste Rate pro Market
extended_daily_stats     -- Tagesstatistiken
extended_recent_24h      -- Letzte 24h Daten
```

---

## 🔍 Wichtige Queries

### Daten prüfen
```sql
-- Anzahl Records
SELECT COUNT(*) FROM lighter_raw_data;
SELECT COUNT(*) FROM aster_raw_data;
SELECT COUNT(*) FROM extended_raw_data;

-- Neueste Daten
SELECT * FROM lighter_latest LIMIT 10;
SELECT * FROM aster_latest LIMIT 10;
SELECT * FROM extended_latest LIMIT 10;

-- Tracker Status
SELECT * FROM lighter_tracker_status;
SELECT * FROM aster_tracker_status;
SELECT * FROM extended_tracker_status;
```

### Aster Intervall-Analyse
```sql
-- Welche Markets nutzen welches Intervall?
SELECT * FROM aster_interval_distribution;

-- Markets mit 1h Intervall
SELECT DISTINCT base_asset, interval_hours 
FROM aster_raw_data 
WHERE interval_hours = 1;
```

### APR Vergleich
```sql
-- Top 10 höchste APRs (Lighter)
SELECT symbol, rate_annual, datetime(timestamp/1000, 'unixepoch') as time
FROM lighter_raw_data
ORDER BY rate_annual DESC
LIMIT 10;

-- Aster normalisierte Hourly Rates
SELECT base_asset, rate_hourly, rate_annual, interval_hours
FROM aster_latest
ORDER BY rate_hourly DESC
LIMIT 10;
```

---

## ⚙️ Konfiguration

### Cron Schedule
```typescript
// src/index.ts
if (cronType === '0 * * * *') {  // Jede volle Stunde
  await collectLighterData(env);
  await collectAsterData(env);
  await collectExtendedData(env);
}
```

### Rate Limiting
- **Lighter**: 100ms Pause zwischen Markets
- **Aster**: 100ms Pause zwischen Batches (10 Markets/Batch)
- **Extended**: 100ms Pause zwischen Tokens

---

## 🎯 Vorteile der V2 Struktur

### 1. **Isolation**
- Keine Abhängigkeiten zu V1
- Kann parallel getestet werden
- Einfaches Rollback möglich

### 2. **Einfachheit**
- Direkte API-Calls (kein WebSocket)
- Minimale Verarbeitung
- Klare Datenstruktur

### 3. **Flexibilität**
- Aster: Automatische Intervall-Erkennung
- Normalisierte Hourly Rates für Vergleiche
- Erweiterbar auf weitere Exchanges

### 4. **Performance**
- Batch-Verarbeitung
- Effiziente Indexes
- Views für häufige Queries

---

## 🚀 Deployment

### 1. Migrations anwenden
```bash
npx wrangler d1 execute defiapi-db-write --remote --file=migrations/write/v2_0001_lighter_raw_data.sql
npx wrangler d1 execute defiapi-db-write --remote --file=migrations/write/v2_0002_aster_raw_data.sql
npx wrangler d1 execute defiapi-db-write --remote --file=migrations/write/v2_0003_extended_raw_data.sql
```

### 2. Historische Daten importieren
```bash
./scripts/v2_import_lighter_raw.sh 30
./scripts/v2_import_aster_raw.sh 30
./scripts/v2_import_extended_raw.sh 30
```

### 3. Worker deployen
```bash
npm run deploy
```

### 4. Monitoring
```bash
# Logs prüfen
npx wrangler tail

# Daten verifizieren
npx wrangler d1 execute defiapi-db-write --remote --command="SELECT * FROM lighter_tracker_status"
```

---

## 📝 Nächste Schritte

### Kurzfristig
- [ ] Import-Scripts debuggen und ausführen
- [ ] Erste Daten sammeln via Cron
- [ ] Monitoring einrichten

### Mittelfristig
- [ ] API Endpoints für V2 Daten erstellen
- [ ] Dashboard für V2 Daten
- [ ] Performance-Optimierung

### Langfristig
- [ ] Migration von V1 zu V2
- [ ] Weitere Exchanges hinzufügen
- [ ] DB_READ Sync aktivieren

---

## 🔗 Verwandte Dokumentation

- `docs/V2_ARCHITECTURE.md` - Detaillierte Architektur-Dokumentation
- `docs/V2_SETUP_GUIDE.md` - Setup und Deployment Guide
- `docs/LIGHTER_API_GUIDE.md` - Lighter API Dokumentation
