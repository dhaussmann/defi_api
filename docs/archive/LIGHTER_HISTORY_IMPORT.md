# Lighter History Import - Anleitung

## Übersicht

Das Script `scripts/export-lighter-history.sh` exportiert historische Funding Rate Daten von Lighter in eine importierbare SQL-Datei.

## Export durchgeführt

**Datum:** 4. Februar 2026, 11:43 Uhr  
**Zeitraum:** Letzte 30 Tage (5. Januar - 4. Februar 2026)  
**Auflösung:** Stündlich (1h)

### Statistiken

- **Tokens:** 129 aktive Markets
- **Datenpunkte:** 89,522 stündliche Funding Rates
- **Dateigröße:** 29 MB
- **Dateiname:** `lighter_history_20260204_114304.sql`

### Abgedeckte Assets

**Krypto:** BTC, ETH, SOL, DOGE, WIF, 1000PEPE, WLD, XRP, LINK, AVAX, DOT, NEAR, POL, TAO, TRUMP, SUI, 1000SHIB, 1000BONK, 1000FLOKI, 1000TOSHI, BERA, FARTCOIN, HYPE, BNB, JUP, AAVE, ENA, UNI, APT, SEI, KAITO, IP, LTC, PENDLE, ONDO, ADA, S, VIRTUAL, SPX, TRX, SYRUP, PUMP, LDO, PENGU, PAXG, EIGEN, RESOLV, GRASS, ZORA, OP, ZK, PROVE, BCH, HBAR, ZRO, GMX, DYDX, MNT, ETHFI, AERO, USELESS, TIA, MORPHO, VVV, YZY, XPL, WLFI, CRO, NMR, LINEA, PYTH, SKY, MYX, 1000TOSHI, AVNT, ASTER, 0G, STBL, APEX, FF, 2Z, EDEN, ZEC, MON, XAU, XAG, MEGA, COIN, HOOD, PLTR, TSLA, AAPL, AMZN, MSFT, GOOGL, META, STABLE, XLM, LIT, CRCL, MSTR, BMNR, DUSK, RIVER, DASH, SKR, AXS

**Forex:** EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, USDKRW, AUDUSD, NZDUSD

**Stocks:** NVDA, PLTR, TSLA, AAPL, AMZN, MSFT, GOOGL, META, HOOD, COIN, MSTR

**Commodities:** XAU (Gold), XAG (Silber)

## Import in Datenbank

### Option 1: Remote Import (Cloudflare D1)

```bash
# Import in DB_WRITE
npx wrangler d1 execute defiapi-db-write --remote --file=lighter_history_20260204_114304.sql

# Danach Sync zu DB_READ
npx wrangler d1 execute defiapi-db-read --remote --file=lighter_history_20260204_114304.sql
```

**Hinweis:** Der Import kann bei 89k Records einige Minuten dauern. D1 hat ein Timeout von ~30 Sekunden pro Statement, daher könnte der Import in Batches aufgeteilt werden müssen.

### Option 2: Lokaler Test (SQLite)

```bash
# Neue Test-Datenbank erstellen
sqlite3 test_lighter.db < lighter_history_20260204_114304.sql

# Daten prüfen
sqlite3 test_lighter.db "SELECT COUNT(*) FROM market_history WHERE exchange = 'lighter';"
sqlite3 test_lighter.db "SELECT COUNT(DISTINCT symbol) FROM market_history WHERE exchange = 'lighter';"
```

### Option 3: Batch Import (für große Dateien)

Falls der Import wegen Timeouts fehlschlägt, kann die Datei aufgeteilt werden:

```bash
# Datei in kleinere Chunks aufteilen (z.B. 10k Zeilen)
split -l 10000 lighter_history_20260204_114304.sql lighter_chunk_

# Jeden Chunk einzeln importieren
for chunk in lighter_chunk_*; do
  echo "Importing $chunk..."
  npx wrangler d1 execute defiapi-db-write --remote --file=$chunk
  sleep 2
done
```

## Datenstruktur

Die importierten Daten enthalten folgende Felder:

```sql
CREATE TABLE market_history (
  exchange TEXT,                    -- 'lighter'
  symbol TEXT,                      -- 'BTC', 'ETH', etc.
  normalized_symbol TEXT,           -- Gleich wie symbol
  avg_funding_rate REAL,            -- Funding Rate (Dezimal, z.B. 0.0012)
  avg_funding_rate_annual REAL,    -- APR (z.B. 10.512%)
  hour_timestamp INTEGER,           -- Unix timestamp (Sekunden)
  sample_count INTEGER,             -- Immer 1 (stündliche Daten)
  aggregated_at INTEGER,            -- Export timestamp
  PRIMARY KEY (exchange, symbol, hour_timestamp)
);
```

### Beispiel-Daten

```sql
INSERT INTO market_history_import (
  exchange, symbol, normalized_symbol,
  avg_funding_rate, avg_funding_rate_annual,
  hour_timestamp, sample_count, aggregated_at
) VALUES (
  'lighter',
  'BTC',
  'BTC',
  0.0012,           -- 0.12% per hour
  10.512,           -- 10.512% APR
  1770116400,       -- 2026-02-03 11:00:00
  1,
  1770201462
);
```

## Verifikation nach Import

```sql
-- Anzahl importierter Records
SELECT COUNT(*) FROM market_history WHERE exchange = 'lighter';
-- Erwartung: ~89,522

-- Anzahl Tokens
SELECT COUNT(DISTINCT symbol) FROM market_history WHERE exchange = 'lighter';
-- Erwartung: ~129

-- Zeitraum
SELECT 
  MIN(datetime(hour_timestamp, 'unixepoch')) as earliest,
  MAX(datetime(hour_timestamp, 'unixepoch')) as latest
FROM market_history 
WHERE exchange = 'lighter';
-- Erwartung: 2026-01-05 bis 2026-02-04

-- Top 10 Tokens nach Datenpunkten
SELECT 
  symbol,
  COUNT(*) as records,
  MIN(datetime(hour_timestamp, 'unixepoch')) as first_record,
  MAX(datetime(hour_timestamp, 'unixepoch')) as last_record
FROM market_history 
WHERE exchange = 'lighter'
GROUP BY symbol
ORDER BY records DESC
LIMIT 10;
```

## Beispiel-Queries

### Durchschnittliche APR pro Token (30 Tage)

```sql
SELECT 
  symbol,
  AVG(avg_funding_rate_annual) as avg_apr,
  MIN(avg_funding_rate_annual) as min_apr,
  MAX(avg_funding_rate_annual) as max_apr,
  COUNT(*) as sample_count
FROM market_history
WHERE exchange = 'lighter'
  AND hour_timestamp >= strftime('%s', 'now', '-30 days')
GROUP BY symbol
ORDER BY avg_apr DESC
LIMIT 20;
```

### Funding Rate Volatilität

```sql
SELECT 
  symbol,
  AVG(avg_funding_rate_annual) as avg_apr,
  STDEV(avg_funding_rate_annual) as volatility,
  MAX(avg_funding_rate_annual) - MIN(avg_funding_rate_annual) as range_apr
FROM market_history
WHERE exchange = 'lighter'
GROUP BY symbol
ORDER BY volatility DESC
LIMIT 20;
```

### Stündliche Funding Rates für BTC (letzte 7 Tage)

```sql
SELECT 
  datetime(hour_timestamp, 'unixepoch') as time,
  avg_funding_rate,
  avg_funding_rate_annual
FROM market_history
WHERE exchange = 'lighter'
  AND symbol = 'BTC'
  AND hour_timestamp >= strftime('%s', 'now', '-7 days')
ORDER BY hour_timestamp DESC;
```

## Erneuter Export

Um neue Daten zu exportieren:

```bash
# Letzte 7 Tage
./scripts/export-lighter-history.sh 7

# Letzte 30 Tage (Standard)
./scripts/export-lighter-history.sh 30

# Letzte 90 Tage
./scripts/export-lighter-history.sh 90
```

## Hinweise

1. **Duplikate:** Das Script verwendet `INSERT OR REPLACE`, sodass bestehende Daten überschrieben werden
2. **Performance:** 89k Records können 2-5 Minuten Import-Zeit benötigen
3. **Timeouts:** Bei D1 Timeouts die Batch-Import Methode verwenden
4. **Speicher:** Die SQL-Datei ist 29 MB groß, stelle sicher dass genug Speicher verfügbar ist
5. **Rate Limits:** Das Export-Script hat eingebaute Delays (0.1s zwischen Requests)

## Troubleshooting

### Import schlägt fehl mit "timeout"

```bash
# Lösung: Datei aufteilen
split -l 5000 lighter_history_20260204_114304.sql chunk_
for f in chunk_*; do wrangler d1 execute defiapi-db-write --remote --file=$f; done
```

### "Table does not exist"

```bash
# Lösung: Schema zuerst erstellen
wrangler d1 execute defiapi-db-write --remote --file=migrations/write/0001_initial_schema.sql
```

### Daten fehlen nach Import

```bash
# Prüfen ob COMMIT ausgeführt wurde
sqlite3 test.db "SELECT * FROM market_history WHERE exchange = 'lighter' LIMIT 1;"

# Falls leer: Transaction manuell committen
sqlite3 test.db "COMMIT;"
```

## Nächste Schritte

Nach erfolgreichem Import:

1. ✅ Daten in `market_history` Tabelle
2. ✅ Verfügbar für `/api/market-history` Endpoint
3. ✅ Verfügbar für `/api/normalized-data` Endpoint
4. ✅ Verwendbar für Moving Average Berechnungen
5. ✅ Verwendbar für Arbitrage Detection

Die historischen Lighter Daten sind jetzt vollständig in deiner API integriert! 🚀
