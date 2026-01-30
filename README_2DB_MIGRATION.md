# 2-Database Architecture - Quick Start Guide

## Problem
Mit ~1500 Markets: **D1 DB Overload** → "Too many requests queued"

## Lösung
2 separate Datenbanken für Last-Verteilung:
- **DB_WRITE**: Tracker writes (360k/Tag)
- **DB_READ**: API queries (häufig, cached)

## Setup (30 Minuten)

### 1. Datenbanken erstellen
Dashboard: https://dash.cloudflare.com → D1

Erstelle:
- `defiapi-db-write`
- `defiapi-db-read`

### 2. Setup-Script ausführen
```bash
./setup-2db-architecture.sh
```

Das Script:
- Fragt nach DB-IDs
- Updated wrangler.toml
- Führt Migrations aus

### 3. Code migrieren
```bash
./migrate-code-to-2db.sh
```

Dann manuell `src/index.ts` anpassen:
- API reads → `env.DB_READ`
- Tracker writes → `env.DB_WRITE`

### 4. Deploy
```bash
npm run deploy
```

### 5. Tracker neu starten
```bash
./restart-trackers.sh
```

## Dateien

- `docs/DB_ARCHITECTURE_PROPOSAL.md` - Vollständige Architektur
- `docs/DB_MIGRATION_GUIDE.md` - Detaillierte Anleitung
- `migrations/write/` - DB_WRITE Schema
- `migrations/read/` - DB_READ Schema
- `setup-2db-architecture.sh` - Automatisches Setup
- `migrate-code-to-2db.sh` - Code Migration
- `restart-trackers.sh` - Tracker Neustart

## Vorteile

✅ 80% weniger DB-Last pro Datenbank
✅ API-Queries blockieren nicht mehr Tracker-Writes
✅ Einfach erweiterbar auf 4-DB Architektur
✅ Minimale Code-Änderungen

## Rollback

```bash
cp wrangler.toml.backup wrangler.toml
npm run deploy
```
