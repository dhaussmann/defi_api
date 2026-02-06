# Tracker Data to V3 Tables Export Analysis

## Ziel
Exportiere historische Daten aus `market_stats_1m` (Tracker-Daten) in die V3 Tabellen für alle Exchanges, die noch keine historischen Daten bis zum **05.02.2026 18:00 Uhr** haben.

---

## 📊 Verfügbare Tracker-Daten in `market_stats_1m`

### Gesamtübersicht
- **Zeitraum:** 30.01.2026 18:55 - 06.02.2026 06:46
- **Gesamt Records:** 8,493,035
- **Exchanges:** 12
- **Symbols:** 967

### Daten bis Ziel-Zeitpunkt (05.02.2026 01:00)
- **Records:** 6,635,434
- **Zeitraum:** 30.01.2026 18:55 - 05.02.2026 01:00 (~5.2 Tage)

---

## 🗺️ Exchange Mapping: Tracker → V3 Tabellen

| Tracker Exchange | V3 Table | Records | Symbols | Zeitraum | Status |
|-----------------|----------|---------|---------|----------|--------|
| **hyperliquid** | `hyperliquid_funding_v3` | 1,477,896 | 228 | 30.01 18:55 - 05.02 00:59 | ✅ Mapping möglich |
| **lighter** | `lighter_funding_v3` | 383,529 | 132 | 30.01 18:55 - 05.02 00:59 | ✅ Mapping möglich |
| **edgex** | `edgex_funding_v3` | 591,210 | 94 | 30.01 18:55 - 05.02 01:00 | ✅ Mapping möglich |
| **paradex** | `paradex_funding_v3` | 678,348 | 108 | 30.01 18:55 - 05.02 00:59 | ✅ Mapping möglich |
| **extended** | `extended_funding_v3` | 345,228 | 78 | 31.01 07:23 - 05.02 01:00 | ✅ Mapping möglich |
| **variational** | `variational_funding_v3` | 2,384,889 | 484 | 31.01 09:46 - 05.02 01:00 | ✅ Mapping möglich |
| **hyena** | `hyena_funding_v3` | 110,902 | 22 | 30.01 18:56 - 05.02 00:59 | ✅ Mapping möglich |
| **flx** | `felix_funding_v3` | 64,558 | 13 | 30.01 18:56 - 05.02 00:59 | ✅ Mapping möglich |
| **vntl** | `ventuals_funding_v3` | 58,545 | 13 | 30.01 18:56 - 05.02 01:00 | ✅ Mapping möglich |
| **xyz** | `xyz_funding_v3` | 203,458 | 42 | 30.01 18:56 - 05.02 00:59 | ✅ Mapping möglich |
| **km** | ❌ Kein V3 Collector | 63,271 | 13 | 30.01 18:56 - 05.02 01:00 | ⚠️ Ignorieren |
| **pacifica** | ❌ Kein V3 Collector | 273,600 | 50 | 31.01 11:00 - 05.02 01:00 | ⚠️ Ignorieren |

---

## 📋 V3 Tabellen Status & Lücken

### Exchanges MIT historischen Lücken (benötigen Tracker-Daten)

| Exchange | V3 Älteste Daten | Tracker Älteste Daten | Lücke | Tracker Records |
|----------|-----------------|----------------------|-------|-----------------|
| **Lighter** | 2026-02-05 13:00 | 2026-01-30 18:55 | **5.2 Tage** | 383,529 |
| **Extended** | 2026-02-05 15:00 | 2026-01-31 07:23 | **4.8 Tage** | 345,228 |
| **Nado** | 2026-02-05 15:53 | ❌ Kein Tracker | - | - |
| **HyENA** | 2026-02-05 16:02 | 2026-01-30 18:56 | **5.2 Tage** | 110,902 |
| **Felix** | 2026-02-05 16:39 | 2026-01-30 18:56 | **5.2 Tage** | 64,558 |
| **Ventuals** | 2026-02-05 16:44 | 2026-01-30 18:56 | **5.2 Tage** | 58,545 |
| **XYZ** | 2026-02-05 16:48 | 2026-01-30 18:56 | **5.2 Tage** | 203,458 |
| **Variational** | 2026-02-05 16:54 | 2026-01-31 09:46 | **5.1 Tage** | 2,384,889 |
| **Paradex** | 2026-02-05 17:42 | 2026-01-30 18:55 | **5.2 Tage** | 678,348 |

### Exchanges OHNE historische Lücken (bereits gut gefüllt)

| Exchange | V3 Älteste Daten | Tracker Älteste Daten | Status |
|----------|-----------------|----------------------|--------|
| **EdgeX** | 2026-01-01 00:00 | 2026-01-30 18:55 | ✅ Bereits 37 Tage Historie |
| **Hyperliquid** | 2026-01-06 11:00 | 2026-01-30 18:55 | ✅ Bereits 32 Tage Historie |
| **Aster** | 2026-02-05 08:00 | ❌ Kein Tracker | ⚠️ Nur 2 Tage, aber kein Tracker |

---

## 🔄 Export-Strategie

### Datenfluss
```
market_stats_1m (1-Minuten-Aggregate)
    ↓
Stündliche Aggregation (60 Minuten zusammenfassen)
    ↓
{exchange}_funding_v3 Tabellen
```

### Schema-Mapping

**Quelle: `market_stats_1m`**
```sql
- exchange TEXT
- symbol TEXT
- minute_timestamp INTEGER (Unix seconds)
- avg_funding_rate REAL (decimal, z.B. 0.0000125)
- avg_funding_rate_annual REAL (APR in %, z.B. 10.95)
- sample_count INTEGER
```

**Ziel: `{exchange}_funding_v3`**
```sql
- symbol TEXT
- base_asset TEXT (extrahiert aus symbol)
- funding_time INTEGER (Unix seconds, stündlich)
- rate_raw REAL (avg_funding_rate)
- rate_raw_percent REAL (avg_funding_rate * 100)
- interval_hours REAL (Exchange-spezifisch)
- rate_1h_percent REAL (normalisiert auf 1h)
- rate_apr REAL (avg_funding_rate_annual)
- collected_at INTEGER (Unix seconds, jetzt)
- source TEXT ('tracker_export')
```

### Aggregations-Logik

**Stündliche Aggregation:**
```sql
-- Gruppiere 1-Minuten-Daten zu stündlichen Werten
SELECT 
  exchange,
  symbol,
  (minute_timestamp / 3600) * 3600 as hour_timestamp,
  AVG(avg_funding_rate) as avg_funding_rate,
  AVG(avg_funding_rate_annual) as avg_funding_rate_annual,
  SUM(sample_count) as total_samples
FROM market_stats_1m
WHERE minute_timestamp <= 1770253200  -- 2026-02-05 01:00
GROUP BY exchange, symbol, hour_timestamp
```

### Exchange-spezifische Interval-Konfiguration

| Exchange | Funding Interval | Berechnung rate_1h_percent |
|----------|-----------------|---------------------------|
| Hyperliquid | 8h | `rate_raw * 100 / 8` |
| Lighter | 1h | `rate_raw * 100` |
| EdgeX | 4h | `rate_raw * 100 / 4` |
| Paradex | 8h | `rate_raw * 100 / 8` |
| Extended | 1h | `rate_raw * 100` |
| Variational | Variable | Aus Daten berechnen |
| HyENA | 8h | `rate_raw * 100 / 8` |
| Felix | 8h | `rate_raw * 100 / 8` |
| Ventuals | 8h | `rate_raw * 100 / 8` |
| XYZ | 8h | `rate_raw * 100 / 8` |

---

## 📈 Erwartete Export-Mengen

### Pro Exchange (stündliche Aggregate)

| Exchange | 1-Min Records | Erwartete Stunden | Erwartete V3 Records |
|----------|--------------|-------------------|---------------------|
| Lighter | 383,529 | ~125h (5.2 Tage × 132 Märkte) | ~16,500 |
| Extended | 345,228 | ~120h (4.8 Tage × 78 Märkte) | ~9,360 |
| HyENA | 110,902 | ~125h (5.2 Tage × 22 Märkte) | ~2,750 |
| Felix | 64,558 | ~125h (5.2 Tage × 13 Märkte) | ~1,625 |
| Ventuals | 58,545 | ~125h (5.2 Tage × 13 Märkte) | ~1,625 |
| XYZ | 203,458 | ~125h (5.2 Tage × 42 Märkte) | ~5,250 |
| Variational | 2,384,889 | ~120h (5.1 Tage × 484 Märkte) | ~58,080 |
| Paradex | 678,348 | ~125h (5.2 Tage × 108 Märkte) | ~13,500 |

**Gesamt:** ~108,690 neue V3 Records

---

## ⚠️ Wichtige Überlegungen

### 1. **Symbol-Normalisierung**
- Tracker verwendet verschiedene Symbol-Formate
- V3 Tabellen erwarten einheitliche Formate
- **Beispiel:** `BTC-USD-PERP` → `BTC`

### 2. **Base Asset Extraktion**
- Muss aus Symbol extrahiert werden
- Exchange-spezifische Logik notwendig

### 3. **Zeitstempel-Handling**
- `market_stats_1m.minute_timestamp` ist in Sekunden
- Auf volle Stunden runden: `(timestamp / 3600) * 3600`
- `funding_time` = gerundeter Stunden-Timestamp
- `collected_at` = aktueller Timestamp

### 4. **Duplikat-Vermeidung**
- V3 Tabellen haben bereits Daten ab 2026-02-05
- Export nur bis **2026-02-05 01:00** (vor V3 Collector Start)
- `INSERT OR IGNORE` verwenden (falls UNIQUE constraint existiert)

### 5. **Variational Interval**
- Hat variable Funding-Intervalle (1h, 2h, 4h, 8h)
- Muss aus Daten berechnet oder aus Config gelesen werden

---

## 🎯 Implementierungs-Optionen

### **Option 1: SQL-basierter Export (Empfohlen)**
**Vorteile:**
- Schnell und effizient
- Direkt in der Datenbank
- Keine Worker-Timeouts

**Nachteile:**
- Komplexe SQL-Queries
- Exchange-spezifische Logik schwierig

### **Option 2: Worker-basierter Export**
**Vorteile:**
- Volle Kontrolle über Logik
- Exchange-spezifische Anpassungen einfach
- Fortschritts-Tracking möglich

**Nachteile:**
- Worker-Timeouts bei großen Datenmengen
- Langsamer als pure SQL

### **Option 3: Hybrid-Ansatz (Beste Lösung)**
**Strategie:**
1. SQL für Aggregation (1-Min → 1h)
2. Worker für Transformation und Insert
3. Batch-Processing (z.B. 1000 Records pro Batch)

---

## 🚀 Nächste Schritte

1. **Entscheidung:** Welche Exchanges sollen befüllt werden?
   - Alle 9 Exchanges mit Lücken?
   - Nur die wichtigsten (z.B. Paradex, Variational, Lighter)?

2. **Implementierung wählen:**
   - SQL-basiert (schnell, aber komplex)
   - Worker-basiert (flexibel, aber langsamer)
   - Hybrid (beste Balance)

3. **Test-Export:**
   - Starte mit einer Exchange (z.B. Felix - kleinste Datenmenge)
   - Validiere Datenqualität
   - Prüfe auf Duplikate

4. **Vollständiger Export:**
   - Alle Exchanges nacheinander
   - Progress-Logging
   - Validierung nach jedem Export

---

## 📝 Validierungs-Queries

### Nach Export prüfen:
```sql
-- Anzahl neuer Records pro Exchange
SELECT 
  COUNT(*) as new_records,
  MIN(funding_time) as oldest,
  MAX(funding_time) as newest
FROM {exchange}_funding_v3
WHERE source = 'tracker_export';

-- Zeitliche Lücken prüfen
SELECT 
  symbol,
  funding_time,
  LAG(funding_time) OVER (PARTITION BY symbol ORDER BY funding_time) as prev_time,
  (funding_time - LAG(funding_time) OVER (PARTITION BY symbol ORDER BY funding_time)) / 3600 as gap_hours
FROM {exchange}_funding_v3
WHERE source = 'tracker_export'
HAVING gap_hours > 2;
```

---

## ✅ Fazit

**Tracker-Daten sind verfügbar und nutzbar!**
- 6,6 Millionen 1-Minuten-Records
- 9 von 12 V3 Exchanges können befüllt werden
- ~108k neue stündliche V3 Records möglich
- Zeitraum: 30.01.2026 - 05.02.2026 (5+ Tage)

**Empfehlung:** Hybrid-Ansatz mit Worker-basiertem Export in Batches.
