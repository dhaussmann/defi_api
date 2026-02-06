# V3 Funding Rate Collectors

## Overview

V3 ist ein kompletter Neustart mit **einheitlicher Datenbankstruktur** für alle 4 Exchanges:
- Extended
- Hyperliquid
- Lighter
- Aster

## Key Features

### 1. Einheitliche Datenstruktur
Alle Exchanges verwenden das gleiche Schema mit:
- `rate_raw`: Original-Wert von der API
- `rate_raw_percent`: Immer in Prozent (konsistent)
- `interval_hours`: Funding-Intervall (1h, 4h, 8h)
- `rate_1h_percent`: Auf 1 Stunde normalisiert
- `rate_apr`: Annualisierte Rate (APR)

### 2. Direkte API-Zugriffe
- **Keine Proxy-URLs**
- Direkte Kommunikation mit Exchange-APIs
- Bessere Performance und Zuverlässigkeit

### 3. Batch Processing
- Import-Scripts verarbeiten Daten in Batches
- Verhindert Timeouts bei großen Datenmengen
- Optimiert für Cloudflare D1

### 4. API-gesteuerte Imports
- Import-Funktionen können über API-Endpoints getriggert werden
- Ermöglicht On-Demand Datenlücken-Füllung
- Flexibles Zeitfenster (z.B. letzte 7, 30 Tage)

## Directory Structure

```
v3_collectors/
├── README.md                 # Diese Datei
├── V3_SCHEMA.md             # Detaillierte Schema-Dokumentation
├── ExtendedCollector.ts     # Extended Collector & Import
├── HyperliquidCollector.ts  # Hyperliquid Collector & Import (TODO)
├── LighterCollector.ts      # Lighter Collector & Import (TODO)
└── AsterCollector.ts        # Aster Collector & Import (TODO)

v3_scripts/
├── create_tables.sql        # SQL für alle V3 Tabellen
├── import_extended.sh       # Extended Import Script
├── import_hyperliquid.sh    # Hyperliquid Import Script (TODO)
├── import_lighter.sh        # Lighter Import Script (TODO)
└── import_aster.sh          # Aster Import Script (TODO)
```

## Setup

### 1. Tabellen erstellen
```bash
npx wrangler d1 execute defiapi-db-write --remote --file=v3_scripts/create_tables.sql
```

### 2. Historische Daten importieren (Extended)
```bash
chmod +x v3_scripts/import_extended.sh
./v3_scripts/import_extended.sh 30  # Letzte 30 Tage
```

### 3. Collector in Cron-Job integrieren
```typescript
// In src/index.ts
import { collectExtendedV3 } from '../v3_collectors/ExtendedCollector';

// Im hourly cron (0 * * * *)
await collectExtendedV3(env);
```

## Rate Calculations

### Beispiel: Extended (1h Intervall)

API liefert: `fundingRate: "0.0001"` (Dezimal)

**Berechnungen:**
```typescript
rate_raw = 0.0001
rate_raw_percent = 0.0001 * 100 = 0.01%
interval_hours = 1
rate_1h_percent = 0.01 / 1 = 0.01%
rate_apr = 0.01 * (365 * 24) = 87.6%
```

### Beispiel: Aster (8h Intervall)

API liefert: `fundingRate: "0.0004"` (Dezimal)

**Berechnungen:**
```typescript
rate_raw = 0.0004
rate_raw_percent = 0.0004 * 100 = 0.04%
interval_hours = 8
rate_1h_percent = 0.04 / 8 = 0.005%
rate_apr = 0.04 * (365 * 24 / 8) = 43.8%
```

## API Endpoints (geplant)

```
GET  /api/v3/funding/extended
POST /api/v3/import/extended?days=30
GET  /api/v3/funding/hyperliquid
POST /api/v3/import/hyperliquid?days=30
GET  /api/v3/funding/lighter
POST /api/v3/import/lighter?days=30
GET  /api/v3/funding/aster
POST /api/v3/import/aster?days=30
```

## Status

- ✅ Extended: Collector + Import Script fertig
- ⏳ Hyperliquid: TODO
- ⏳ Lighter: TODO
- ⏳ Aster: TODO

## Migration von V2

V3 ist ein **kompletter Neustart**:
- V2 Tabellen bleiben unverändert
- V3 Tabellen sind neu und leer
- Import-Scripts füllen V3 Tabellen mit historischen Daten
- Collectors schreiben ab sofort in V3 Tabellen

**Kein automatisches Migrieren** - V3 startet mit frischen Daten.
