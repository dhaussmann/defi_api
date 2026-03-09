/**
 * V4 Moving Average Calculator
 *
 * Calculates MAs for 8 periods: 1h, 4h, 8h, 12h, 1d, 3d, 7d, 30d
 * - Source: Analytics Engine `v4_markets` (raw funding rate data)
 * - History: Written to Analytics Engine `v4_ma` dataset (fire-and-forget)
 * - Latest: Upserted to D1 `funding_ma_v4` table (fast API reads)
 *
 * All periods computed directly from raw AE data — no cascading averages.
 * Cross-exchange aggregate stored with exchange = '_all'.
 */

import { Env } from './types';

const CF_AE_SQL_URL = (accountId: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;

interface PeriodConfig {
  name: string;
  seconds: number;
  minPoints: number;
}

const PERIODS: PeriodConfig[] = [
  { name: '1h',  seconds: 3_600,     minPoints: 1 },
  { name: '4h',  seconds: 14_400,    minPoints: 2 },
  { name: '8h',  seconds: 28_800,    minPoints: 2 },
  { name: '12h', seconds: 43_200,    minPoints: 3 },
  { name: '1d',  seconds: 86_400,    minPoints: 3 },
  { name: '3d',  seconds: 259_200,   minPoints: 6 },
  { name: '7d',  seconds: 604_800,   minPoints: 12 },
  { name: '30d', seconds: 2_592_000, minPoints: 48 },
];

interface MaRow {
  ticker: string;
  exchange: string;
  ma_apr: number;
  data_points: number;
  period_start: number;
}

async function queryAeMa(
  env: Env,
  periodSeconds: number,
  minPoints: number,
  now: number
): Promise<MaRow[]> {
  const from = now - periodSeconds;

  // Per-exchange MA
  const sql = `
SELECT
  blob1 AS ticker,
  blob2 AS exchange,
  avg(double2) AS ma_apr,
  count() AS data_points,
  min(double1) AS period_start
FROM v4_markets
WHERE double1 >= ${from}
  AND double1 <= ${now}
GROUP BY blob1, blob2
HAVING count() >= ${minPoints}
  `;

  const res = await fetch(CF_AE_SQL_URL(env.CF_ACCOUNT_ID), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: sql.trim(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AE MA query failed (${periodSeconds}s): ${err}`);
  }

  const data = await res.json() as any;
  return (data.data || []).map((r: any) => ({
    ticker: r.ticker,
    exchange: r.exchange,
    ma_apr: Number(r.ma_apr),
    data_points: Number(r.data_points),
    period_start: Number(r.period_start),
  }));
}

async function queryAeMaCross(
  env: Env,
  periodSeconds: number,
  minPoints: number,
  now: number
): Promise<MaRow[]> {
  const from = now - periodSeconds;

  // Cross-exchange aggregate (all exchanges combined per ticker)
  const sql = `
SELECT
  blob1 AS ticker,
  avg(double2) AS ma_apr,
  count() AS data_points,
  min(double1) AS period_start
FROM v4_markets
WHERE double1 >= ${from}
  AND double1 <= ${now}
GROUP BY blob1
HAVING count() >= ${minPoints}
  `;

  const res = await fetch(CF_AE_SQL_URL(env.CF_ACCOUNT_ID), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: sql.trim(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AE cross-MA query failed (${periodSeconds}s): ${err}`);
  }

  const data = await res.json() as any;
  return (data.data || []).map((r: any) => ({
    ticker: r.ticker,
    exchange: '_all',
    ma_apr: Number(r.ma_apr),
    data_points: Number(r.data_points),
    period_start: Number(r.period_start),
  }));
}

function writeToAeMa(env: Env, period: string, rows: MaRow[], calculatedAt: number): void {
  if (!env.V4_MA_ANALYTICS) return;
  for (const row of rows) {
    try {
      env.V4_MA_ANALYTICS.writeDataPoint({
        indexes: [`${row.ticker}:${row.exchange}:${period}`],
        blobs: [row.ticker, row.exchange, period],
        doubles: [calculatedAt, row.ma_apr, row.data_points, row.period_start],
      });
    } catch {}
  }
}

async function upsertMaToD1(env: Env, period: string, rows: MaRow[], calculatedAt: number): Promise<void> {
  if (rows.length === 0) return;

  const stmt = env.DB_V4.prepare(`
    INSERT OR REPLACE INTO funding_ma_v4
      (normalized_symbol, exchange, period, ma_apr, data_points, period_start, calculated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      await env.DB_V4.batch(
        batch.map(r =>
          stmt.bind(
            r.ticker.toUpperCase(),
            r.exchange,
            period,
            r.ma_apr,
            r.data_points,
            r.period_start,
            calculatedAt,
          )
        )
      );
    } catch (e) {
      console.error(`[V4 MA] D1 batch failed for period=${period} offset=${i}:`, e);
    }
  }
}

/**
 * Main entry point — calculate all 8 MA periods and store results.
 * Called from the every-5-minutes cron via ctx.waitUntil.
 */
export async function calculateV4MAs(env: Env): Promise<void> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    console.error('[V4 MA] CF_ACCOUNT_ID / CF_API_TOKEN not set — skipping');
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  let totalRows = 0;

  for (const period of PERIODS) {
    try {
      // Query per-exchange and cross-exchange MAs in parallel
      const [perExchange, crossExchange] = await Promise.all([
        queryAeMa(env, period.seconds, period.minPoints, now),
        queryAeMaCross(env, period.seconds, period.minPoints, now),
      ]);

      const allRows = [...perExchange, ...crossExchange];
      if (allRows.length === 0) {
        console.log(`[V4 MA] ${period.name}: no data`);
        continue;
      }

      // Write history to Analytics Engine (fire-and-forget)
      writeToAeMa(env, period.name, allRows, now);

      // Upsert latest to D1
      await upsertMaToD1(env, period.name, allRows, now);

      console.log(`[V4 MA] ${period.name}: ${perExchange.length} per-exchange + ${crossExchange.length} cross-exchange`);
      totalRows += allRows.length;
    } catch (e) {
      console.error(`[V4 MA] ${period.name} failed:`, e);
    }
  }

  console.log(`[V4 MA] Complete: ${totalRows} total MA rows across ${PERIODS.length} periods`);
}
