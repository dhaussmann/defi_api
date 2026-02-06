# Unified Funding Rates - Cross-Exchange Queries

## Übersicht

Die `unified_funding_rates` Tabelle konsolidiert alle V3 Funding Rates mit **normalisierten Symbolen** für Cross-Exchange-Abfragen.

**Ziel:** Alle Funding Rates eines Symbols (z.B. BTC) über alle Exchanges hinweg abfragen können.

---

## 📊 **Tabellen-Schema**

```sql
CREATE TABLE unified_funding_rates (
  -- Primary identifiers
  normalized_symbol TEXT NOT NULL,      -- Normalisiert: BTC, ETH, SOL
  exchange TEXT NOT NULL,               -- hyperliquid, paradex, etc.
  funding_time INTEGER NOT NULL,        -- Unix timestamp (seconds)
  
  -- Original data
  original_symbol TEXT NOT NULL,        -- Original aus V3 Tabelle
  base_asset TEXT,                      -- Base Asset
  
  -- Funding rates
  rate_raw REAL NOT NULL,               -- Decimal (0.0001)
  rate_raw_percent REAL NOT NULL,       -- Percent (0.01%)
  interval_hours REAL NOT NULL,         -- 1h, 4h, 8h, 24h
  rate_1h_percent REAL NOT NULL,        -- Normalisiert auf 1h
  rate_apr REAL,                        -- APR
  
  -- Metadata
  collected_at INTEGER NOT NULL,        -- Wann gesammelt
  source TEXT NOT NULL,                 -- api, import, tracker_export
  synced_at INTEGER NOT NULL,           -- Wann synchronisiert
  
  PRIMARY KEY (normalized_symbol, exchange, funding_time)
);
```

---

## 🔄 **Symbol-Normalisierung**

Die Normalisierung verwendet die **gleiche Logik** wie die alten Tracker (`aggregateTo1Hour()`):

### **Entfernt werden:**
1. **Exchange-Präfixe:** `edgex:`, `aster:`, `flx:`, `vntl:`, `xyz:`, `km:`, `hyna:`, `hyena:`
2. **Suffix-Varianten:** `-USD-PERP`, `-PERP`, `-USD`, `USDT`, `USD`
3. **Spezielle Präfixe:** `1000`, `k` (für 1000PEPE → PEPE)
4. **Sonderzeichen:** `/`, `_`
5. **Konvertiert zu UPPERCASE**

### **Beispiele:**
```
edgex:BTC-USD-PERP  → BTC
flx:ETH             → ETH
paradex:SOL-USD     → SOL
1000PEPE            → PEPE
kSHIB               → SHIB
BTC/USD             → BTC
```

---

## 🔄 **Synchronisations-Prozess**

### **Automatische Synchronisation:**
- **Cron Job:** Alle 5 Minuten (zusammen mit MA-Cache, Arbitrage)
- **Funktion:** `syncAllV3ToUnified(env)`
- **Quelle:** Alle 12 V3 Funding Tables
- **Ziel:** `unified_funding_rates`

### **Ablauf:**
1. Hole letzten Sync-Zeitpunkt aus `unified_funding_rates.synced_at`
2. Für jede V3 Exchange:
   - Query neue Daten seit letztem Sync
   - Normalisiere Symbole (SQL-basiert)
   - `INSERT OR IGNORE` in `unified_funding_rates`
3. Tracking: Records pro Exchange

### **Datenqualität:**
- ✅ Nur Rates mit `rate_raw IS NOT NULL`
- ✅ Nur Rates innerhalb -10% bis +10%
- ✅ Duplikate werden ignoriert (`INSERT OR IGNORE`)

---

## 📡 **API Endpoints**

### **1. Query Funding Rates (Cross-Exchange)**

```
GET /api/unified-funding?symbol=BTC&from=1770180000&exchanges=hyperliquid,paradex
```

**Parameter:**
- `symbol` (required): Normalisiertes Symbol (BTC, ETH, SOL)
- `from` (optional): Start-Timestamp (Unix seconds)
- `to` (optional): End-Timestamp (Unix seconds)
- `exchanges` (optional): Komma-separierte Liste (hyperliquid,paradex,edgex)

**Response:**
```json
{
  "success": true,
  "symbol": "BTC",
  "count": 150,
  "data": [
    {
      "normalized_symbol": "BTC",
      "exchange": "hyperliquid",
      "funding_time": 1770180000,
      "timestamp": "2026-02-04 12:00:00",
      "original_symbol": "BTC",
      "rate_raw": 0.0000125,
      "rate_raw_percent": 0.00125,
      "interval_hours": 8,
      "rate_1h_percent": 0.00015625,
      "rate_apr": 10.95,
      "source": "api"
    },
    {
      "normalized_symbol": "BTC",
      "exchange": "paradex",
      "funding_time": 1770180000,
      "timestamp": "2026-02-04 12:00:00",
      "original_symbol": "BTC-USD-PERP",
      "rate_raw": 0.0000130,
      "rate_raw_percent": 0.00130,
      "interval_hours": 8,
      "rate_1h_percent": 0.0001625,
      "rate_apr": 11.39,
      "source": "tracker_export"
    }
  ]
}
```

---

### **2. Statistiken**

```
GET /api/unified-funding/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalRecords": 338040,
    "uniqueSymbols": 850,
    "exchanges": 12,
    "oldestDate": "2026-01-01T00:00:00.000Z",
    "newestDate": "2026-02-06T08:00:00.000Z",
    "lastSync": "2026-02-06T08:50:00.000Z"
  }
}
```

---

### **3. Manueller Sync (Debug)**

```
GET /debug/unified-sync
```

**Response:**
```json
{
  "success": true,
  "totalRecords": 1250,
  "byExchange": {
    "hyperliquid": 228,
    "paradex": 180,
    "edgex": 150,
    "lighter": 120,
    "variational": 450,
    "felix": 22,
    "ventuals": 20,
    "xyz": 40,
    "hyena": 30,
    "extended": 10
  },
  "duration": 2500
}
```

---

## 🎯 **Anwendungsfälle**

### **1. Alle BTC Funding Rates der letzten 3 Tage**

```bash
# Timestamp: 3 Tage zurück
FROM_TS=$(date -v-3d +%s)

curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/unified-funding?symbol=BTC&from=$FROM_TS"
```

**Ergebnis:** Alle BTC Rates von allen Exchanges (Hyperliquid, Paradex, EdgeX, etc.)

---

### **2. Vergleich: BTC auf Hyperliquid vs Paradex**

```bash
curl "https://defiapi.cloudflareone-demo-account.workers.dev/api/unified-funding?symbol=BTC&exchanges=hyperliquid,paradex&from=1770180000"
```

**Ergebnis:** Nur BTC Rates von Hyperliquid und Paradex

---

### **3. Alle Symbole mit höchsten Funding Rates**

```sql
-- Direkte SQL-Query in DB_WRITE
SELECT 
  normalized_symbol,
  AVG(rate_1h_percent) as avg_rate_1h,
  COUNT(DISTINCT exchange) as exchange_count,
  COUNT(*) as data_points
FROM unified_funding_rates
WHERE funding_time >= 1770180000  -- Letzte 3 Tage
GROUP BY normalized_symbol
HAVING exchange_count >= 3  -- Mindestens 3 Exchanges
ORDER BY avg_rate_1h DESC
LIMIT 20;
```

---

### **4. Arbitrage-Opportunities**

```sql
-- Finde Symbole mit großen Rate-Unterschieden zwischen Exchanges
SELECT 
  normalized_symbol,
  funding_time,
  MAX(rate_1h_percent) - MIN(rate_1h_percent) as spread,
  MAX(rate_1h_percent) as highest_rate,
  MIN(rate_1h_percent) as lowest_rate,
  COUNT(DISTINCT exchange) as exchanges
FROM unified_funding_rates
WHERE funding_time >= 1770180000
GROUP BY normalized_symbol, funding_time
HAVING exchanges >= 3 AND spread > 0.01  -- Spread > 0.01%
ORDER BY spread DESC
LIMIT 50;
```

---

## 📈 **Performance & Indices**

### **Indices:**
```sql
-- Schnelle Symbol-Suche
CREATE INDEX idx_unified_funding_normalized_symbol 
  ON unified_funding_rates(normalized_symbol);

-- Zeitbereich-Queries
CREATE INDEX idx_unified_funding_time 
  ON unified_funding_rates(funding_time);

-- Exchange-Filter
CREATE INDEX idx_unified_funding_exchange 
  ON unified_funding_rates(exchange);

-- Kombiniert: Symbol + Zeit
CREATE INDEX idx_unified_funding_symbol_time 
  ON unified_funding_rates(normalized_symbol, funding_time);

-- Cross-Exchange-Queries
CREATE INDEX idx_unified_funding_symbol_time_exchange 
  ON unified_funding_rates(normalized_symbol, funding_time, exchange);

-- Sync-Tracking
CREATE INDEX idx_unified_funding_synced_at 
  ON unified_funding_rates(synced_at);
```

### **Query-Performance:**
- ✅ Symbol-Lookup: <10ms (Index auf normalized_symbol)
- ✅ Zeitbereich: <50ms (Index auf funding_time)
- ✅ Cross-Exchange: <100ms (Composite Index)

---

## 🔍 **Validierungs-Queries**

### **Prüfe Sync-Status:**
```sql
SELECT 
  exchange,
  COUNT(*) as records,
  MIN(datetime(funding_time, 'unixepoch')) as oldest,
  MAX(datetime(funding_time, 'unixepoch')) as newest,
  MAX(datetime(synced_at, 'unixepoch')) as last_sync
FROM unified_funding_rates
GROUP BY exchange
ORDER BY exchange;
```

### **Prüfe Symbol-Normalisierung:**
```sql
SELECT 
  original_symbol,
  normalized_symbol,
  exchange,
  COUNT(*) as occurrences
FROM unified_funding_rates
WHERE normalized_symbol = 'BTC'
GROUP BY original_symbol, normalized_symbol, exchange
ORDER BY occurrences DESC;
```

### **Finde fehlende Daten:**
```sql
-- Symbole die nur auf wenigen Exchanges verfügbar sind
SELECT 
  normalized_symbol,
  COUNT(DISTINCT exchange) as exchange_count,
  GROUP_CONCAT(DISTINCT exchange) as exchanges
FROM unified_funding_rates
WHERE funding_time >= 1770180000
GROUP BY normalized_symbol
HAVING exchange_count < 3
ORDER BY exchange_count DESC;
```

---

## ✅ **Vorteile**

1. **Cross-Exchange-Abfragen:** Alle BTC Rates über alle Exchanges mit einer Query
2. **Normalisierte Symbole:** Einheitliche Symbole (BTC statt BTC-USD-PERP, edgex:BTC, etc.)
3. **Automatische Synchronisation:** Alle 5 Minuten, keine manuelle Pflege
4. **Historische Daten:** Enthält Tracker-Export + API-Daten + Imports
5. **Performant:** Optimierte Indices für schnelle Queries
6. **Arbitrage-Ready:** Einfache Identifikation von Rate-Unterschieden

---

## 🚀 **Nächste Schritte**

1. **Monitoring:** Überwache Sync-Performance und Datenqualität
2. **Analytics:** Baue Dashboards für Cross-Exchange-Vergleiche
3. **Alerts:** Benachrichtigungen bei großen Rate-Spreads (Arbitrage)
4. **API-Erweiterung:** Aggregierte Statistiken (Durchschnitt, Median, etc.)

---

**Status:** ✅ Produktiv seit 2026-02-06  
**Sync-Frequenz:** Alle 5 Minuten  
**Datenquellen:** 12 V3 Exchanges  
**Total Records:** ~338,000+
