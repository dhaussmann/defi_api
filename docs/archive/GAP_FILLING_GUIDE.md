# Gap Filling Guide - V2 Data Collection

## ❌ **Aktueller Status: KEINE automatische Lückenfüllung**

Die V2 Cron-Jobs füllen derzeit **KEINE Datenlücken automatisch**. Sie sammeln nur neue Daten mit festem Lookback-Zeitraum.

## 📊 **Wie die Collectors aktuell funktionieren:**

### **Feste Lookback-Perioden:**
- **Lighter:** Holt letzte 24 Stunden
- **Binance:** Holt letzte 48 Stunden  
- **Hyperliquid:** Holt letzte 48 Stunden
- **Extended:** Holt letzte 48 Stunden
- **Aster:** Holt letzte 48 Stunden

### **Problem-Szenarien:**

1. **Worker Ausfall:** Wenn der Worker 6 Stunden offline ist → 6-Stunden-Lücke entsteht
2. **API-Fehler:** Wenn Exchange-API temporär ausfällt → Lücken bleiben
3. **Rate Limits:** Wenn API-Limits erreicht werden → Daten fehlen
4. **Lookback zu kurz:** Wenn Lücke älter als Lookback-Period → wird nie gefüllt

## 🔧 **Manuelle Lückenfüllung (Aktuell)**

### **Option 1: Import-Scripts verwenden**

Für jeden Exchange gibt es Import-Scripts, die historische Daten nachfüllen können:

```bash
# Lighter - 7 Tage importieren
bash scripts/v2_import_lighter_batch.sh 7

# Binance - 7 Tage importieren  
bash scripts/v2_import_binance_working.sh 7

# Hyperliquid - 7 Tage importieren
bash scripts/v2_import_hyperliquid_working.sh 7

# Extended - 7 Tage importieren
bash scripts/v2_import_extended_working.sh 7

# Aster - 7 Tage importieren
bash scripts/v2_import_aster_working.sh 7
```

### **Option 2: Spezifische Zeiträume**

Die Import-Scripts akzeptieren die Anzahl der Tage als Parameter:

```bash
# Letzte 3 Tage
bash scripts/v2_import_lighter_batch.sh 3

# Letzte 14 Tage
bash scripts/v2_import_lighter_batch.sh 14

# Letzte 30 Tage
bash scripts/v2_import_lighter_batch.sh 30
```

## 🔍 **Lücken erkennen**

### **Letzte Timestamps prüfen:**

```bash
npx wrangler d1 execute defiapi-db-write --remote --command="
SELECT 
  'lighter' as exchange, 
  MAX(datetime(timestamp/1000, 'unixepoch')) as latest,
  (julianday('now') - julianday(MAX(timestamp/1000), 'unixepoch')) * 24 as hours_ago
FROM lighter_raw_data
UNION ALL
SELECT 
  'binance', 
  MAX(datetime(timestamp/1000, 'unixepoch')),
  (julianday('now') - julianday(MAX(timestamp/1000), 'unixepoch')) * 24
FROM binance_raw_data
UNION ALL
SELECT 
  'hyperliquid', 
  MAX(datetime(timestamp/1000, 'unixepoch')),
  (julianday('now') - julianday(MAX(timestamp/1000), 'unixepoch')) * 24
FROM hyperliquid_raw_data
UNION ALL
SELECT 
  'extended', 
  MAX(datetime(timestamp/1000, 'unixepoch')),
  (julianday('now') - julianday(MAX(timestamp/1000), 'unixepoch')) * 24
FROM extended_raw_data
UNION ALL
SELECT 
  'aster', 
  MAX(datetime(funding_time/1000, 'unixepoch')),
  (julianday('now') - julianday(MAX(funding_time/1000), 'unixepoch')) * 24
FROM aster_raw_data
"
```

### **Fehlende Records pro Symbol prüfen:**

```bash
# Lighter - Symbole mit weniger als 700 Records (30 Tage)
npx wrangler d1 execute defiapi-db-write --remote --command="
SELECT 
  symbol, 
  COUNT(*) as records,
  MIN(datetime(timestamp/1000, 'unixepoch')) as first,
  MAX(datetime(timestamp/1000, 'unixepoch')) as last
FROM lighter_raw_data
GROUP BY symbol
HAVING records < 700
ORDER BY records
"
```

## 🚀 **Zukünftige Implementierung: Automatisches Gap-Filling**

### **Geplante Features:**

1. **Dynamischer Lookback:**
   - Collectors prüfen letzten Timestamp in DB
   - Berechnen benötigten Lookback automatisch
   - Holen alle fehlenden Daten seit letztem Update

2. **Gap Detection:**
   - Stündliche Prüfung auf fehlende Records
   - Logging von erkannten Lücken
   - Automatisches Triggern von Backfills

3. **Smart Retry:**
   - Bei API-Fehlern: Exponential Backoff
   - Bei Rate Limits: Automatisches Warten
   - Bei Timeouts: Batch-Size reduzieren

### **Module erstellt:**

- ✅ `src/v2_GapFiller.ts` - Gap Detection Logik
  - `detectDataGaps()` - Findet fehlende Records
  - `getLastTimestamps()` - Holt letzte Timestamps
  - `calculateLookback()` - Berechnet optimalen Lookback
  - `logGapReport()` - Logging von Lücken

### **Benötigte Änderungen:**

Jeder Collector muss erweitert werden:

```typescript
// VORHER (Fester Lookback):
const startTime = now - (48 * 60 * 60 * 1000); // 48 hours

// NACHHER (Dynamischer Lookback):
const lastTimestamp = await env.DB_WRITE.prepare(
  'SELECT MAX(timestamp) as last_ts FROM lighter_raw_data'
).first<{last_ts: number}>();

const startTime = lastTimestamp?.last_ts 
  ? lastTimestamp.last_ts - (3600 * 1000) // 1 hour buffer
  : now - (48 * 60 * 60 * 1000); // Default fallback
```

## 📋 **Best Practices**

### **Regelmäßige Checks:**

1. **Täglich:** Letzte Timestamps prüfen
2. **Wöchentlich:** Vollständige Gap-Analyse
3. **Nach Ausfällen:** Sofortiges Backfilling

### **Monitoring:**

```bash
# Cron-Job für tägliche Checks (lokal)
0 9 * * * cd /path/to/defi_api && bash scripts/check_data_gaps.sh
```

### **Alerting:**

- Wenn Exchange > 6 Stunden veraltet → Alert
- Wenn > 10% Records fehlen → Alert
- Wenn API-Fehlerrate > 5% → Alert

## 🔗 **Verwandte Dokumentation:**

- `docs/V2_FINAL_VALIDATION_REPORT.md` - Vollständiger Validierungsbericht
- `scripts/v2_import_lighter_batch.sh` - Batch-Import mit Logging
- `src/v2_GapFiller.ts` - Gap Detection Module (vorbereitet)

## ⚠️ **Wichtige Hinweise:**

1. **Binance Rate Limits:** Max 2400 Requests/Minute
2. **Lighter API:** Keine bekannten Limits, aber 50ms Delay empfohlen
3. **Hyperliquid:** Rate Limits unbekannt, vorsichtig sein
4. **Extended:** Stabil, keine Probleme bekannt
5. **Aster:** Variable Intervalle, komplexere Gap-Detection nötig

---

*Letzte Aktualisierung: 2026-02-04*  
*Status: Manuelle Gap-Filling erforderlich*
