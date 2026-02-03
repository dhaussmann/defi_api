# Data Gap Analysis - normalized-data Endpoint

## Problem
Der `/api/normalized-data` Endpoint zeigt fehlende Daten zwischen 8. Januar - 30. Januar 2026 für BTC und andere Token.

## Root Cause Analysis

### 3-Datenbank-Architektur
Das System verwendet 3 separate D1-Datenbanken:
1. **DB_WRITE** (`defiapi-db-write`) - Für Schreiboperationen
2. **DB_READ** (`defiapi-db-read`) - Für Leseoperationen (wird vom API-Endpoint verwendet)
3. **DB** (`defiapi-db`) - Alte Backup-DB

### Datenverfügbarkeit pro Datenbank

#### DB_WRITE (defiapi-db-write)
- **Jan 2-8, 2026**: ✅ 131.523 Einträge vorhanden
- **Jan 9-29, 2026**: ❌ Keine Daten (System war nicht aktiv)
- **Jan 30 - Feb 2, 2026**: ✅ 46.431 Einträge vorhanden

#### DB_READ (defiapi-db-read)
- **Jan 1-8, 2026**: ✅ 176 Einträge für BTC
- **Jan 9-29, 2026**: ❌ Keine Daten
- **Jan 30-31, 2026**: ⚠️ Nur 2 Einträge (sollten ~48 sein)
- **Feb 1-2, 2026**: ❌ Fehlend

#### DB (defiapi-db) - Alte DB
- **Dez 19, 2025 - Jan 8, 2026**: ✅ 378 Einträge für BTC

### BTC Hyperliquid Datenverfügbarkeit (Stunden pro Tag)

**DB_READ:**
```
2026-01-01: 14 Stunden
2026-01-02: 24 Stunden ✓
2026-01-03: 24 Stunden ✓
2026-01-04: 24 Stunden ✓
2026-01-05: 24 Stunden ✓
2026-01-06: 24 Stunden ✓
2026-01-07: 24 Stunden ✓
2026-01-08: 16 Stunden
2026-01-09 bis 2026-01-29: KEINE DATEN ❌
2026-01-30: 0 Stunden (sollte 24 sein) ❌
2026-01-31: 2 Stunden (sollte 24 sein) ❌
```

**DB_WRITE:**
```
2026-01-02: 14 Stunden
2026-01-03: 24 Stunden ✓
2026-01-04: 24 Stunden ✓
2026-01-05: 24 Stunden ✓
2026-01-06: 24 Stunden ✓
2026-01-07: 24 Stunden ✓
2026-01-08: 16 Stunden
2026-01-09 bis 2026-01-29: KEINE DATEN ❌
2026-01-30: 6 Stunden
2026-01-31: 24 Stunden ✓
2026-02-01: 13 Stunden
```

## Lösungen

### 1. Fehlende Daten (Jan 9-29)
**Status**: ❌ **NICHT LÖSBAR**
- Das System war in diesem Zeitraum nicht aktiv
- Keine Daten in irgendeiner Datenbank vorhanden
- Historische Daten können nicht nachträglich generiert werden

**Empfehlung**: 
- Charts sollten die Lücke akzeptieren und visualisieren
- Frontend kann Lücken mit gestrichelten Linien oder Hinweisen darstellen

### 2. Fehlende Synchronisation (Jan 30 - Feb 2)
**Status**: ⚠️ **TEILWEISE LÖSBAR**

Die Daten existieren in DB_WRITE, müssen aber nach DB_READ synchronisiert werden.

**Anzahl zu synchronisierende Einträge**: 46.431

**Manuelle Synchronisation erforderlich**:
```bash
# Option 1: Verwende das bereitgestellte Python-Skript
python3 sync_db_write_to_read.py

# Option 2: Direktes SQL (für kleinere Batches)
# Export aus DB_WRITE und Import in DB_READ
```

**Problem mit aktuellem Sync-Skript**:
- Das Skript schlägt beim Export fehl (JSON-Parsing-Problem)
- Manuelle SQL-Migration erforderlich

### 3. Automatische Synchronisation einrichten

**Langfristige Lösung**: Cron-Job für DB-Synchronisation

Füge zum Cron-Job hinzu (alle 5 Minuten):
```typescript
// In src/index.ts, im 5-Minuten-Cron:
if (cronType === '*/5 * * * *') {
  // ... existing code ...
  
  // Sync recent data from DB_WRITE to DB_READ
  await syncRecentDataToRead(env);
}
```

Erstelle neue Funktion `syncRecentDataToRead`:
```typescript
async function syncRecentDataToRead(env: Env): Promise<void> {
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
  
  // Copy recent market_history data
  await env.DB_READ.prepare(`
    INSERT OR REPLACE INTO market_history 
    SELECT * FROM market_history 
    WHERE hour_timestamp >= ?
  `).bind(oneDayAgo).run();
  
  console.log('[Sync] Recent data synced to DB_READ');
}
```

**ACHTUNG**: Dies funktioniert nur, wenn beide DBs auf demselben Cloudflare-Account sind und Cross-DB-Queries unterstützt werden. Andernfalls ist eine Worker-basierte Lösung erforderlich.

## Zusammenfassung

### Datenlücken
| Zeitraum | Status | Lösung |
|----------|--------|---------|
| Jan 1-8 | ✅ Vorhanden | Keine Aktion nötig |
| Jan 9-29 | ❌ **Permanent fehlend** | Nicht wiederherstellbar |
| Jan 30 - Feb 2 | ⚠️ In DB_WRITE, nicht in DB_READ | Manuelle Synchronisation erforderlich |
| Ab Feb 2 | ✅ Vorhanden | Keine Aktion nötig |

### Nächste Schritte

1. **Sofort**: Manuelle Synchronisation von DB_WRITE → DB_READ für Jan 30 - Feb 2
2. **Kurzfristig**: Automatische Sync-Funktion implementieren
3. **Mittelfristig**: Frontend anpassen, um Datenlücken elegant darzustellen
4. **Langfristig**: Monitoring einrichten, um zukünftige Datenlücken zu vermeiden

## Technische Details

### Endpoint-Verhalten
Der `/api/normalized-data` Endpoint:
- Liest ausschließlich von **DB_READ**
- Verwendet `market_history` Tabelle für 1h-Intervalle
- Unterstützt flexible Zeitbereiche via `from`/`to` Parameter (Unix-Timestamps)

### Beispiel-Abfragen
```bash
# Korrekt (Unix-Timestamps):
curl "https://api.fundingrate.de/api/normalized-data?symbol=BTC&exchange=hyperliquid&from=1767348000&to=1767888000&limit=200"

# Falsch (ISO-Dates werden nicht unterstützt):
curl "https://api.fundingrate.de/api/normalized-data?symbol=BTC&exchange=hyperliquid&start=2026-01-08&end=2026-01-30"
```

### Datenbank-Befehle zur Verifikation
```bash
# Prüfe Daten in DB_READ
wrangler d1 execute defiapi-db-read --remote --command "
  SELECT COUNT(*) FROM market_history 
  WHERE symbol = 'BTC' AND exchange = 'hyperliquid' 
  AND hour_timestamp >= 1767348000 AND hour_timestamp <= 1769727600
"

# Prüfe Daten in DB_WRITE
wrangler d1 execute defiapi-db-write --remote --command "
  SELECT COUNT(*) FROM market_history 
  WHERE symbol = 'BTC' AND exchange = 'hyperliquid' 
  AND hour_timestamp >= 1767348000 AND hour_timestamp <= 1769727600
"
```

## Betroffene Token
**ALLE Token** sind von den Datenlücken betroffen, nicht nur BTC:
- Hyperliquid: 34.048 Einträge fehlen (Jan 9-29)
- Aster: 28.913 Einträge fehlen
- Lighter: 18.413 Einträge fehlen
- Paradex: 16.838 Einträge fehlen
- EdgeX: 13.224 Einträge fehlen
- Extended: 11.547 Einträge fehlen
- Pacifica: 6.787 Einträge fehlen
- Und weitere...

**Gesamt**: ~133.341 Einträge fehlen für Jan 9-29 (nicht wiederherstellbar)
