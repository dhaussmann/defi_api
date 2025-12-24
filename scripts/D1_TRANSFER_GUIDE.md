# D1 zu D1 Funding Rate Transfer Guide

Schnellanleitung für den Transfer historischer Funding Rates zwischen zwei Cloudflare D1 Datenbanken.

## Voraussetzungen

- ✅ Zugriff auf beide D1 Datenbanken (Quelle und Ziel)
- ✅ `wrangler` CLI installiert und authentifiziert
- ✅ `jq` installiert (für JSON parsing)

## Datenbank-IDs finden

### Quell-Datenbank (funding-rate-collector)

```bash
# Liste alle D1 Datenbanken auf
npx wrangler d1 list

# Oder prüfe wrangler.toml im funding-rate-collector Projekt
cat ../funding-rate-collector/wrangler.toml | grep -A 2 "d1_databases"
```

**Beispiel Output:**
```
┌──────────────────────────────────────┬─────────────────────┬─────────────┐
│ database_id                          │ name                │ created_at  │
├──────────────────────────────────────┼─────────────────────┼─────────────┤
│ abc123-4567-8901-2345-6789abcdef     │ funding-rates-db    │ 2024-12-01  │
└──────────────────────────────────────┴─────────────────────┴─────────────┘
```

## Schritt-für-Schritt Transfer

### 1️⃣ Daten aus Quell-DB exportieren

```bash
# Mit Datenbank-Namen (einfacher)
./scripts/export-from-d1.sh funding-rates-db

# ODER mit Datenbank-ID
./scripts/export-from-d1.sh abc123-4567-8901-2345-6789abcdef
```

**Was passiert:**
- Script prüft Verfügbarkeit der Daten
- Exportiert alle Records ab 01.01.2025
- Erstellt `funding-import.sql` Datei
- Zeigt Statistiken und Vorschau

**Erwartete Ausgabe:**
```
=== Funding Rate D1 to D1 Export ===

Source Database: funding-rates-db
Output File: funding-import.sql

Step 1: Checking data availability...
✓ Found 45231 records

Step 2: Exporting data...
Exporting data (this may take a few minutes)...
✓ Exported 45231 INSERT statements

Step 3: Export Summary
  Output file: funding-import.sql
  File size: 12M
  Records: 45231
```

### 2️⃣ Export-Datei prüfen (optional)

```bash
# Zeige erste Zeilen
head -20 funding-import.sql

# Zeige letzte Zeilen
tail -10 funding-import.sql

# Zähle INSERT Statements
grep -c "^INSERT" funding-import.sql

# Datei-Größe
ls -lh funding-import.sql
```

### 3️⃣ In Ziel-DB importieren

```bash
npx wrangler d1 execute defiapi-db --remote --file=funding-import.sql
```

**Erwartete Ausgabe:**
```
🌀 Executing on remote database defiapi-db (77ba166f-0989-45d4-aa63-dc4ff0d517cb):
🌀 Starting import...
🌀 Processed 45231 queries.
🚣 Executed 45231 queries in 45.2 seconds (45231 rows written)
```

**⏱️ Geschätzte Dauer:**
- 10.000 Records: ~10 Sekunden
- 50.000 Records: ~45 Sekunden
- 100.000 Records: ~90 Sekunden

### 4️⃣ Import verifizieren

```bash
# Gesamtanzahl prüfen
npx wrangler d1 execute defiapi-db --remote --command "
  SELECT COUNT(*) as total_records FROM funding_rate_history
"

# Pro Exchange
npx wrangler d1 execute defiapi-db --remote --command "
  SELECT
    exchange,
    COUNT(*) as records,
    MIN(datetime(collected_at/1000, 'unixepoch')) as earliest,
    MAX(datetime(collected_at/1000, 'unixepoch')) as latest
  FROM funding_rate_history
  GROUP BY exchange
  ORDER BY records DESC
"

# Top 10 Tokens
npx wrangler d1 execute defiapi-db --remote --command "
  SELECT
    symbol,
    COUNT(*) as records,
    COUNT(DISTINCT exchange) as exchanges
  FROM funding_rate_history
  GROUP BY symbol
  ORDER BY records DESC
  LIMIT 10
"
```

## Troubleshooting

### Problem: "Database not found"

**Lösung:**
```bash
# Prüfe verfügbare Datenbanken
npx wrangler d1 list

# Verwende exakte Datenbank-ID statt Namen
./scripts/export-from-d1.sh <database-id>
```

### Problem: "Table unified_funding_rates does not exist"

**Grund:** Falsche Quell-Datenbank ausgewählt

**Lösung:**
```bash
# Prüfe Tabellen in der Datenbank
npx wrangler d1 execute <db-name> --remote --command "
  SELECT name FROM sqlite_master WHERE type='table'
"
```

### Problem: Import schlägt mit CPU Timeout fehl

**Lösung 1:** Export-Limit erhöhen und in kleinere Dateien aufteilen

Editiere `scripts/export-from-d1.sh`, Zeile mit `LIMIT`:
```bash
# Ändere von
LIMIT 100000;

# Zu (z.B. 25.000 Records pro Export)
LIMIT 25000;
```

Dann mehrere Exports mit WHERE Clauses:
```bash
# Export 1: Erste 25k Records
# Export 2: Nächste 25k Records (ändere OFFSET in Script)
# usw.
```

**Lösung 2:** Batch-Import mit Pausen
```bash
# Teile große SQL-Datei
split -l 5000 funding-import.sql funding-part-

# Importiere Teile einzeln mit Pausen
for file in funding-part-*; do
  echo "Importing $file..."
  npx wrangler d1 execute defiapi-db --remote --file="$file"
  sleep 10  # 10 Sekunden Pause
done
```

### Problem: Duplikate verhindern

**Bereits gelöst!** Das Script verwendet `INSERT OR IGNORE`, was bedeutet:
- Existierende Records werden übersprungen
- Keine Fehler bei Duplikaten
- Sicheres Re-Run bei Fehlern

**Manuell prüfen:**
```bash
# Prüfe auf Duplikate
npx wrangler d1 execute defiapi-db --remote --command "
  SELECT exchange, symbol, collected_at, COUNT(*) as count
  FROM funding_rate_history
  GROUP BY exchange, symbol, collected_at
  HAVING count > 1
"
```

## Alternative: Direkter SQL-Query Export/Import

Falls das Script nicht funktioniert, hier die manuelle Methode:

### Export
```bash
npx wrangler d1 execute funding-rates-db --remote --command "
  SELECT * FROM unified_funding_rates
  WHERE exchange IN ('hyperliquid', 'lighter', 'aster', 'paradex')
    AND collected_at >= 1735689600000
  LIMIT 1000
" --json > export.json
```

### Daten transformieren (mit jq)
```bash
cat export.json | jq -r '
  .[0].results[] |
  "INSERT OR IGNORE INTO funding_rate_history VALUES (" +
  "null, " +
  "\"" + .exchange + "\", " +
  "\"" + .symbol + "\", " +
  "\"" + .trading_pair + "\", " +
  (.funding_rate | tostring) + ", " +
  (.funding_rate_percent | tostring) + ", " +
  (.annualized_rate | tostring) + ", " +
  (.collected_at | tostring) + ");"
' > manual-import.sql
```

### Import
```bash
npx wrangler d1 execute defiapi-db --remote --file=manual-import.sql
```

## Performance-Tipps

1. **Größere Batches:** Erhöhe LIMIT im Export-Script für weniger, größere Dateien
2. **Lokale Entwicklung:** Teste erst mit `--local` vor `--remote`
3. **Off-Peak Hours:** Führe große Imports außerhalb der Hauptnutzungszeiten durch
4. **Monitoring:** Beobachte D1 Dashboard während Import

## Support & Debugging

### Logs prüfen
```bash
# Wrangler Logs
ls -la ~/.wrangler/logs/

# Letztes Log anzeigen
cat ~/.wrangler/logs/wrangler-$(ls -t ~/.wrangler/logs/ | head -1)
```

### D1 Dashboard
Öffne: https://dash.cloudflare.com/ → D1 → defiapi-db

### Hilfreiche Commands
```bash
# Tabellen-Info
npx wrangler d1 execute defiapi-db --remote --command "
  PRAGMA table_info(funding_rate_history)
"

# Index-Info
npx wrangler d1 execute defiapi-db --remote --command "
  SELECT * FROM sqlite_master WHERE type='index' AND tbl_name='funding_rate_history'
"

# Datei-Größe der DB
npx wrangler d1 info defiapi-db
```

## Nächste Schritte nach Import

1. ✅ **API-Endpunkt erstellen** für historische Funding Rate Abfragen
2. ✅ **Visualisierung** der Funding Rate Trends über Zeit
3. ✅ **Alerts** bei anomalen Funding Rates
4. ✅ **Export-Features** für Nutzer (CSV, JSON)

---

**Erstellt:** 2025-12-24
**Autor:** DeFi API Team
**Version:** 1.0
