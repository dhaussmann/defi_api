# Funding Rate Historical Data Import

Dieses Dokument beschreibt den Import-Prozess für historische Funding Rate Daten aus dem [funding-rate-collector](https://github.com/dhaussmann/funding-rate-collector) Repository.

## Übersicht

Die historischen Daten werden in eine separate Tabelle `funding_rate_history` importiert, die speziell für Zeitreihen-Analysen optimiert ist.

### Datenquellen

- **Exchanges**: Hyperliquid, Lighter, Aster, Paradex
- **Zeitraum**: Ab 1. Januar 2025
- **Frequenz**: Stündliche Snapshots
- **Format**: Millisekunden-Timestamps

## Schritt-für-Schritt Import

### 1. Tabelle erstellen (bereits erledigt ✅)

```bash
npx wrangler d1 execute defiapi-db --remote --file=migrations/0009_create_funding_rate_history.sql
```

### 2. Daten exportieren (D1 zu D1)

Da die Quelldatenbank auch eine Cloudflare D1 Datenbank ist, verwenden wir das Shell-Script für den direkten Export:

```bash
./scripts/export-from-d1.sh <source-database-name-or-id> [output-file]
```

**Beispiel:**
```bash
# Mit Datenbank-Namen
./scripts/export-from-d1.sh funding-rates-db

# Mit Datenbank-ID
./scripts/export-from-d1.sh 12345678-1234-1234-1234-123456789abc

# Mit benutzerdefiniertem Output-Dateinamen
./scripts/export-from-d1.sh funding-rates-db my-export.sql
```

Das Script:
- ✅ Prüft automatisch die Anzahl verfügbarer Records
- ✅ Liest alle Daten ab 01.01.2025 (Timestamp: 1735689600000 ms)
- ✅ Filtert auf die 4 Exchanges (hyperliquid, lighter, aster, paradex)
- ✅ Generiert INSERT OR IGNORE Statements (verhindert Duplikate)
- ✅ Zeigt Export-Statistiken und nächste Schritte
- ✅ Limit: 100.000 Records pro Export (kann erweitert werden)

### 3. Daten importieren

**WICHTIG**: Der Import kann je nach Datenmenge mehrere Minuten dauern. Die Datenbank ist während des Imports nicht verfügbar.

```bash
npx wrangler d1 execute defiapi-db --remote --file=funding-import.sql
```

### 4. Import verifizieren

Prüfe, ob die Daten korrekt importiert wurden:

```bash
npx wrangler d1 execute defiapi-db --remote --command "SELECT COUNT(*) as total FROM funding_rate_history"
```

Zeige Statistiken pro Exchange:

```bash
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
```

## Datenbank-Schema

```sql
CREATE TABLE funding_rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange TEXT NOT NULL,                -- hyperliquid, lighter, aster, paradex
  symbol TEXT NOT NULL,                  -- Normalisiert: BTC, ETH, SOL, etc.
  trading_pair TEXT NOT NULL,            -- Original: BTC-PERP, BTCUSDT, etc.
  funding_rate REAL NOT NULL,            -- Dezimal: 0.000125
  funding_rate_percent REAL NOT NULL,    -- Prozent: 0.0125
  annualized_rate REAL NOT NULL,         -- APR: 13.6875
  collected_at INTEGER NOT NULL,         -- Millisekunden

  UNIQUE(exchange, symbol, collected_at)
);
```

## Verwendung der importierten Daten

### API-Endpunkt für historische Daten (geplant)

```
GET /api/funding-history?symbol=BTC&exchange=hyperliquid&from=<timestamp>&to=<timestamp>
```

### Beispiel-Queries

**Durchschnittliche Funding Rate für BTC über alle Exchanges (letzte 7 Tage):**
```sql
SELECT
  exchange,
  AVG(annualized_rate) as avg_apr,
  COUNT(*) as samples
FROM funding_rate_history
WHERE symbol = 'BTC'
  AND collected_at > (strftime('%s', 'now') - 7*24*60*60) * 1000
GROUP BY exchange
ORDER BY avg_apr DESC;
```

**Top 10 Tokens nach durchschnittlicher Funding Rate:**
```sql
SELECT
  symbol,
  AVG(annualized_rate) as avg_apr,
  COUNT(DISTINCT exchange) as exchanges,
  COUNT(*) as samples
FROM funding_rate_history
WHERE collected_at > (strftime('%s', 'now') - 24*60*60) * 1000
GROUP BY symbol
HAVING exchanges >= 2
ORDER BY avg_apr DESC
LIMIT 10;
```

## Datenqualität

### Zeitstempel-Format

- **Quelldaten**: Millisekunden (`Date.now()`)
- **Speicherung**: Millisekunden (`INTEGER`)
- **Abfrage**: Division durch 1000 für SQL datetime: `datetime(collected_at/1000, 'unixepoch')`

### Funding Rate Formate

| Format | Beispiel | Beschreibung |
|--------|----------|--------------|
| `funding_rate` | 0.000125 | Dezimalformat (roh) |
| `funding_rate_percent` | 0.0125 | Prozent (× 100) |
| `annualized_rate` | 13.6875 | Jahresrate (× 100 × 3 × 365) |

**Formel**: `annualized_rate = funding_rate × 100 × 3 × 365`
- × 100 = Dezimal zu Prozent
- × 3 = Drei 8-Stunden-Perioden pro Tag
- × 365 = Tage pro Jahr

### Exchange-spezifische Unterschiede

#### Lighter
- ⚠️ **Besonderheit**: Funding Rate bereits als Prozent von API (0.0012 = 0.0012%)
- Im funding-rate-collector wurde dies korrekt behandelt
- Die importierten Daten sind bereits korrekt normalisiert

#### Hyperliquid, Aster, Paradex
- Standard-Dezimalformat (0.0001 = 0.01%)

## Troubleshooting

### Import schlägt fehl (CPU Timeout)

Falls der Import wegen CPU-Limits fehlschlägt:

1. **Datei aufteilen**: Teile die SQL-Datei in kleinere Chunks:
   ```bash
   split -l 10000 funding-import.sql funding-import-part-
   ```

2. **Sequenziell importieren**:
   ```bash
   for file in funding-import-part-*; do
     echo "Importing $file..."
     npx wrangler d1 execute defiapi-db --remote --file="$file"
     sleep 5  # Pause zwischen Imports
   done
   ```

### Duplikate vermeiden

Das Script verwendet `INSERT OR IGNORE` um Duplikate automatisch zu überspringen. Die `UNIQUE(exchange, symbol, collected_at)` Constraint verhindert doppelte Einträge.

### Daten aktualisieren

Um neue Daten hinzuzufügen, führe einfach das Export-Script erneut aus. Das Script exportiert alle Daten ab 01.01.2025, aber die UNIQUE Constraint stellt sicher, dass nur neue Daten eingefügt werden.

## Performance-Optimierung

### Indizes

Die Tabelle hat folgende Indizes für schnelle Abfragen:

```sql
-- Zeitbasierte Abfragen
CREATE INDEX idx_funding_history_time
  ON funding_rate_history(collected_at);

-- Symbol + Exchange Lookups
CREATE INDEX idx_funding_history_symbol_exchange
  ON funding_rate_history(symbol, exchange);
```

### Empfohlene Query-Patterns

**✅ Gut** - Nutzt Indizes:
```sql
WHERE symbol = 'BTC' AND exchange = 'hyperliquid'
  AND collected_at BETWEEN ? AND ?
```

**❌ Langsam** - Keine Indizes:
```sql
WHERE annualized_rate > 50  -- Kein Index auf annualized_rate
```

## Nächste Schritte

1. ✅ Tabelle erstellt
2. 🔄 Daten exportieren (führe das Script aus)
3. 🔄 Daten importieren
4. 📊 API-Endpunkt für historische Abfragen erstellen
5. 📈 Dashboard/Visualisierung implementieren

## Support

Bei Fragen oder Problemen:
- Prüfe die Logs: `.wrangler/logs/`
- Teste Queries lokal zuerst
- Verwende `--local` für Tests statt `--remote`
