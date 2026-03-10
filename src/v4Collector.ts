/**
 * V4 Market Data Collector
 *
 * Orchestrates collection from all 26 exchanges and dual-writes to:
 * 1. Cloudflare Analytics Engine (v4_markets dataset) — time-series, all history
 * 2. D1 unified_v4 table — latest snapshot per symbol/exchange, for fast API queries
 */

import { Env } from './types';
import { UnifiedMarketData } from './v4ExchangeServices';
import {
  collectHyperliquid,
  collectParadex,
  collectLighter,
  collectEdgeX,
  collectEthereal,
  collectExtended,
  collectAsterdex,
  collectVariational,
  collectReya,
  collectPacifica,
  collectBackpack,
  collectVest,
  collectTradeXYZ,
  collectDrift,
  collectEvedex,
  collectApex,
  collectArkm,
  collectDydx,
  collectAevo,
  collectZeroOne,
  collectNado,
  collectGrvt,
  collectAstros,
  collectStandX,
  collectHibachi,
} from './v4ExchangeServices';

interface ExchangeCollector {
  key: string;
  fn: () => Promise<UnifiedMarketData[]>;
}

const EXCHANGE_COLLECTORS: ExchangeCollector[] = [
  { key: 'hyperliquid', fn: collectHyperliquid },
  { key: 'paradex', fn: collectParadex },
  { key: 'lighter', fn: collectLighter },
  { key: 'edgex', fn: collectEdgeX },
  { key: 'ethereal', fn: collectEthereal },
  { key: 'extended', fn: collectExtended },
  { key: 'asterdex', fn: collectAsterdex },
  { key: 'variational', fn: collectVariational },
  { key: 'reya', fn: collectReya },
  { key: 'pacifica', fn: collectPacifica },
  { key: 'backpack', fn: collectBackpack },
  { key: 'vest', fn: collectVest },
  { key: 'tradexyz', fn: collectTradeXYZ },
  { key: 'drift', fn: collectDrift },
  { key: 'evedex', fn: collectEvedex },
  { key: 'apex', fn: collectApex },
  { key: 'arkm', fn: collectArkm },
  { key: 'dydx', fn: collectDydx },
  { key: 'aevo', fn: collectAevo },
  { key: '01', fn: collectZeroOne },
  { key: 'nado', fn: collectNado },
  { key: 'grvt', fn: collectGrvt },
  { key: 'astros', fn: collectAstros },
  { key: 'standx', fn: collectStandX },
  { key: 'hibachi', fn: collectHibachi },
];

export interface V4DebugResult {
  exchange: string;
  status: 'ok' | 'empty' | 'error';
  count: number;
  durationMs: number;
  error?: string;
  sample?: UnifiedMarketData[];
}

/**
 * Debug collection run — returns per-exchange results without writing to AE/D1
 * Called from GET /api/v4/admin/debug
 */
export async function debugCollectV4(exchangeFilter?: string): Promise<V4DebugResult[]> {
  const collectors = exchangeFilter
    ? EXCHANGE_COLLECTORS.filter(c => c.key === exchangeFilter)
    : EXCHANGE_COLLECTORS;

  const results: V4DebugResult[] = [];

  for (const { key, fn } of collectors) {
    const t0 = Date.now();
    try {
      const markets = await fn();
      results.push({
        exchange: key,
        status: markets.length === 0 ? 'empty' : 'ok',
        count: markets.length,
        durationMs: Date.now() - t0,
        sample: markets.slice(0, 3),
      });
    } catch (e: any) {
      results.push({
        exchange: key,
        status: 'error',
        count: 0,
        durationMs: Date.now() - t0,
        error: String(e?.message ?? e),
      });
    }
  }

  return results;
}

/**
 * Main V4 collection entry point — called from cron every 5 minutes
 * All exchanges collected in parallel to avoid Worker CPU timeout.
 */
export async function collectV4Markets(env: Env): Promise<void> {
  // Fetch all exchanges in parallel
  const results = await Promise.allSettled(
    EXCHANGE_COLLECTORS.map(({ key, fn }) =>
      fn().then(markets => ({ key, markets }))
    )
  );

  let totalMarkets = 0;
  let failedExchanges = 0;
  const d1Writes: Promise<void>[] = [];

  for (const result of results) {
    if (result.status === 'rejected') {
      failedExchanges++;
      console.error(`[V4] exchange failed:`, result.reason);
      continue;
    }
    const { key, markets } = result.value;
    if (markets.length === 0) {
      console.log(`[V4] ${key}: 0 markets (empty response)`);
      continue;
    }

    // Write to Analytics Engine (fire-and-forget)
    writeToAnalyticsEngine(env, key, markets);

    // Queue D1 upsert
    d1Writes.push(upsertV4Snapshot(env, key, markets));

    console.log(`[V4] ${key}: ${markets.length} markets`);
    totalMarkets += markets.length;
  }

  // Wait for all D1 writes to complete
  await Promise.allSettled(d1Writes);

  console.log(`[V4] Collection complete: ${totalMarkets} markets from ${EXCHANGE_COLLECTORS.length - failedExchanges}/${EXCHANGE_COLLECTORS.length} exchanges`);
}

/**
 * Write market data to Analytics Engine (fire-and-forget, max 250 per batch)
 */
function writeToAnalyticsEngine(env: Env, exchange: string, markets: UnifiedMarketData[]): void {
  if (!env.V4_ANALYTICS) return;

  const now = Math.floor(Date.now() / 1000);

  for (const m of markets) {
    try {
      env.V4_ANALYTICS.writeDataPoint({
        indexes: [`${m.ticker}:${exchange}`],
        blobs: [m.ticker, exchange, m.marketType],
        doubles: [
          now,
          m.fundingRateAPR ?? 0,
          m.marketPrice ?? 0,
          m.openInterest ?? 0,
          m.maxLeverage ?? 0,
          m.volume24h ?? 0,
          m.spreadBidAsk ?? 0,
          m.marketPriceChangePercent24h ?? 0,
        ],
      });
    } catch {}
  }
}

/**
 * Upsert latest snapshot to D1 unified_v4 (one row per symbol/exchange)
 * Uses D1 batch API in chunks of 100 to avoid CPU limits
 */
async function upsertV4Snapshot(env: Env, exchange: string, markets: UnifiedMarketData[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const stmt = env.DB_V4.prepare(`
    INSERT OR REPLACE INTO unified_v4
      (normalized_symbol, exchange, collected_at, funding_rate_apr,
       market_price, open_interest, max_leverage, volume_24h,
       spread_bid_ask, price_change_24h, market_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Chunk into batches of 100 (D1 batch limit)
  const BATCH_SIZE = 100;
  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE);
    try {
      await env.DB_V4.batch(
        batch.map(m =>
          stmt.bind(
            m.ticker.toUpperCase(),
            exchange,
            now,
            m.fundingRateAPR ?? null,
            m.marketPrice ?? null,
            m.openInterest ?? null,
            m.maxLeverage ?? null,
            m.volume24h ?? null,
            m.spreadBidAsk ?? null,
            m.marketPriceChangePercent24h ?? null,
            m.marketType,
          )
        )
      );
    } catch (e) {
      console.error(`[V4] D1 batch failed for ${exchange} (offset ${i}):`, e);
    }
  }
}

/**
 * Write V3 historical data to Analytics Engine for backfill migration
 * Called from admin endpoint POST /api/v4/admin/migrate
 */
export async function migrateV3ToAnalyticsEngine(
  env: Env,
  limit: number,
  cursor: number  // funding_time cursor — fetch rows WHERE funding_time > cursor
): Promise<{ migrated: number; nextOffset: number; hasMore: boolean }> {
  // Cursor-based pagination avoids OFFSET scan (O(n) → O(log n) via index)
  const rows = await env.DB_UNIFIED.prepare(
    'SELECT normalized_symbol, exchange, funding_time, rate_apr, open_interest FROM unified_v3 WHERE funding_time > ? ORDER BY funding_time ASC LIMIT ?'
  ).bind(cursor, limit).all();

  const results = rows.results as any[];
  if (!results.length) {
    return { migrated: 0, nextOffset: cursor, hasMore: false };
  }

  if (env.V4_ANALYTICS) {
    for (const row of results) {
      try {
        env.V4_ANALYTICS.writeDataPoint({
          indexes: [`${row.normalized_symbol}:${row.exchange}`],
          blobs: [row.normalized_symbol, row.exchange, 'crypto'],
          doubles: [
            row.funding_time,    // collected_at (unix seconds)
            row.rate_apr ?? 0,   // funding_rate_apr
            0,                   // market_price (not in V3)
            row.open_interest ?? 0,
            0, 0, 0, 0,          // max_leverage, volume_24h, spread, price_change
          ],
        });
      } catch {}
    }
  }

  const lastRow = results[results.length - 1] as any;
  return {
    migrated: results.length,
    nextOffset: lastRow.funding_time,  // cursor = last funding_time seen
    hasMore: results.length === limit,
  };
}

// ============================================================
// Background migration with D1 state tracking (avoids KV write limits)
// ============================================================

const BATCH_SIZE = 500;

export interface MigrationStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  offset: number;
  totalMigrated: number;
  startedAt: number;
  updatedAt: number;
  error?: string;
}

export async function getMigrationStatus(env: Env): Promise<MigrationStatus> {
  try {
    const row = await env.DB_V4.prepare(
      `SELECT state, offset, total_migrated, started_at, updated_at, error FROM migration_state WHERE id = 1`
    ).first() as any;
    if (!row) return { state: 'idle', offset: 0, totalMigrated: 0, startedAt: 0, updatedAt: 0 };
    return {
      state: row.state,
      offset: row.offset,
      totalMigrated: row.total_migrated,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      error: row.error ?? undefined,
    };
  } catch {
    return { state: 'idle', offset: 0, totalMigrated: 0, startedAt: 0, updatedAt: 0 };
  }
}

async function saveMigrationStatus(env: Env, status: MigrationStatus): Promise<void> {
  await env.DB_V4.prepare(`
    INSERT OR REPLACE INTO migration_state (id, state, offset, total_migrated, started_at, updated_at, error)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).bind(
    status.state, status.offset, status.totalMigrated,
    status.startedAt, status.updatedAt, status.error ?? null
  ).run();
}

/**
 * Run one batch and self-chain to the next via internal fetch.
 * Called with ctx.waitUntil so it runs in the background.
 */
export async function runMigrationBatch(env: Env, workerUrl: string): Promise<void> {
  const status = await getMigrationStatus(env);
  if (status.state !== 'running') return;

  try {
    const result = await migrateV3ToAnalyticsEngine(env, BATCH_SIZE, status.offset);

    const newTotal = status.totalMigrated + result.migrated;
    const updated: MigrationStatus = {
      state: result.hasMore ? 'running' : 'done',
      offset: result.nextOffset,
      totalMigrated: newTotal,
      startedAt: status.startedAt,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    await saveMigrationStatus(env, updated);


    console.log(`[V4 Migration] batch done: +${result.migrated} rows, total=${updated.totalMigrated}, offset=${updated.offset}, hasMore=${result.hasMore}`);

    // Self-chain: trigger next batch if more work remains
    if (result.hasMore) {
      fetch(`${workerUrl}/api/v4/admin/migrate/run`, { method: 'POST' }).catch(() => {});
    }
  } catch (e: any) {
    const errStatus: MigrationStatus = {
      ...(await getMigrationStatus(env)),
      state: 'error',
      error: String(e?.message ?? e),
      updatedAt: Math.floor(Date.now() / 1000),
    };
    await saveMigrationStatus(env, errStatus);
    console.error('[V4 Migration] batch error:', e);
  }
}
