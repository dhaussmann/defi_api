# DeFi API - Crypto Exchange Tracker

WebSocket-basierter Tracker für verschiedene Crypto-Börsen, implementiert mit Cloudflare Workers, Durable Objects und D1 Database.

## 🚀 Features

- **Automatischer Start** - Tracker startet automatisch beim ersten Request
- **Alle Token** - Empfängt Market Stats für alle verfügbaren Token auf Lighter Exchange
- **WebSocket-Verbindung** zu Lighter Exchange (erweiterbar für weitere Börsen)
- **Durable Objects** für persistente WebSocket-Verbindungen
- **15-Sekunden-Snapshots** zur Memory-effizienten Datenverarbeitung
- **D1 Database** für persistente Speicherung der Market Stats
- **REST API** zum Abrufen der gespeicherten Daten
- **Auto-Reconnect** bei Verbindungsabbrüchen
- **CORS-Support** für Frontend-Integration

## 📋 Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker (API)                  │
│  Routes: /api/*, /tracker/*, /                             │
└────────────┬────────────────────────────────────┬───────────┘
             │                                    │
             │                                    │
    ┌────────▼────────┐                  ┌────────▼──────────┐
    │ Durable Object  │                  │   D1 Database     │
    │ LighterTracker  │──────────────────▶│   defiapi-db     │
    │                 │   15s Snapshots   │                  │
    │ - WebSocket     │                   │ - market_stats   │
    │ - Data Buffer   │                   │ - tracker_status │
    └────────┬────────┘                   └──────────────────┘
             │
             │ WebSocket
             │
    ┌────────▼────────────────────────────────────────────────┐
    │   wss://mainnet.zklighter.elliot.ai/stream             │
    │   Lighter Exchange WebSocket API                        │
    └─────────────────────────────────────────────────────────┘
```

## 🛠️ Setup & Deployment

### 1. Cloudflare Authentication

Melden Sie sich bei Cloudflare Wrangler an:

```bash
npx wrangler login
```

Oder verwenden Sie einen API-Token:

```bash
export CLOUDFLARE_API_TOKEN=<ihr-cloudflare-api-token>
```

Einen API-Token können Sie hier erstellen:
https://developers.cloudflare.com/fundamentals/api/get-started/create-token/

### 2. D1 Datenbank erstellen

Erstellen Sie die D1-Datenbank:

```bash
npx wrangler d1 create defiapi-db
```

Kopieren Sie die `database_id` aus der Ausgabe und aktualisieren Sie `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "defiapi-db"
database_id = "IHRE-DATABASE-ID-HIER"  # <-- Hier eintragen
```

### 3. Datenbank-Schema anwenden

Wenden Sie die Migrations auf die Remote-Datenbank an:

```bash
npx wrangler d1 migrations apply defiapi-db --remote
```

### 4. Worker deployen

Deployen Sie den Worker:

```bash
npm run deploy
```

Oder mit Wrangler direkt:

```bash
npx wrangler deploy
```

Nach erfolgreichem Deployment erhalten Sie eine URL wie:
`https://defiapi.your-subdomain.workers.dev`

### 5. Tracker startet automatisch! 🎉

Der Tracker startet **automatisch** beim ersten Request an die API. Sie müssen **keinen** manuellen `/tracker/start` Befehl ausführen!

Rufen Sie einfach die API auf und der Tracker beginnt mit der Datensammlung:

```bash
# Tracker wird automatisch gestartet beim ersten API-Call
curl https://defiapi.your-subdomain.workers.dev/api/latest
```

## 📡 API Endpoints

### Tracker Control

#### `POST /tracker/start`
Startet die WebSocket-Verbindung zum Lighter Exchange manuell (optional, da automatischer Start aktiv ist).

```bash
curl -X POST https://defiapi.your-subdomain.workers.dev/tracker/start
```

Response:
```json
{
  "success": true,
  "message": "WebSocket connection started",
  "status": "running"
}
```

#### `POST /tracker/stop`
Stoppt die WebSocket-Verbindung.

```bash
curl -X POST https://defiapi.your-subdomain.workers.dev/tracker/stop
```

#### `GET /tracker/status`
Zeigt den aktuellen Status der WebSocket-Verbindung im Durable Object.

```bash
curl https://defiapi.your-subdomain.workers.dev/tracker/status
```

Response:
```json
{
  "success": true,
  "data": {
    "connected": true,
    "reconnectAttempts": 0,
    "bufferSize": 3,
    "bufferedSymbols": ["ETH", "BTC", "SOL"]
  }
}
```

### Data API

#### `GET /api/latest`
Ruft die neuesten Market Stats für alle Symbole ab.

```bash
curl https://defiapi.your-subdomain.workers.dev/api/latest
```

Query-Parameter:
- `exchange` - Exchange-Name (default: "lighter")
- `symbol` - Symbol filtern (z.B. "ETH")

Beispiel:
```bash
curl "https://defiapi.your-subdomain.workers.dev/api/latest?symbol=ETH"
```

#### `GET /api/stats`
Ruft Market Stats mit erweiterten Filter-Optionen ab.

Query-Parameter:
- `exchange` - Exchange-Name (default: "lighter")
- `symbol` - Symbol filtern (optional)
- `from` - Start-Timestamp in Millisekunden (optional)
- `to` - End-Timestamp in Millisekunden (optional)
- `limit` - Maximale Anzahl Ergebnisse (default: 100)

Beispiele:
```bash
# Letzte 50 Stats für ETH
curl "https://defiapi.your-subdomain.workers.dev/api/stats?symbol=ETH&limit=50"

# Stats in einem Zeitraum
curl "https://defiapi.your-subdomain.workers.dev/api/stats?from=1700000000000&to=1700100000000"
```

#### `GET /api/status`
Zeigt den Tracker-Status aus der Datenbank.

```bash
curl https://defiapi.your-subdomain.workers.dev/api/status
```

## 🗂️ Projekt-Struktur

```
defi_api/
├── src/
│   ├── index.ts              # Worker Entry Point & API Routes
│   ├── LighterTracker.ts     # Durable Object für WebSocket
│   └── types.ts              # TypeScript Type Definitions
├── migrations/
│   └── 0001_initial_schema.sql  # D1 Database Schema
├── package.json
├── tsconfig.json
├── wrangler.toml            # Cloudflare Worker Configuration
└── README.md
```

## 🔄 Workflow

1. **Auto-Start**: Tracker startet automatisch beim ersten API-Request
2. **WebSocket-Subscription**: Subscription zu `market_stats/all` für alle verfügbaren Token
3. **Data Collection**: Durable Object empfängt market_stats über WebSocket
4. **Buffering**: Daten werden im Memory gebuffert (Map mit Symbol als Key)
5. **Snapshots**: Alle 15 Sekunden werden die Daten in D1 gespeichert
6. **Memory Cleanup**: Nach dem Speichern wird der Buffer geleert
7. **API Access**: Daten können über `/api/*` abgerufen werden
8. **Auto-Reconnect**: Bei Verbindungsabbruch automatisches Wiederverbinden (max. 10 Versuche)

## 📊 Datenbank-Schema

### `market_stats` Tabelle
Speichert alle Market Statistics von den Exchanges.

Wichtige Felder:
- `exchange` - Name der Exchange (z.B. "lighter")
- `symbol` - Trading-Symbol (z.B. "ETH")
- `market_id` - Market-ID auf der Exchange
- `index_price`, `mark_price`, `last_trade_price` - Preis-Informationen
- `funding_rate`, `current_funding_rate` - Funding-Rate-Informationen
- `open_interest` - Open Interest
- `daily_*` - Tägliche Statistiken (Volume, High, Low, Change)
- `recorded_at` - Timestamp des Snapshots in Millisekunden
- `created_at` - Timestamp der DB-Erstellung in Sekunden

### `tracker_status` Tabelle
Speichert den Status der Tracker für jede Exchange.

## 🔧 Entwicklung

### Lokale Entwicklung

```bash
npm run dev
```

Dies startet einen lokalen Entwicklungsserver mit:
- Local D1 Database
- Local Durable Objects
- Hot Reloading

### Logs anzeigen

```bash
npm run tail
```

Oder mit Wrangler:
```bash
npx wrangler tail
```

### Neue Migration erstellen

```bash
npx wrangler d1 migrations create defiapi-db migration_name
```

### Migration auf lokale DB anwenden

```bash
npx wrangler d1 migrations apply defiapi-db --local
```

## 🔮 Erweiterung für weitere Börsen

Um weitere Exchanges hinzuzufügen:

1. Neue Durable Object Class erstellen (z.B. `BinanceTracker.ts`)
2. In `wrangler.toml` die neue Durable Object registrieren
3. WebSocket-Logik für die neue Exchange implementieren
4. API-Routes in `src/index.ts` erweitern
5. Bei Bedarf Schema in `migrations/` erweitern

Beispiel für neue Exchange:

```typescript
// src/BinanceTracker.ts
export class BinanceTracker implements DurableObject {
  // Ähnliche Implementierung wie LighterTracker
  // aber mit Binance WebSocket API
}
```

```toml
# wrangler.toml
[durable_objects]
bindings = [
  { name = "LIGHTER_TRACKER", class_name = "LighterTracker" },
  { name = "BINANCE_TRACKER", class_name = "BinanceTracker" }
]
```

## ⚙️ Konfiguration

In `wrangler.toml` können Sie folgende Einstellungen anpassen:

```toml
[vars]
SNAPSHOT_INTERVAL_MS = "15000"  # Snapshot-Intervall in Millisekunden
```

## 📝 Lizenz

MIT

## 🤝 Contributing

Pull Requests sind willkommen! Für größere Änderungen öffnen Sie bitte zuerst ein Issue.
