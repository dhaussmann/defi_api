# V4 API — Developer Documentation

**Last updated:** March 2026
**Worker:** `defiapi` (Cloudflare Workers)
**Branch:** `claude/crypto-exchange-tracker-BWsZt`

---

## Table of Contents

1. [Overview & V3 vs V4 Comparison](#1-overview--v3-vs-v4-comparison)
2. [Architecture](#2-architecture)
3. [Data Structures](#3-data-structures)
4. [Storage Layer](#4-storage-layer)
5. [Data Collection Pipeline](#5-data-collection-pipeline)
6. [Moving Average System](#6-moving-average-system)
7. [API Endpoints](#7-api-endpoints)
8. [Arbitrage Logic](#8-arbitrage-logic)
9. [KV Cache Layer](#9-kv-cache-layer)
10. [Historical Migration (V3 → AE)](#10-historical-migration-v3--ae)
11. [Key Files](#11-key-files)
12. [Environment Bindings](#12-environment-bindings)

---

## 1. Overview & V3 vs V4 Comparison

### What V4 Adds

V4 is a richer, parallel market data system running alongside V3. V3 continues to operate unchanged.

| Feature | V3 | V4 |
|---|---|---|
| **Data fields** | Funding rate, OI only | + Market price, leverage, volume, spread, 24h change, market type |
| **Market types** | Crypto only | crypto, stock, forex, etf, index, commodity |
| **Exchanges** | ~13 exchanges | 25 exchanges |
| **Moving averages** | 3d, 7d, 14d, 30d (via D1 aggregation) | 1h, 4h, 8h, 12h, 1d, 3d, 7d, 30d (via Analytics Engine) |
| **Time-series storage** | D1 `unified_v3` (7.5M rows, slow at scale) | Cloudflare Analytics Engine (unlimited, fast) |
| **Latest snapshot** | D1 `unified_v3` (latest flag) | D1 `unified_v4` (separate table, one row per symbol/exchange) |
| **Collection frequency** | Every 5 minutes | Every 5 minutes |
| **Arbitrage endpoint** | `/api/v3/arbitrage` | `/api/v4/arbitrage` (live + MA-based) |
| **Historical queries** | D1 (slow past ~1M rows) | Analytics Engine SQL API (fast, 3-month retention) |
| **HTTP library** | axios (Node.js) | native `fetch` (Cloudflare Workers compatible) |

### V3 is NOT replaced

V3 endpoints (`/api/v3/*`) remain fully functional. V4 is additive. Do not modify V3 code when working on V4.

---

## 2. Architecture

```
Every 5 minutes (*/5 * * * * cron)
│
├─→ collectV4Markets(env)          [src/v4Collector.ts]
│     For each of 25 exchanges:
│       ├─→ fetch market data (native fetch, no axios)
│       ├─→ writeDataPoint() → Analytics Engine "v4_markets"  (fire-and-forget)
│       └─→ DB_V4.batch() → D1 unified_v4  (upsert latest snapshot)
│
└─→ calculateV4MAs(env)            [src/v4MA.ts]
      For each of 8 periods (1h–30d):
        ├─→ AE SQL API → avg(funding_rate_apr) GROUP BY ticker, exchange
        ├─→ writeDataPoint() → Analytics Engine "v4_ma"  (fire-and-forget)
        └─→ DB_V4.batch() → D1 funding_ma_v4  (upsert latest MA)


API request → index.ts → handleV4Request()  [src/v4Api.ts]
  ├─→ /api/v4/markets*     → D1 unified_v4 query
  ├─→ /api/v4/ma/*         → D1 funding_ma_v4 query  (or AE for history)
  ├─→ /api/v4/arbitrage    → D1 unified_v4 or funding_ma_v4 query
  └─→ /api/v4/history/*    → Analytics Engine SQL API
```

### Dual-write pattern

Every collection run writes to **two** places simultaneously:
- **Analytics Engine** (AE): time-series history, fire-and-forget via `writeDataPoint()`, no `await` needed
- **D1 `unified_v4`**: latest snapshot only (one row per symbol/exchange), updated via `INSERT OR REPLACE`

API reads always go to D1 for current data (fast), and to AE only for historical queries.

---

## 3. Data Structures

### UnifiedMarketData (collection interface)

Defined in `src/v4ExchangeServices.ts`. All exchange collectors return this type.

```typescript
interface UnifiedMarketData {
  ticker: string;                        // Normalized, uppercase, no suffix (e.g. 'BTC', 'ETH')
  marketPrice: number | null;            // Mark price in USD
  fundingRateAPR: number;                // Annualized funding rate (decimal, e.g. 0.876 = 87.6%)
  openInterest: number | null;           // Open Interest in USD
  maxLeverage: number | null;            // Maximum leverage available
  volume24h: number | null;              // 24h trading volume in USD
  spreadBidAsk: number | null;           // Bid/ask spread as percentage
  marketPriceChangePercent24h: number | null;  // 24h price change %
  marketType: MarketType;                // See classification below
}

type MarketType = 'crypto' | 'stock' | 'forex' | 'etf' | 'index' | 'commodity';
```

### MarketType Classification

Classification is done automatically in `getMarketType(ticker)` in `v4ExchangeServices.ts`:

```typescript
const stockMarkets  = new Set(['mstr', 'nvda', 'tsla', 'coin', 'aapl', ...]);
const forexMarkets  = new Set(['eur', 'gbp', 'jpy', 'cad', ...]);
const commodityMarkets = new Set(['xau', 'xag']);
const indexMarkets  = new Set(['ndx', 'spx', 'xyz']);
const etfMarkets    = new Set(['spy', 'qqq', 'gld', ...]);
// Default: 'crypto'
```

Tickers are lowercased before lookup. If not in any set → `'crypto'`.

### Analytics Engine Schema: `v4_markets`

Written via `writeDataPoint()` in `v4Collector.ts`. AE supports up to 20 blobs + 20 doubles.

| Field | AE slot | Type | Description |
|---|---|---|---|
| `ticker:exchange` | `indexes[0]` | string | Composite index key |
| ticker | `blobs[0]` | string | e.g. `'BTC'` |
| exchange | `blobs[1]` | string | e.g. `'hyperliquid'` |
| market_type | `blobs[2]` | string | `'crypto'`, `'stock'`, etc. |
| collected_at | `doubles[0]` | number | Unix seconds |
| funding_rate_apr | `doubles[1]` | number | Annualized rate (decimal) |
| market_price | `doubles[2]` | number | USD |
| open_interest | `doubles[3]` | number | USD |
| max_leverage | `doubles[4]` | number | |
| volume_24h | `doubles[5]` | number | USD |
| spread_bid_ask | `doubles[6]` | number | % |
| price_change_24h | `doubles[7]` | number | % |

**Reading from AE** (SQL API via `fetch` to `https://api.cloudflare.com/client/v4/accounts/{id}/analytics_engine/sql`):
```sql
SELECT blob1 AS ticker, blob2 AS exchange, blob3 AS market_type,
       double1 AS collected_at, double2 AS funding_rate_apr,
       double3 AS market_price, double4 AS open_interest,
       double5 AS max_leverage, double6 AS volume_24h
FROM v4_markets
WHERE blob1 = 'BTC' AND double1 >= 1770000000
ORDER BY double1 DESC LIMIT 1000
```

**Important:** The AE SQL API requires `Content-Type: text/plain` with the raw SQL as body (NOT JSON-wrapped). This tripped us up during development.

### D1 Schema: `unified_v4` (DB_V4)

One row per `(normalized_symbol, exchange)`. Replaced on every collection run.

```sql
CREATE TABLE unified_v4 (
  normalized_symbol TEXT NOT NULL,
  exchange          TEXT NOT NULL,
  collected_at      INTEGER NOT NULL,   -- Unix seconds
  funding_rate_apr  REAL,
  market_price      REAL,               -- USD
  open_interest     REAL,               -- USD
  max_leverage      REAL,
  volume_24h        REAL,               -- USD
  spread_bid_ask    REAL,               -- %
  price_change_24h  REAL,               -- %
  market_type       TEXT NOT NULL DEFAULT 'crypto',
  PRIMARY KEY (normalized_symbol, exchange)
);
```

### D1 Schema: `funding_ma_v4` (DB_V4)

One row per `(normalized_symbol, exchange, period)`. Updated every 5 minutes.

```sql
CREATE TABLE funding_ma_v4 (
  normalized_symbol TEXT NOT NULL,
  exchange          TEXT NOT NULL,  -- exchange name, or '_all' for cross-exchange aggregate
  period            TEXT NOT NULL,  -- '1h','4h','8h','12h','1d','3d','7d','30d'
  ma_apr            REAL,           -- average funding_rate_apr over the period
  data_points       INTEGER NOT NULL,
  period_start      INTEGER NOT NULL, -- oldest data point included (unix seconds)
  calculated_at     INTEGER NOT NULL, -- when this MA was computed (unix seconds)
  PRIMARY KEY (normalized_symbol, exchange, period)
);
```

The special exchange value `'_all'` stores the cross-exchange aggregate (all exchanges combined for that ticker).

### D1 Schema: `migration_state` (DB_V4)

Single-row table tracking V3→AE backfill progress.

```sql
CREATE TABLE migration_state (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  state          TEXT NOT NULL DEFAULT 'idle',  -- idle|running|done|error
  offset         INTEGER NOT NULL DEFAULT 0,    -- funding_time cursor (NOT row offset)
  total_migrated INTEGER NOT NULL DEFAULT 0,
  started_at     INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL DEFAULT 0,
  error          TEXT
);
```

---

## 4. Storage Layer

### Database architecture

V4 uses a **dedicated D1 database** (`defiapi-v4-markets`, binding: `DB_V4`) to isolate load from V3.

| Database | Binding | Purpose |
|---|---|---|
| `defiapi-v4-markets` | `DB_V4` | V4 latest snapshots (`unified_v4`), MA (`funding_ma_v4`), migration state |
| `defiapi-unified-funding` | `DB_UNIFIED` | V3 historical data (`unified_v3`) — READ ONLY for V4 migration |
| `defiapi-db-write` | `DB_WRITE` | V3 collection writes (not used by V4) |
| `defiapi-db-read` | `DB_READ` | V3 API reads (not used by V4) |

### Analytics Engine datasets

| Dataset name | Binding | Purpose |
|---|---|---|
| `v4_markets` | `V4_ANALYTICS` | Raw market data time-series (all collection runs) |
| `v4_ma` | `V4_MA_ANALYTICS` | MA history (calculated every 5 minutes) |

**AE retention:** 3 months. After 3 months data is automatically deleted.
**AE write pattern:** Always fire-and-forget — never `await writeDataPoint()`.

### KV Cache

Binding: `CACHE`. API responses are cached with TTL:

| Endpoint | TTL |
|---|---|
| `/api/v4/markets` | 300s |
| `/api/v4/markets/latest` | 300s |
| `/api/v4/ma/latest` | 300s |
| `/api/v4/arbitrage` | 300s |

Cache key = `{prefix}:{sorted_query_params}`. Cache is bypassed for POST/admin endpoints.

---

## 5. Data Collection Pipeline

### File: `src/v4Collector.ts`

**Entry point:** `collectV4Markets(env: Env): Promise<void>`

Called from the `*/5 * * * *` cron in `index.ts` via `ctx.waitUntil()`:
```typescript
ctx.waitUntil(collectV4Markets(env).catch(e => console.error('[Cron] V4 collection error:', e)));
ctx.waitUntil(calculateV4MAs(env).catch(e => console.error('[Cron] V4 MA error:', e)));
```

**Flow per exchange:**
1. Call exchange collector function (returns `UnifiedMarketData[]`)
2. `writeToAnalyticsEngine(env, exchange, markets)` — fire-and-forget AE writes
3. `upsertV4Snapshot(env, exchange, markets)` — D1 batch upsert in chunks of 100

**D1 upsert pattern:**
```typescript
const stmt = env.DB_V4.prepare(`INSERT OR REPLACE INTO unified_v4 (...) VALUES (...)`);
// Chunk into batches of 100 (D1 batch limit)
await env.DB_V4.batch(batch.map(m => stmt.bind(...)));
```

### File: `src/v4ExchangeServices.ts`

Contains one `collect*()` function per exchange. All use native `fetch` (no axios).

**25 exchanges:**
hyperliquid, paradex, lighter, edgex, ethereal, extended, asterdex, variational, reya, pacifica, backpack, vest, tradexyz, drift, evedex, apex, arkm, dydx, aevo, 01, nado, grvt, astros, standx, hibachi

**Funding rate annualization — critical to get right:**

| Exchange interval | Annualization formula |
|---|---|
| 1-hour (e.g. Nado, Pacifica) | `rate * 24 * 365` |
| 8-hour (e.g. Hyperliquid, Paradex) | `rate * 3 * 365` |
| Already APR | No conversion needed |

**Notable exchange quirks:**
- **Lighter**: Uses REST API (`/orderBooks` + `/fundings`), not WebSocket. Batches funding requests in groups of 20.
- **Extended**: Requires `User-Agent` header (blocks bots without it → HTTP 403).
- **Nado**: 1-hour funding interval — multiply by `24 * 365`, not just `365`.
- **EdgeX**: Currently returns 0 markets (API endpoint issue, not yet fixed).

**Adding a new exchange:**
1. Add `collectMyExchange(): Promise<UnifiedMarketData[]>` to `v4ExchangeServices.ts`
2. Add `{ key: 'myexchange', fn: collectMyExchange }` to `EXCHANGE_COLLECTORS` in `v4Collector.ts`
3. That's it — collection, AE write, D1 upsert, and API exposure are automatic

---

## 6. Moving Average System

### File: `src/v4MA.ts`

**Entry point:** `calculateV4MAs(env: Env): Promise<void>`

### Design decision: direct computation, not cascading

MAs are computed **directly from raw AE data** for each period independently. We do NOT compute 4h MA from 1h MA values. This avoids error accumulation and gives accurate results even when some collection runs fail.

### 8 MA periods

```typescript
const PERIODS = [
  { name: '1h',  seconds: 3_600,     minPoints: 1  },
  { name: '4h',  seconds: 14_400,    minPoints: 2  },
  { name: '8h',  seconds: 28_800,    minPoints: 2  },
  { name: '12h', seconds: 43_200,    minPoints: 3  },
  { name: '1d',  seconds: 86_400,    minPoints: 3  },
  { name: '3d',  seconds: 259_200,   minPoints: 6  },
  { name: '7d',  seconds: 604_800,   minPoints: 12 },
  { name: '30d', seconds: 2_592_000, minPoints: 48 },
];
```

`minPoints` prevents MAs from being calculated when there's insufficient data (prevents misleading values during early operation).

### Calculation: AE SQL query

For each period, two AE SQL queries run in parallel:

**Per-exchange MA:**
```sql
SELECT blob1 AS ticker, blob2 AS exchange,
       avg(double2) AS ma_apr, count() AS data_points, min(double1) AS period_start
FROM v4_markets
WHERE double1 >= {now - periodSeconds} AND double1 <= {now}
GROUP BY blob1, blob2
HAVING count() >= {minPoints}
```

**Cross-exchange aggregate (exchange = `'_all'`):**
```sql
SELECT blob1 AS ticker,
       avg(double2) AS ma_apr, count() AS data_points, min(double1) AS period_start
FROM v4_markets
WHERE double1 >= {now - periodSeconds} AND double1 <= {now}
GROUP BY blob1
HAVING count() >= {minPoints}
```

Results are written to both AE `v4_ma` (history) and D1 `funding_ma_v4` (latest, for fast API reads).

### Analytics Engine Schema: `v4_ma`

| Field | AE slot | Description |
|---|---|---|
| `ticker:exchange:period` | `indexes[0]` | Composite key |
| ticker | `blobs[0]` | |
| exchange | `blobs[1]` | exchange name or `'_all'` |
| period | `blobs[2]` | `'1h'`, `'1d'`, etc. |
| calculated_at | `doubles[0]` | Unix seconds |
| ma_apr | `doubles[1]` | The moving average value |
| data_points | `doubles[2]` | Number of raw data points averaged |
| period_start | `doubles[3]` | Oldest data point included |

### Data availability timeline

| Period | Meaningful data after |
|---|---|
| 1h | ~1 hour of collection |
| 1d | ~1 day |
| 7d | ~7 days |
| 30d | ~30 days (full data March 2026+) |

---

## 7. API Endpoints

All V4 endpoints are handled in `src/v4Api.ts` via `handleV4Request()`.

### Market Data

#### `GET /api/v4/markets`
Latest snapshots from D1 `unified_v4`.

| Parameter | Type | Description |
|---|---|---|
| `exchange` | string | Filter by exchange name |
| `symbol` | string | Filter by ticker (e.g. `BTC`) |
| `type` | string | Filter by market type (`crypto`, `stock`, etc.) |
| `limit` | number | Max results (default 5000, max 10000) |

Response:
```json
{
  "success": true,
  "data": [
    {
      "normalized_symbol": "BTC",
      "exchange": "hyperliquid",
      "collected_at": 1773057000,
      "funding_rate_apr": 0.4123,
      "market_price": 67500.0,
      "open_interest": 1250000000,
      "max_leverage": 50,
      "volume_24h": 450000000,
      "spread_bid_ask": 0.02,
      "price_change_24h": 1.5,
      "market_type": "crypto"
    }
  ],
  "count": 1
}
```

#### `GET /api/v4/markets/latest`
Best APR per symbol (one row per ticker, deduplicated).

#### `GET /api/v4/markets/{symbol}`
All exchanges for a specific symbol. Optional `?exchange=X` filter.

#### `GET /api/v4/history/{symbol}`
Historical time-series from Analytics Engine.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `exchange` | string | all | Filter by exchange |
| `from` | Unix seconds | now-7d | Start of range |
| `to` | Unix seconds | now | End of range |
| `limit` | number | 1000 | Max rows (max 10000) |

### Moving Averages

#### `GET /api/v4/ma/latest`
All latest MAs from D1 `funding_ma_v4`.

| Parameter | Type | Description |
|---|---|---|
| `period` | string | Filter by period (`1h`, `4h`, `8h`, `12h`, `1d`, `3d`, `7d`, `30d`) |
| `exchange` | string | Filter by exchange (use `_all` for cross-exchange aggregate) |
| `limit` | number | Max results (default 5000, max 10000) |

#### `GET /api/v4/ma/latest/{symbol}`
All periods and exchanges for a single symbol.

#### `GET /api/v4/ma/history/{symbol}`
Historical MA values from Analytics Engine `v4_ma`.

| Parameter | Default | Description |
|---|---|---|
| `period` | all | Filter by period |
| `exchange` | all | Filter by exchange |
| `from` | now-30d | Unix seconds |
| `to` | now | Unix seconds |
| `limit` | 500 | Max rows (max 5000) |

### Arbitrage

#### `GET /api/v4/arbitrage`

Finds best perp/perp spread pairs. Sorted by `spread_apr` descending.

| Parameter | Default | Description |
|---|---|---|
| `period` | `live` | `live` = from `unified_v4`; or `1h`/`4h`/`8h`/`12h`/`1d`/`3d`/`7d`/`30d` = from `funding_ma_v4` |
| `exchange` | all | Only pairs including this exchange |
| `type` | all | Market type filter (live only) |
| `minSpread` | `0` | Minimum spread APR (decimal, e.g. `0.1` = 10%) |
| `limit` | `100` | Max results (max 500) |

Response:
```json
{
  "success": true,
  "data": [
    {
      "ticker": "BTC",
      "spread_apr": 0.85,
      "short_exchange": "paradex",
      "short_apr": 1.20,
      "long_exchange": "hyperliquid",
      "long_apr": 0.35,
      "market_price": 67500.0,
      "open_interest": 1250000000,
      "volume_24h": 450000000,
      "market_type": "crypto"
    }
  ],
  "count": 1,
  "period": "live",
  "total_pairs": 142
}
```

**MA-based arbitrage** (`period=7d`) is more stable than live — filters out short-lived rate spikes.

### Admin Endpoints

#### `GET /api/v4/admin/debug[?exchange=X]`
Dry-run collection for all (or one) exchange. Returns per-exchange status, count, timing, and sample data. No writes to AE or D1.

#### `GET /api/v4/admin/ae-count`
Queries AE for total row count, oldest/newest timestamps, and exchange count in `v4_markets`.

#### `GET /api/v4/admin/migrate/status`
Returns current V3→AE migration progress.

#### `POST /api/v4/admin/migrate/batch`
Writes pre-fetched V3 rows to AE. Used by the local migration script. Body: `{ rows: [{normalized_symbol, exchange, funding_time, rate_apr, open_interest}] }`.

---

## 8. Arbitrage Logic

The arbitrage algorithm (in `handleArbitrage()` in `v4Api.ts`):

1. **Load rates**: Query either `unified_v4` (live) or `funding_ma_v4` (MA period) — all rows, no exchange filter yet
2. **Group by ticker**: Build a `Map<ticker, [{exchange, apr, ...}]>`
3. **Apply exchange filter**: If `?exchange=X`, skip tickers where X doesn't appear
4. **Find best pair per ticker**:
   - Sort exchanges by APR descending
   - Short = highest APR (receives funding payments)
   - Long = lowest APR (pays less)
   - `spread = short.apr - long.apr`
   - Skip if same exchange or spread ≤ minSpread
5. **Sort by spread descending**, return top N

```
spread_apr = short_exchange.funding_rate_apr - long_exchange.funding_rate_apr
Profitable when: spread_apr > 0
```

For profit simulation: `yearly_profit = position_size * spread_apr`
(See `docs/navix_arbitrage_logic_dokumentation.docx.md` for full profit calculation details)

---

## 9. KV Cache Layer

File: `src/kvCache.ts`

**Function `withCache()`** wraps any handler with transparent caching:
```typescript
return await withCache(env, path, url.searchParams, () => handleV4Request(request, env, ctx));
```

Cache key = `{prefix}:{sorted_query_params_as_string}`.
Example: `v4-arb:exchange=hyperliquid&period=7d`

Cache is only applied for certain paths — checked via `v4Cached` boolean in `index.ts`:
```typescript
const v4Cached = path === '/api/v4/markets'
  || path === '/api/v4/markets/latest'
  || path === '/api/v4/ma/latest'
  || path === '/api/v4/arbitrage';
```

Adding a new cached endpoint: add it to `CACHE_CONFIGS` in `kvCache.ts` AND to the `v4Cached` check in `index.ts`.

---

## 10. Historical Migration (V3 → AE)

The V3 database (`unified_v3`, 7.5M rows) is being backfilled into Analytics Engine `v4_markets` so historical queries work from day one.

### Why this is complex

- D1 is CPU-limited per request — can't process large `SELECT` with `OFFSET` on a 4GB table
- Solution: **cursor-based pagination** using `WHERE funding_time > {last_cursor}` + index
- AE has no batch REST write API — writes must go through a Worker (`writeDataPoint()`)
- Worker CPU limits prevent doing both the D1 read and AE write in one request

### Local migration script: `scripts/migrate_local.py`

The recommended approach. Runs on your Mac, bypasses Worker CPU limits entirely:

```
Local machine (Python script)
  └─→ wrangler d1 execute (reads 2000 rows from unified_v3 via wrangler CLI)
        └─→ POST /api/v4/admin/migrate/batch (Worker writes rows to AE)
              └─→ writeDataPoint() × 2000 (fire-and-forget in Worker)
```

```bash
python3 scripts/migrate_local.py
# Ctrl+C to pause, re-run to resume from saved cursor
```

State is saved to D1 `migration_state` every 10 batches. Progress visible at `GET /api/v4/admin/migrate/status`.

### Cursor-based pagination detail

The `offset` field in `migration_state` stores the last `funding_time` value seen (a Unix timestamp), NOT a row count. This is critical:

```sql
-- Fast (uses index idx_unified_v3_time_rate):
SELECT ... FROM unified_v3 WHERE funding_time > {cursor} ORDER BY funding_time ASC LIMIT 2000

-- Slow (avoids — scans N rows to skip):
SELECT ... FROM unified_v3 ORDER BY funding_time ASC LIMIT 2000 OFFSET 1800000
```

---

## 11. Key Files

| File | Purpose |
|---|---|
| `src/v4Collector.ts` | Collection orchestration, AE writes, D1 upserts, migration logic |
| `src/v4ExchangeServices.ts` | 25 exchange collector functions (fetch-based) |
| `src/v4MA.ts` | Moving average calculation and storage |
| `src/v4Api.ts` | All V4 HTTP endpoint handlers |
| `src/kvCache.ts` | KV cache layer (shared with V3) |
| `src/index.ts` | Worker entry point, cron handlers, route dispatch |
| `src/types.ts` | `Env` interface with all bindings |
| `wrangler.toml` | Worker config, bindings, cron schedules |
| `migrations/create_unified_v4.sql` | D1 schema for `unified_v4` |
| `migrations/create_funding_ma_v4.sql` | D1 schema for `funding_ma_v4` |
| `scripts/migrate_local.py` | Local backfill script (V3 → AE) |
| `scripts/run_v4_migration.sh` | Old shell-based migration script (superseded by Python script) |

---

## 12. Environment Bindings

All bindings are declared in `src/types.ts` `Env` interface and `wrangler.toml`.

| Binding | Type | Purpose |
|---|---|---|
| `DB_V4` | `D1Database` | V4 latest snapshots + MA + migration state |
| `DB_UNIFIED` | `D1Database` | V3 historical data (read-only for V4 migration) |
| `V4_ANALYTICS` | `AnalyticsEngineDataset` | AE write binding for `v4_markets` |
| `V4_MA_ANALYTICS` | `AnalyticsEngineDataset` | AE write binding for `v4_ma` |
| `CF_ACCOUNT_ID` | `string` (secret) | Cloudflare account ID for AE SQL API reads |
| `CF_API_TOKEN` | `string` (secret) | API token for AE SQL API reads |
| `ADMIN_KEY` | `string` (secret) | Auth for `POST /api/v4/admin/migrate` (single-batch) |
| `CACHE` | `KVNamespace` | KV cache (shared with V3) |

**Secrets** are set via `wrangler secret put CF_ACCOUNT_ID` etc. — not in `wrangler.toml`.

### Cron schedule

```
*/5 * * * *   V4 collection + V4 MA + V3 collection + token updates
0   * * * *   Hourly V3 aggregation + cleanup
5   * * * *   V3 daily MA periods
10  * * * *   V3 24h moving averages
15  * * * *   V3 arbitrage opportunities
20  * * * *   KV cache warmup
```

V4 collection and MA calculation both run in the `*/5` cron via `ctx.waitUntil()`, running in parallel in the background.
