/**
 * V4 API Endpoints
 *
 * Current data from D1 unified_v4 (latest snapshot per symbol/exchange):
 *   GET /api/v4/markets                → all latest snapshots
 *   GET /api/v4/markets?exchange=X     → filter by exchange
 *   GET /api/v4/markets?symbol=BTC     → all exchanges for one symbol
 *   GET /api/v4/markets?type=stock     → filter by market type
 *   GET /api/v4/markets/latest         → best APR per symbol (one row per ticker)
 *
 * Historical data from Cloudflare Analytics Engine SQL API:
 *   GET /api/v4/history/{symbol}?exchange=X&from=UNIX&to=UNIX
 *
 * Moving Averages (from D1 funding_ma_v4 / AE v4_ma):
 *   GET /api/v4/ma/latest                → all symbols, all periods, latest MA (D1)
 *   GET /api/v4/ma/latest/{symbol}       → one symbol, all periods + exchanges (D1)
 *   GET /api/v4/ma/history/{symbol}      → MA history from AE (params: exchange, period, from, to, limit)
 *
 * Arbitrage:
 *   GET /api/v4/arbitrage                → best perp/perp spreads
 *     ?period=live                       → from unified_v4 live snapshot (default)
 *     ?period=1h|4h|8h|12h|1d|3d|7d|30d → from funding_ma_v4 MA averages
 *     ?exchange=X                        → only pairs that include exchange X
 *     ?type=crypto|stock|forex           → filter by market type (live only)
 *     ?minSpread=0.1                     → min spread APR (decimal, e.g. 0.1 = 10%)
 *     ?limit=100                         → max results (default 100, max 500)
 *
 * Admin:
 *   POST /api/v4/admin/migrate?offset=0&limit=50000  → V3→AE backfill single batch (requires X-Admin-Key header)
 *   POST /api/v4/admin/migrate/start                 → start background migration (self-chaining batches, no auth)
 *   POST /api/v4/admin/migrate/run                   → internal self-chain trigger (no auth)
 *   GET  /api/v4/admin/migrate/status                → poll migration progress
 *   GET  /api/v4/admin/debug[?exchange=X]            → dry-run collection, returns per-exchange status/count/sample/timing
 */

import { Env } from './types';
import { migrateV3ToAnalyticsEngine, debugCollectV4, getMigrationStatus, runMigrationBatch, MigrationStatus } from './v4Collector';

// ============================================================
// Route dispatcher
// ============================================================

export async function handleV4Request(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const searchParams = url.searchParams;

  // Admin endpoints
  if (path === '/api/v4/admin/migrate' && request.method === 'POST') {
    return handleAdminMigrate(request, env, searchParams);
  }

  if (path === '/api/v4/admin/migrate/start' && request.method === 'POST') {
    return handleMigrateStart(env, ctx);
  }

  if (path === '/api/v4/admin/migrate/run' && request.method === 'POST') {
    return handleMigrateRun(request, env, ctx);
  }

  if (path === '/api/v4/admin/migrate/status' && request.method === 'GET') {
    return handleMigrateStatus(env);
  }

  if (path === '/api/v4/admin/migrate/batch' && request.method === 'POST') {
    return handleMigrateBatch(request, env);
  }

  if (path === '/api/v4/admin/debug' && request.method === 'GET') {
    return handleAdminDebug(env, searchParams);
  }

  if (path === '/api/v4/admin/ae-count' && request.method === 'GET') {
    return handleAeCount(env);
  }

  // Read endpoints (GET only)
  if (request.method !== 'GET') {
    return jsonError('Method not allowed', 405);
  }

  if (path === '/api/v4/markets/latest') {
    return handleMarketsLatest(env, searchParams);
  }

  if (path.startsWith('/api/v4/history/')) {
    const symbol = path.replace('/api/v4/history/', '').toUpperCase();
    return handleHistory(env, symbol, searchParams);
  }

  if (path === '/api/v4/markets') {
    return handleMarkets(env, searchParams);
  }

  // MA endpoints
  if (path === '/api/v4/ma/latest') {
    return handleMaLatest(env, searchParams);
  }

  const maSymbolMatch = path.match(/^\/api\/v4\/ma\/latest\/([^/]+)$/);
  if (maSymbolMatch) {
    return handleMaLatestSymbol(env, maSymbolMatch[1].toUpperCase(), searchParams);
  }

  const maHistoryMatch = path.match(/^\/api\/v4\/ma\/history\/([^/]+)$/);
  if (maHistoryMatch) {
    return handleMaHistory(env, maHistoryMatch[1].toUpperCase(), searchParams);
  }

  if (path === '/api/v4/arbitrage') {
    return handleArbitrage(env, searchParams);
  }

  // /api/v4/markets/{symbol}
  const symbolMatch = path.match(/^\/api\/v4\/markets\/([^/]+)$/);
  if (symbolMatch) {
    const symbol = symbolMatch[1].toUpperCase();
    return handleMarketSymbol(env, symbol, searchParams);
  }

  return jsonError('Not found', 404);
}

// ============================================================
// GET /api/v4/markets
// ============================================================

async function handleMarkets(env: Env, params: URLSearchParams): Promise<Response> {
  const exchange = params.get('exchange');
  const symbol = params.get('symbol')?.toUpperCase();
  const type = params.get('type');
  const limit = Math.min(parseInt(params.get('limit') || '5000'), 10000);

  let query = 'SELECT * FROM unified_v4';
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (exchange) {
    conditions.push('exchange = ?');
    bindings.push(exchange);
  }
  if (symbol) {
    conditions.push('normalized_symbol = ?');
    bindings.push(symbol);
  }
  if (type) {
    conditions.push('market_type = ?');
    bindings.push(type);
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY funding_rate_apr DESC LIMIT ?';
  bindings.push(limit);

  const result = await env.DB_V4.prepare(query).bind(...bindings).all();
  return jsonSuccess({ data: result.results, count: result.results.length });
}

// ============================================================
// GET /api/v4/markets/latest
// ============================================================

async function handleMarketsLatest(env: Env, params: URLSearchParams): Promise<Response> {
  const type = params.get('type');
  const limit = Math.min(parseInt(params.get('limit') || '5000'), 10000);

  // One row per symbol: highest APR across all exchanges
  let query = `
    SELECT normalized_symbol, exchange, collected_at, funding_rate_apr,
           market_price, open_interest, max_leverage, volume_24h,
           spread_bid_ask, price_change_24h, market_type
    FROM unified_v4
  `;
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (type) {
    conditions.push('market_type = ?');
    bindings.push(type);
  }

  if (conditions.length) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY funding_rate_apr DESC LIMIT ?';
  bindings.push(limit);

  const result = await env.DB_V4.prepare(query).bind(...bindings).all();

  // Deduplicate: keep best APR per symbol
  const seen = new Map<string, any>();
  for (const row of result.results as any[]) {
    if (!seen.has(row.normalized_symbol)) {
      seen.set(row.normalized_symbol, row);
    }
  }

  const data = Array.from(seen.values());
  return jsonSuccess({ data, count: data.length });
}

// ============================================================
// GET /api/v4/markets/{symbol}
// ============================================================

async function handleMarketSymbol(env: Env, symbol: string, params: URLSearchParams): Promise<Response> {
  const exchange = params.get('exchange');
  let query = 'SELECT * FROM unified_v4 WHERE normalized_symbol = ?';
  const bindings: (string | number)[] = [symbol];

  if (exchange) {
    query += ' AND exchange = ?';
    bindings.push(exchange);
  }
  query += ' ORDER BY funding_rate_apr DESC';

  const result = await env.DB_V4.prepare(query).bind(...bindings).all();
  return jsonSuccess({ data: result.results, count: result.results.length, symbol });
}

// ============================================================
// GET /api/v4/history/{symbol}
// ============================================================

async function handleHistory(env: Env, symbol: string, params: URLSearchParams): Promise<Response> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    return jsonError('Analytics Engine credentials not configured', 503);
  }

  const exchange = params.get('exchange');
  const fromTs = params.get('from') ? parseInt(params.get('from')!) : Math.floor(Date.now() / 1000) - 86400 * 7;
  const toTs = params.get('to') ? parseInt(params.get('to')!) : Math.floor(Date.now() / 1000);
  const limit = Math.min(parseInt(params.get('limit') || '1000'), 10000);

  let sql = `
    SELECT
      blob1 AS ticker,
      blob2 AS exchange,
      blob3 AS market_type,
      double1 AS collected_at,
      double2 AS funding_rate_apr,
      double3 AS market_price,
      double4 AS open_interest,
      double5 AS max_leverage,
      double6 AS volume_24h,
      double7 AS spread_bid_ask,
      double8 AS price_change_24h
    FROM v4_markets
    WHERE blob1 = '${symbol.replace(/'/g, "''")}'
      AND double1 >= ${fromTs}
      AND double1 <= ${toTs}
  `;

  if (exchange) {
    sql += ` AND blob2 = '${exchange.replace(/'/g, "''")}'`;
  }

  sql += ` ORDER BY double1 DESC LIMIT ${limit}`;

  try {
    const aeResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.CF_API_TOKEN}`,
          'Content-Type': 'text/plain',
        },
        body: sql,
      }
    );

    if (!aeResponse.ok) {
      const err = await aeResponse.text();
      console.error('[V4 History] AE SQL error:', err);
      return jsonError('Analytics Engine query failed', 502);
    }

    const aeData = await aeResponse.json() as any;
    const rows = (aeData.data || []).map((row: any) => ({
      ticker: row.ticker,
      exchange: row.exchange,
      market_type: row.market_type,
      collected_at: row.collected_at,
      funding_rate_apr: row.funding_rate_apr,
      market_price: row.market_price || null,
      open_interest: row.open_interest || null,
      max_leverage: row.max_leverage || null,
      volume_24h: row.volume_24h || null,
      spread_bid_ask: row.spread_bid_ask || null,
      price_change_24h: row.price_change_24h || null,
    }));

    return jsonSuccess({ data: rows, count: rows.length, symbol, from: fromTs, to: toTs });
  } catch (e) {
    console.error('[V4 History] fetch error:', e);
    return jsonError('Failed to query Analytics Engine', 500);
  }
}

// ============================================================
// POST /api/v4/admin/migrate
// ============================================================

async function handleAdminMigrate(request: Request, env: Env, params: URLSearchParams): Promise<Response> {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return jsonError('Unauthorized', 401);
  }

  const offset = parseInt(params.get('offset') || '0');
  const limit = Math.min(parseInt(params.get('limit') || '50000'), 100000);

  try {
    const result = await migrateV3ToAnalyticsEngine(env, limit, offset);
    return jsonSuccess({
      ...result,
      message: result.hasMore
        ? `Migrated ${result.migrated} rows. Call again with offset=${result.nextOffset}`
        : `Migration complete. Migrated ${result.migrated} rows in this batch.`,
    });
  } catch (e) {
    console.error('[V4 Migrate] error:', e);
    return jsonError('Migration failed', 500);
  }
}

// ============================================================
// POST /api/v4/admin/migrate/start  — kick off background migration
// POST /api/v4/admin/migrate/run    — internal self-chain (no-op if not running)
// GET  /api/v4/admin/migrate/status — poll progress
// ============================================================

async function handleMigrateStart(env: Env, ctx?: ExecutionContext): Promise<Response> {
  const current = await getMigrationStatus(env);
  if (current.state === 'running') {
    return jsonSuccess({ message: 'Migration already running', status: current });
  }

  const status: MigrationStatus = {
    state: 'running',
    offset: 0,
    totalMigrated: 0,
    startedAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
  };
  await env.DB_V4.prepare(`
    INSERT OR REPLACE INTO migration_state (id, state, offset, total_migrated, started_at, updated_at, error)
    VALUES (1, 'running', 0, 0, ?, ?, NULL)
  `).bind(status.startedAt, status.updatedAt).run();

  const workerUrl = 'https://defiapi.cloudflareone-demo-account.workers.dev';
  if (ctx) {
    ctx.waitUntil(runMigrationBatch(env, workerUrl));
  } else {
    runMigrationBatch(env, workerUrl).catch(e => console.error('[V4 Migration] start error:', e));
  }

  return jsonSuccess({ message: 'Migration started', status });
}

async function handleMigrateRun(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const current = await getMigrationStatus(env);
  if (current.state !== 'running') {
    return jsonSuccess({ message: 'Not running', state: current.state });
  }

  const workerUrl = `${new URL(request.url).origin}`;
  if (ctx) {
    ctx.waitUntil(runMigrationBatch(env, workerUrl));
  } else {
    runMigrationBatch(env, workerUrl).catch(e => console.error('[V4 Migration] run error:', e));
  }

  return jsonSuccess({ message: 'Batch triggered' });
}

async function handleMigrateStatus(env: Env): Promise<Response> {
  const status = await getMigrationStatus(env);
  const now = Math.floor(Date.now() / 1000);
  const elapsedSec = status.startedAt ? now - status.startedAt : 0;
  const rowsPerSec = elapsedSec > 0 ? Math.round(status.totalMigrated / elapsedSec) : 0;

  return jsonSuccess({
    status,
    elapsed: `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`,
    rowsPerSec,
  });
}

// ============================================================
// POST /api/v4/admin/migrate/batch — write pre-fetched rows to AE (called from local script)
// Body: { rows: [{normalized_symbol, exchange, funding_time, rate_apr, open_interest}] }
// ============================================================

async function handleMigrateBatch(request: Request, env: Env): Promise<Response> {
  if (!env.V4_ANALYTICS) return jsonError('V4_ANALYTICS not bound', 500);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const rows: any[] = body.rows ?? [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return jsonError('rows must be a non-empty array', 400);
  }

  let written = 0;
  for (const row of rows) {
    try {
      env.V4_ANALYTICS.writeDataPoint({
        indexes: [`${row.normalized_symbol}:${row.exchange}`],
        blobs: [row.normalized_symbol, row.exchange, 'crypto'],
        doubles: [
          row.funding_time,
          row.rate_apr ?? 0,
          0, // market_price (not in V3)
          row.open_interest ?? 0,
          0, 0, 0, 0,
        ],
      });
      written++;
    } catch {}
  }

  return jsonSuccess({ written });
}

// ============================================================
// GET /api/v4/admin/ae-count — verify Analytics Engine row count
// ============================================================

async function handleAeCount(env: Env): Promise<Response> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    return jsonError('CF_ACCOUNT_ID / CF_API_TOKEN secrets not set', 503);
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'text/plain' },
        body: 'SELECT COUNT() AS total_rows, MIN(toDateTime(double1)) AS oldest, MAX(toDateTime(double1)) AS newest, COUNT(DISTINCT blob2) AS exchanges FROM v4_markets',
      }
    );
    if (!res.ok) {
      const err = await res.text();
      return jsonError(`AE query failed: ${err}`, 502);
    }
    const data = await res.json() as any;
    return jsonSuccess({ ae: data.data?.[0] ?? data });
  } catch (e: any) {
    return jsonError(`AE query error: ${e?.message}`, 500);
  }
}

// ============================================================
// GET /api/v4/admin/debug
// ============================================================

async function handleAdminDebug(env: Env, params: URLSearchParams): Promise<Response> {
  const exchangeFilter = params.get('exchange') || undefined;
  const t0 = Date.now();

  try {
    const results = await debugCollectV4(exchangeFilter);
    const ok = results.filter(r => r.status === 'ok');
    const empty = results.filter(r => r.status === 'empty');
    const failed = results.filter(r => r.status === 'error');
    const totalMarkets = ok.reduce((s, r) => s + r.count, 0);

    return jsonSuccess({
      summary: {
        totalExchanges: results.length,
        ok: ok.length,
        empty: empty.length,
        failed: failed.length,
        totalMarkets,
        totalDurationMs: Date.now() - t0,
      },
      exchanges: results,
    });
  } catch (e) {
    console.error('[V4 Debug] error:', e);
    return jsonError('Debug run failed', 500);
  }
}

// ============================================================
// GET /api/v4/ma/latest[?period=1h&exchange=X&limit=5000]
// ============================================================

async function handleMaLatest(env: Env, params: URLSearchParams): Promise<Response> {
  const period = params.get('period');
  const exchange = params.get('exchange');
  const limit = Math.min(parseInt(params.get('limit') || '5000'), 10000);

  let query = 'SELECT * FROM funding_ma_v4';
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (period) { conditions.push('period = ?'); bindings.push(period); }
  if (exchange) { conditions.push('exchange = ?'); bindings.push(exchange); }

  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY ma_apr DESC LIMIT ?';
  bindings.push(limit);

  const result = await env.DB_V4.prepare(query).bind(...bindings).all();
  return jsonSuccess({ data: result.results, count: result.results.length });
}

// ============================================================
// GET /api/v4/ma/latest/{symbol}
// ============================================================

async function handleMaLatestSymbol(env: Env, symbol: string, params: URLSearchParams): Promise<Response> {
  const exchange = params.get('exchange');

  let query = 'SELECT * FROM funding_ma_v4 WHERE normalized_symbol = ?';
  const bindings: (string | number)[] = [symbol];

  if (exchange) { query += ' AND exchange = ?'; bindings.push(exchange); }
  query += ' ORDER BY period, exchange';

  const result = await env.DB_V4.prepare(query).bind(...bindings).all();
  return jsonSuccess({ data: result.results, count: result.results.length, symbol });
}

// ============================================================
// GET /api/v4/ma/history/{symbol}  — from Analytics Engine v4_ma
// ============================================================

async function handleMaHistory(env: Env, symbol: string, params: URLSearchParams): Promise<Response> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    return jsonError('Analytics Engine credentials not configured', 503);
  }

  const exchange = params.get('exchange');
  const period = params.get('period');
  const fromTs = params.get('from') ? parseInt(params.get('from')!) : Math.floor(Date.now() / 1000) - 86400 * 30;
  const toTs = params.get('to') ? parseInt(params.get('to')!) : Math.floor(Date.now() / 1000);
  const limit = Math.min(parseInt(params.get('limit') || '500'), 5000);

  const symbolEsc = symbol.replace(/'/g, "''");
  let sql = `SELECT blob2 AS exchange, blob3 AS period, double1 AS calculated_at, double2 AS ma_apr, double3 AS data_points, double4 AS period_start FROM v4_ma WHERE blob1 = '${symbolEsc}' AND double1 >= ${fromTs} AND double1 <= ${toTs}`;
  if (exchange) sql += ` AND blob2 = '${exchange.replace(/'/g, "''")}'`;
  if (period) sql += ` AND blob3 = '${period.replace(/'/g, "''")}'`;
  sql += ` ORDER BY double1 DESC LIMIT ${limit}`;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
      { method: 'POST', headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'text/plain' }, body: sql }
    );
    if (!res.ok) { const err = await res.text(); return jsonError(`AE query failed: ${err}`, 502); }
    const aeData = await res.json() as any;
    const rows = (aeData.data || []).map((r: any) => ({
      exchange: r.exchange, period: r.period,
      calculated_at: Number(r.calculated_at), ma_apr: Number(r.ma_apr),
      data_points: Number(r.data_points), period_start: Number(r.period_start),
    }));
    return jsonSuccess({ data: rows, count: rows.length, symbol, from: fromTs, to: toTs });
  } catch (e: any) {
    return jsonError(`MA history query failed: ${e?.message}`, 500);
  }
}

// ============================================================
// GET /api/v4/arbitrage
// Finds best perp/perp spread pairs across all exchanges.
// period=live → uses unified_v4 (latest snapshot)
// period=1h..30d → uses funding_ma_v4 (MA averages, more stable)
// ============================================================

const MA_PERIODS = new Set(['1h', '4h', '8h', '12h', '1d', '3d', '7d', '30d']);

async function handleArbitrage(env: Env, params: URLSearchParams): Promise<Response> {
  const period = params.get('period') || 'live';
  const exchangeFilter = params.get('exchange')?.toLowerCase();
  const typeFilter = params.get('type');
  const minSpread = parseFloat(params.get('minSpread') || '0');
  const limit = Math.min(parseInt(params.get('limit') || '100'), 500);

  // Load rates per (symbol, exchange)
  const tickerRates = new Map<string, Array<{
    exchange: string;
    apr: number;
    openInterest: number | null;
    volume24h: number | null;
    marketPrice: number | null;
    marketType: string;
  }>>();

  if (period === 'live') {
    // Source: unified_v4 — latest snapshot
    let query = 'SELECT normalized_symbol, exchange, funding_rate_apr, open_interest, volume_24h, market_price, market_type FROM unified_v4';
    const conditions: string[] = [];
    const bindings: (string | number)[] = [];
    if (typeFilter) { conditions.push('market_type = ?'); bindings.push(typeFilter); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');

    const result = await env.DB_V4.prepare(query).bind(...bindings).all();
    for (const row of result.results as any[]) {
      const key = row.normalized_symbol as string;
      const list = tickerRates.get(key) ?? [];
      list.push({
        exchange: row.exchange,
        apr: row.funding_rate_apr ?? 0,
        openInterest: row.open_interest ?? null,
        volume24h: row.volume_24h ?? null,
        marketPrice: row.market_price ?? null,
        marketType: row.market_type ?? 'crypto',
      });
      tickerRates.set(key, list);
    }
  } else if (MA_PERIODS.has(period)) {
    // Source: funding_ma_v4 — MA averages (exclude _all cross-exchange rows)
    const result = await env.DB_V4.prepare(
      `SELECT normalized_symbol, exchange, ma_apr, data_points FROM funding_ma_v4
       WHERE period = ? AND exchange != '_all'`
    ).bind(period).all();

    for (const row of result.results as any[]) {
      const key = row.normalized_symbol as string;
      const list = tickerRates.get(key) ?? [];
      list.push({
        exchange: row.exchange,
        apr: row.ma_apr ?? 0,
        openInterest: null,
        volume24h: null,
        marketPrice: null,
        marketType: 'crypto',
      });
      tickerRates.set(key, list);
    }
  } else {
    return jsonError(`Invalid period. Use 'live' or one of: ${[...MA_PERIODS].join(', ')}`, 400);
  }

  // Find best pair per ticker
  const strategies: any[] = [];

  for (const [ticker, rates] of tickerRates) {
    if (rates.length < 2) continue;

    // If exchange filter: only keep tickers where that exchange appears
    if (exchangeFilter && !rates.some(r => r.exchange === exchangeFilter)) continue;

    // Find highest and lowest APR across all exchange pairs
    const sorted = [...rates].sort((a, b) => b.apr - a.apr);
    const short = sorted[0];
    const long = sorted[sorted.length - 1];

    if (short.exchange === long.exchange) continue;

    const spread = short.apr - long.apr;
    if (spread <= minSpread) continue;

    strategies.push({
      ticker,
      spread_apr: spread,
      short_exchange: short.exchange,
      short_apr: short.apr,
      long_exchange: long.exchange,
      long_apr: long.apr,
      // Live-only fields
      market_price: short.marketPrice ?? long.marketPrice,
      open_interest: short.openInterest ?? long.openInterest,
      volume_24h: short.volume24h ?? long.volume24h,
      market_type: short.marketType,
    });
  }

  // Sort by spread descending, return top N
  strategies.sort((a, b) => b.spread_apr - a.spread_apr);
  const data = strategies.slice(0, limit);

  return jsonSuccess({
    data,
    count: data.length,
    period,
    total_pairs: strategies.length,
  });
}

// ============================================================
// Helpers
// ============================================================

function jsonSuccess(data: object): Response {
  return new Response(JSON.stringify({ success: true, ...data }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
