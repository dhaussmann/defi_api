import { Env } from './types';

interface MACalculationResult {
  normalized_symbol: string;
  exchange: string;
  period: string;
  ma_rate_1h: number;
  ma_apr: number;
  data_points: number;
  std_dev: number;
  min_rate: number;
  max_rate: number;
  period_start: number;
  period_end: number;
}

interface CrossExchangeMAResult {
  normalized_symbol: string;
  period: string;
  avg_ma_rate_1h: number;
  avg_ma_apr: number;
  weighted_ma_rate_1h: number;
  weighted_ma_apr: number;
  exchange_count: number;
  total_data_points: number;
  min_exchange_ma: number;
  max_exchange_ma: number;
  spread: number;
  period_start: number;
  period_end: number;
}

const PERIODS = {
  '1h': 1 * 60 * 60,
  '24h': 24 * 60 * 60,
  '3d': 3 * 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '14d': 14 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
};

const HOURLY_PERIODS = ['24h'];
const DAILY_PERIODS = ['3d', '7d', '14d', '30d'];

function getMinDataPointsForPeriod(period: string): number {
  // Thresholds must work for all funding intervals (1h, 4h, 8h)
  // e.g. 8h interval = 3 data points per 24h, 9 per 3d, etc.
  switch (period) {
    case '1h': return 1;
    case '24h': return 3;
    case '3d': return 6;
    case '7d': return 14;
    case '14d': return 28;
    case '30d': return 60;
    default: return 1;
  }
}

export async function calculateFundingMA(env: Env, periodsToCalculate?: string[], exchangeFilter?: string): Promise<{ success: boolean; message: string; stats: any }> {
  const periods = periodsToCalculate || HOURLY_PERIODS;
  console.log(`[MA] Starting bulk 24h MA calculation`);
  const startTime = Date.now();
  const calculatedAt = Math.floor(startTime / 1000);
  
  const stats = {
    ma_rows_inserted: 0,
    cross_exchange_calculated: 0,
    errors: 0,
  };

  try {
    for (const periodName of periods) {
      const periodSeconds = PERIODS[periodName as keyof typeof PERIODS];
      if (!periodSeconds) continue;

      const cutoff = calculatedAt - periodSeconds;
      // Handle millisecond timestamps: if max funding_time > 10^10, it's in ms
      const cutoffMs = cutoff * 1000;
      const minDataPoints = getMinDataPointsForPeriod(periodName);

      let exchangeClause = '';
      if (exchangeFilter) {
        exchangeClause = `AND exchange = '${exchangeFilter}'`;
      }

      try {
        // 2-pass outlier-filtered MA calculation:
        // Pass 1 (inner subquery "stats"): compute mean and stddev per symbol/exchange
        // Pass 2 (outer query): recalculate AVG excluding values > 3 stddev from mean
        const OUTLIER_STDDEV = 3;
        const result = await env.DB_UNIFIED.prepare(`
          INSERT OR REPLACE INTO funding_ma (
            normalized_symbol, exchange, period,
            ma_rate_1h, ma_apr,
            data_points, std_dev, min_rate, max_rate,
            calculated_at, period_start, period_end
          )
          SELECT
            u.normalized_symbol,
            u.exchange,
            ? as period,
            AVG(u.rate_1h_percent) as ma_rate_1h,
            AVG(CASE WHEN u.rate_apr IS NOT NULL THEN u.rate_apr ELSE NULL END) as ma_apr,
            COUNT(*) as data_points,
            stats.sd as std_dev,
            MIN(u.rate_1h_percent) as min_rate,
            MAX(u.rate_1h_percent) as max_rate,
            ? as calculated_at,
            ? as period_start,
            ? as period_end
          FROM unified_v3 u
          INNER JOIN (
            SELECT
              normalized_symbol,
              exchange,
              AVG(rate_1h_percent) as mean,
              CASE
                WHEN COUNT(*) < 3 THEN 999999
                ELSE COALESCE(
                  SQRT(AVG(rate_1h_percent * rate_1h_percent) - AVG(rate_1h_percent) * AVG(rate_1h_percent)),
                  999999
                )
              END as sd
            FROM unified_v3
            WHERE rate_1h_percent IS NOT NULL
              AND (
                (funding_time > 10000000000 AND funding_time >= ?) OR
                (funding_time <= 10000000000 AND funding_time >= ?)
              )
              ${exchangeClause}
            GROUP BY normalized_symbol, exchange
            HAVING COUNT(*) >= ?
          ) stats ON u.normalized_symbol = stats.normalized_symbol
                  AND u.exchange = stats.exchange
          WHERE u.rate_1h_percent IS NOT NULL
            AND (
              (u.funding_time > 10000000000 AND u.funding_time >= ?) OR
              (u.funding_time <= 10000000000 AND u.funding_time >= ?)
            )
            AND (
              stats.sd = 0
              OR stats.sd >= 999999
              OR ABS(u.rate_1h_percent - stats.mean) <= (${OUTLIER_STDDEV} * stats.sd)
            )
            ${exchangeClause ? exchangeClause.replace('exchange', 'u.exchange') : ''}
          GROUP BY u.normalized_symbol, u.exchange
          HAVING COUNT(*) >= 1
        `).bind(periodName, calculatedAt, cutoff, calculatedAt, cutoffMs, cutoff, minDataPoints, cutoffMs, cutoff).run();

        const rows = result.meta.changes || (result.meta as any).rows_written || 0;
        stats.ma_rows_inserted += rows;
        console.log(`[MA] ${periodName}: Bulk inserted ${rows} per-exchange MAs`);
      } catch (error) {
        console.error(`[MA] Error in bulk ${periodName}:`, error);
        stats.errors++;
      }

      // Bulk cross-exchange aggregates
      try {
        const crossCount = await bulkCalculateCrossExchangeMA(env, periodName, calculatedAt);
        stats.cross_exchange_calculated += crossCount;
        console.log(`[MA] Cross-exchange ${periodName}: ${crossCount} symbols`);
      } catch (error) {
        console.error(`[MA] Error in bulk cross-exchange ${periodName}:`, error);
        stats.errors++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[MA] Bulk calculation completed in ${duration}ms`, stats);

    return {
      success: true,
      message: `24h MA: ${stats.ma_rows_inserted} per-exchange + ${stats.cross_exchange_calculated} cross-exchange`,
      stats: { ...stats, duration_ms: duration },
    };
  } catch (error) {
    console.error('[MA] Fatal error during calculation:', error);
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      stats,
    };
  }
}

async function calculateMAForSymbolExchange(
  env: Env,
  symbol: string,
  exchange: string,
  period: string,
  periodSeconds: number,
  calculatedAt: number
): Promise<MACalculationResult | null> {
  // Get the latest funding_time for this symbol/exchange
  const latestResult = await env.DB_UNIFIED.prepare(`
    SELECT MAX(funding_time) as latest_time
    FROM unified_v3
    WHERE normalized_symbol = ?
      AND exchange = ?
      AND rate_1h_percent IS NOT NULL
  `).bind(symbol, exchange).first();

  if (!latestResult || !latestResult.latest_time) {
    return null;
  }

  const periodEnd = latestResult.latest_time as number;
  // Handle both seconds and milliseconds timestamps
  // If timestamp > 10^10, it's in milliseconds
  const isMilliseconds = periodEnd > 10000000000;
  const periodStart = isMilliseconds 
    ? periodEnd - (periodSeconds * 1000)
    : periodEnd - periodSeconds;

  // Query funding rates for this period
  const query = await env.DB_UNIFIED.prepare(`
    SELECT 
      rate_1h_percent,
      rate_apr,
      funding_time
    FROM unified_v3
    WHERE normalized_symbol = ?
      AND exchange = ?
      AND funding_time >= ?
      AND funding_time <= ?
      AND rate_1h_percent IS NOT NULL
    ORDER BY funding_time DESC
  `).bind(symbol, exchange, periodStart, periodEnd).all();

  if (!query.results || query.results.length === 0) {
    return null;
  }

  // Check if we have sufficient data points for the period
  const minDataPoints = getMinDataPointsForPeriod(period);
  if (query.results.length < minDataPoints) {
    return null;
  }

  const rates = query.results.map((r: any) => r.rate_1h_percent);
  const aprs = query.results.map((r: any) => r.rate_apr).filter((apr: any) => apr !== null);

  if (rates.length === 0) {
    return null;
  }

  // Calculate statistics
  const ma_rate_1h = rates.reduce((sum: number, r: number) => sum + r, 0) / rates.length;
  const ma_apr = aprs.length > 0 ? aprs.reduce((sum: number, r: number) => sum + r, 0) / aprs.length : 0;

  // Standard deviation
  const variance = rates.reduce((sum: number, r: number) => sum + Math.pow(r - ma_rate_1h, 2), 0) / rates.length;
  const std_dev = Math.sqrt(variance);

  const min_rate = Math.min(...rates);
  const max_rate = Math.max(...rates);

  return {
    normalized_symbol: symbol,
    exchange,
    period,
    ma_rate_1h,
    ma_apr,
    data_points: rates.length,
    std_dev,
    min_rate,
    max_rate,
    period_start: periodStart,
    period_end: periodEnd,
  };
}

const DAILY_PERIOD_DAYS: Record<string, number> = {
  '3d': 3,
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

// Minimum number of 24h MA snapshots required per period
// 24h MAs are calculated hourly, so 3d = max 72 snapshots
const MIN_SNAPSHOTS_REQUIRED: Record<string, number> = {
  '3d': 3,     // at least 3 hourly snapshots (very lenient for bootstrapping)
  '7d': 6,     // at least 6 hourly snapshots
  '14d': 12,   // at least 12 hourly snapshots
  '30d': 24,   // at least 24 hourly snapshots
};

/**
 * Calculate a single daily MA period (3d, 7d, 14d, or 30d) directly from unified_v3 raw data.
 * Uses bulk SQL INSERT...SELECT for efficiency.
 * The HAVING clause ensures:
 *   1. Enough data points exist per symbol/exchange
 *   2. The data actually spans at least 50% of the period (prevents short-lived exchanges from getting long MAs)
 */
export async function calculateSingleDailyMA(env: Env, period: string): Promise<{ success: boolean; message: string; stats: any }> {
  const startTime = Date.now();
  const calculatedAt = Math.floor(startTime / 1000);
  const days = DAILY_PERIOD_DAYS[period];

  if (!days) {
    return { success: false, message: `Unknown daily period: ${period}`, stats: {} };
  }

  const periodSeconds = days * 24 * 60 * 60;
  const cutoff = calculatedAt - periodSeconds;
  const cutoffMs = cutoff * 1000;
  const minDataPoints = getMinDataPointsForPeriod(period);
  // Data must span at least 100% of the period
  const requiredSpanSeconds = periodSeconds;

  console.log(`[MA] Calculating ${period} MA from raw data (need >= ${minDataPoints} points, >= ${days}d coverage)`);

  const stats = {
    period,
    ma_rows_inserted: 0,
    cross_exchange_calculated: 0,
    errors: 0,
  };

  try {
    // Bulk INSERT...SELECT directly from unified_v3
    // Only include symbol/exchange combos where the earliest data point (across ALL data)
    // is at least `periodSeconds` before now — i.e., the exchange has been collecting long enough
    const result = await env.DB_UNIFIED.prepare(`
      INSERT OR REPLACE INTO funding_ma (
        normalized_symbol, exchange, period,
        ma_rate_1h, ma_apr,
        data_points, std_dev, min_rate, max_rate,
        calculated_at, period_start, period_end
      )
      SELECT
        u.normalized_symbol,
        u.exchange,
        ? as period,
        AVG(u.rate_1h_percent) as ma_rate_1h,
        AVG(CASE WHEN u.rate_apr IS NOT NULL THEN u.rate_apr ELSE NULL END) as ma_apr,
        COUNT(*) as data_points,
        0 as std_dev,
        MIN(u.rate_1h_percent) as min_rate,
        MAX(u.rate_1h_percent) as max_rate,
        ? as calculated_at,
        ? as period_start,
        ? as period_end
      FROM unified_v3 u
      INNER JOIN (
        SELECT normalized_symbol, exchange, MIN(funding_time) as first_seen
        FROM unified_v3
        WHERE rate_1h_percent IS NOT NULL
        GROUP BY normalized_symbol, exchange
        HAVING MIN(funding_time) <= ?
      ) eligible ON u.normalized_symbol = eligible.normalized_symbol
                 AND u.exchange = eligible.exchange
      WHERE u.rate_1h_percent IS NOT NULL
        AND (
          (u.funding_time > 10000000000 AND u.funding_time >= ?) OR
          (u.funding_time <= 10000000000 AND u.funding_time >= ?)
        )
      GROUP BY u.normalized_symbol, u.exchange
      HAVING COUNT(*) >= ?
    `).bind(period, calculatedAt, cutoff, calculatedAt, cutoff, cutoffMs, cutoff, minDataPoints).run();

    stats.ma_rows_inserted = result.meta.changes || (result.meta as any).rows_written || 0;
    console.log(`[MA] ${period}: Inserted ${stats.ma_rows_inserted} per-exchange MAs`);

    // Step 3: Bulk calculate cross-exchange aggregates
    try {
      const crossCount = await bulkCalculateCrossExchangeMA(env, period, calculatedAt);
      stats.cross_exchange_calculated = crossCount;
      console.log(`[MA] ${period} cross-exchange: ${crossCount} symbols`);
    } catch (error) {
      console.error(`[MA] Error in ${period} bulk cross-exchange:`, error);
      stats.errors++;
    }

    const duration = Date.now() - startTime;
    console.log(`[MA] ${period} completed in ${duration}ms`, stats);

    return {
      success: true,
      message: `${period} MA: ${stats.ma_rows_inserted} per-exchange + ${stats.cross_exchange_calculated} cross-exchange`,
      stats: { ...stats, duration_ms: duration },
    };
  } catch (error) {
    console.error(`[MA] Fatal error in ${period} MA:`, error);
    return {
      success: false,
      message: `Error in ${period}: ${error instanceof Error ? error.message : String(error)}`,
      stats,
    };
  }
}

// Helper: period name passthrough (for clarity in bind calls)
function periodName(p: string): string { return p; }

/**
 * Calculate ALL daily MAs (3d, 7d, 14d, 30d) sequentially.
 * Each period checks independently if enough data exists.
 */
export async function calculateAllDailyMAs(env: Env): Promise<{ success: boolean; message: string; results: any[] }> {
  const results = [];
  for (const period of Object.keys(DAILY_PERIOD_DAYS)) {
    const result = await calculateSingleDailyMA(env, period);
    results.push(result);
  }
  return {
    success: results.every(r => r.success),
    message: results.map(r => r.message).join('; '),
    results,
  };
}

async function insertMA(env: Env, result: MACalculationResult, calculatedAt: number): Promise<void> {
  await env.DB_UNIFIED.prepare(`
    INSERT INTO funding_ma (
      normalized_symbol, exchange, period,
      ma_rate_1h, ma_apr,
      data_points, std_dev, min_rate, max_rate,
      calculated_at, period_start, period_end
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_symbol, exchange, period, calculated_at)
    DO UPDATE SET
      ma_rate_1h = excluded.ma_rate_1h,
      ma_apr = excluded.ma_apr,
      data_points = excluded.data_points,
      std_dev = excluded.std_dev,
      min_rate = excluded.min_rate,
      max_rate = excluded.max_rate,
      period_start = excluded.period_start,
      period_end = excluded.period_end
  `).bind(
    result.normalized_symbol,
    result.exchange,
    result.period,
    result.ma_rate_1h,
    result.ma_apr,
    result.data_points,
    result.std_dev,
    result.min_rate,
    result.max_rate,
    calculatedAt,
    result.period_start,
    result.period_end
  ).run();
}

/**
 * Bulk calculate cross-exchange MAs for a given period using a single SQL query.
 * Uses the latest MA per symbol/exchange/period (not exact calculated_at match).
 * Returns number of rows inserted.
 */
async function bulkCalculateCrossExchangeMA(
  env: Env,
  period: string,
  calculatedAt: number
): Promise<number> {
  const periodSeconds = PERIODS[period as keyof typeof PERIODS] || 86400;
  const periodStart = calculatedAt - periodSeconds;

  console.log(`[MA] bulkCrossExchange ${period}: calculatedAt=${calculatedAt}, periodStart=${periodStart}`);

  // Use a subquery to get the latest MA per symbol/exchange for this period,
  // then aggregate across exchanges per symbol in one shot
  const result = await env.DB_UNIFIED.prepare(`
    INSERT OR REPLACE INTO funding_ma_cross (
      normalized_symbol, period,
      avg_ma_rate_1h, avg_ma_apr,
      weighted_ma_rate_1h, weighted_ma_apr,
      exchange_count, total_data_points,
      min_exchange_ma, max_exchange_ma, spread,
      calculated_at, period_start, period_end
    )
    SELECT
      latest.normalized_symbol,
      ? as period,
      AVG(latest.ma_rate_1h) as avg_ma_rate_1h,
      AVG(CASE WHEN latest.ma_apr != 0 THEN latest.ma_apr ELSE NULL END) as avg_ma_apr,
      SUM(latest.ma_rate_1h * latest.data_points) / SUM(latest.data_points) as weighted_ma_rate_1h,
      SUM(COALESCE(latest.ma_apr, 0) * latest.data_points) / SUM(latest.data_points) as weighted_ma_apr,
      COUNT(*) as exchange_count,
      SUM(latest.data_points) as total_data_points,
      MIN(latest.ma_rate_1h) as min_exchange_ma,
      MAX(latest.ma_rate_1h) as max_exchange_ma,
      MAX(latest.ma_rate_1h) - MIN(latest.ma_rate_1h) as spread,
      ? as calculated_at,
      ? as period_start,
      ? as period_end
    FROM (
      SELECT f1.normalized_symbol, f1.exchange, f1.ma_rate_1h, f1.ma_apr, f1.data_points
      FROM funding_ma f1
      INNER JOIN (
        SELECT normalized_symbol, exchange, MAX(calculated_at) as max_calc
        FROM funding_ma
        WHERE period = ? AND ma_rate_1h IS NOT NULL
        GROUP BY normalized_symbol, exchange
      ) f2 ON f1.normalized_symbol = f2.normalized_symbol
           AND f1.exchange = f2.exchange
           AND f1.calculated_at = f2.max_calc
      WHERE f1.period = ? AND f1.ma_rate_1h IS NOT NULL
    ) latest
    GROUP BY latest.normalized_symbol
    HAVING COUNT(*) >= 2
  `).bind(period, calculatedAt, periodStart, calculatedAt, period, period).run();

  const changes = result.meta.changes || 0;
  const rowsWritten = (result.meta as any).rows_written || 0;
  console.log(`[MA] bulkCrossExchange ${period}: changes=${changes}, rows_written=${rowsWritten}, last_row_id=${result.meta.last_row_id}`);

  // D1 may report 0 changes for INSERT OR REPLACE; use rows_written as fallback
  return changes || rowsWritten;
}

export async function queryFundingMA(
  env: Env,
  symbol: string,
  period: string,
  exchange?: string,
  limit: number = 24
): Promise<any> {
  if (exchange && exchange !== 'all') {
    // Query specific exchange
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        normalized_symbol,
        exchange,
        period,
        ma_rate_1h,
        ma_apr,
        data_points,
        std_dev,
        min_rate,
        max_rate,
        calculated_at,
        period_start,
        period_end
      FROM funding_ma
      WHERE normalized_symbol = ?
        AND exchange = ?
        AND period = ?
      ORDER BY calculated_at DESC
      LIMIT ?
    `).bind(symbol, exchange, period, limit).all();

    return {
      success: true,
      symbol,
      exchange,
      period,
      count: query.results?.length || 0,
      data: query.results || [],
    };
  } else {
    // Query cross-exchange aggregates
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        normalized_symbol,
        period,
        avg_ma_rate_1h,
        avg_ma_apr,
        weighted_ma_rate_1h,
        weighted_ma_apr,
        exchange_count,
        total_data_points,
        min_exchange_ma,
        max_exchange_ma,
        spread,
        calculated_at,
        period_start,
        period_end
      FROM funding_ma_cross
      WHERE normalized_symbol = ?
        AND period = ?
      ORDER BY calculated_at DESC
      LIMIT ?
    `).bind(symbol, period, limit).all();

    return {
      success: true,
      symbol,
      exchange: 'cross-exchange',
      period,
      count: query.results?.length || 0,
      data: query.results || [],
    };
  }
}

export async function getLatestMA(
  env: Env,
  symbol: string,
  exchange?: string
): Promise<any> {
  if (exchange && exchange !== 'all') {
    // Get latest MA for all periods for specific exchange
    // Use INNER JOIN to get MAX(calculated_at) per period, not globally
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        f.period,
        f.ma_rate_1h,
        f.ma_apr,
        f.data_points,
        f.std_dev,
        f.calculated_at
      FROM funding_ma f
      INNER JOIN (
        SELECT period, MAX(calculated_at) as max_calc
        FROM funding_ma
        WHERE normalized_symbol = ? AND exchange = ?
        GROUP BY period
      ) latest ON f.period = latest.period AND f.calculated_at = latest.max_calc
      WHERE f.normalized_symbol = ?
        AND f.exchange = ?
      ORDER BY 
        CASE f.period
          WHEN '1h' THEN 1
          WHEN '24h' THEN 2
          WHEN '3d' THEN 3
          WHEN '7d' THEN 4
          WHEN '14d' THEN 5
          WHEN '30d' THEN 6
        END
    `).bind(symbol, exchange, symbol, exchange).all();

    return {
      success: true,
      symbol,
      exchange,
      data: query.results || [],
    };
  } else {
    // Get latest cross-exchange MA for all periods
    // Use INNER JOIN to get MAX(calculated_at) per period, not globally
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        f.period,
        f.avg_ma_rate_1h,
        f.avg_ma_apr,
        f.weighted_ma_rate_1h,
        f.weighted_ma_apr,
        f.exchange_count,
        f.total_data_points,
        f.spread,
        f.calculated_at
      FROM funding_ma_cross f
      INNER JOIN (
        SELECT period, MAX(calculated_at) as max_calc
        FROM funding_ma_cross
        WHERE normalized_symbol = ?
        GROUP BY period
      ) latest ON f.period = latest.period AND f.calculated_at = latest.max_calc
      WHERE f.normalized_symbol = ?
      ORDER BY 
        CASE f.period
          WHEN '1h' THEN 1
          WHEN '24h' THEN 2
          WHEN '3d' THEN 3
          WHEN '7d' THEN 4
          WHEN '14d' THEN 5
          WHEN '30d' THEN 6
        END
    `).bind(symbol, symbol).all();

    return {
      success: true,
      symbol,
      exchange: 'cross-exchange',
      data: query.results || [],
    };
  }
}

/**
 * Get latest MA for ALL symbols × ALL periods.
 * If exchange is specified: returns per-exchange MAs from funding_ma.
 * If exchange is 'all' or omitted: returns cross-exchange aggregates from funding_ma_cross.
 */
export async function getLatestMAAll(
  env: Env,
  exchange?: string
): Promise<any> {
  if (exchange === '*') {
    // All symbols × all periods × all exchanges individually
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        f.normalized_symbol,
        f.exchange,
        f.period,
        f.ma_rate_1h,
        f.ma_apr,
        f.data_points,
        f.std_dev,
        f.calculated_at
      FROM funding_ma f
      INNER JOIN (
        SELECT normalized_symbol, exchange, period, MAX(calculated_at) as max_calc
        FROM funding_ma
        WHERE ma_rate_1h IS NOT NULL
        GROUP BY normalized_symbol, exchange, period
      ) latest ON f.normalized_symbol = latest.normalized_symbol
               AND f.exchange = latest.exchange
               AND f.period = latest.period
               AND f.calculated_at = latest.max_calc
      ORDER BY f.normalized_symbol, f.exchange,
        CASE f.period
          WHEN '24h' THEN 1
          WHEN '3d' THEN 2
          WHEN '7d' THEN 3
          WHEN '14d' THEN 4
          WHEN '30d' THEN 5
        END
    `).all();

    const records = query.results || [];

    // Group by symbol + exchange
    const byKey: Record<string, any> = {};
    const exchangeSet = new Set<string>();
    for (const r of records as any[]) {
      const key = `${r.normalized_symbol}|${r.exchange}`;
      exchangeSet.add(r.exchange as string);
      if (!byKey[key]) {
        byKey[key] = { symbol: r.normalized_symbol, exchange: r.exchange, periods: {} };
      }
      byKey[key].periods[r.period] = {
        ma_rate_1h: r.ma_rate_1h,
        ma_apr: r.ma_apr,
        data_points: r.data_points,
        std_dev: r.std_dev,
        calculated_at: r.calculated_at,
      };
    }

    const data = Object.values(byKey).sort((a: any, b: any) =>
      a.symbol.localeCompare(b.symbol) || a.exchange.localeCompare(b.exchange)
    );

    // Count unique symbols
    const uniqueSymbols = new Set(data.map((d: any) => d.symbol));

    return {
      success: true,
      exchange: 'all_individual',
      exchanges: Array.from(exchangeSet).sort(),
      symbols: uniqueSymbols.size,
      entries: data.length,
      count: records.length,
      data,
    };
  } else if (exchange && exchange !== 'all') {
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        f.normalized_symbol,
        f.exchange,
        f.period,
        f.ma_rate_1h,
        f.ma_apr,
        f.data_points,
        f.std_dev,
        f.calculated_at
      FROM funding_ma f
      INNER JOIN (
        SELECT normalized_symbol, period, MAX(calculated_at) as max_calc
        FROM funding_ma
        WHERE exchange = ?
          AND ma_rate_1h IS NOT NULL
        GROUP BY normalized_symbol, period
      ) latest ON f.normalized_symbol = latest.normalized_symbol
               AND f.period = latest.period
               AND f.calculated_at = latest.max_calc
      WHERE f.exchange = ?
      ORDER BY f.normalized_symbol,
        CASE f.period
          WHEN '24h' THEN 1
          WHEN '3d' THEN 2
          WHEN '7d' THEN 3
          WHEN '14d' THEN 4
          WHEN '30d' THEN 5
        END
    `).bind(exchange, exchange).all();

    const records = query.results || [];

    // Group by symbol
    const bySymbol: Record<string, any> = {};
    for (const r of records as any[]) {
      const sym = r.normalized_symbol;
      if (!bySymbol[sym]) {
        bySymbol[sym] = { symbol: sym, exchange, periods: {} };
      }
      bySymbol[sym].periods[r.period] = {
        ma_rate_1h: r.ma_rate_1h,
        ma_apr: r.ma_apr,
        data_points: r.data_points,
        std_dev: r.std_dev,
        calculated_at: r.calculated_at,
      };
    }

    const data = Object.values(bySymbol).sort((a: any, b: any) => a.symbol.localeCompare(b.symbol));

    return {
      success: true,
      exchange,
      symbols: data.length,
      count: records.length,
      data,
    };
  } else {
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        f.normalized_symbol,
        f.period,
        f.avg_ma_rate_1h,
        f.avg_ma_apr,
        f.weighted_ma_rate_1h,
        f.weighted_ma_apr,
        f.exchange_count,
        f.total_data_points,
        f.spread,
        f.calculated_at
      FROM funding_ma_cross f
      INNER JOIN (
        SELECT normalized_symbol, period, MAX(calculated_at) as max_calc
        FROM funding_ma_cross
        GROUP BY normalized_symbol, period
      ) latest ON f.normalized_symbol = latest.normalized_symbol
               AND f.period = latest.period
               AND f.calculated_at = latest.max_calc
      ORDER BY f.normalized_symbol,
        CASE f.period
          WHEN '24h' THEN 1
          WHEN '3d' THEN 2
          WHEN '7d' THEN 3
          WHEN '14d' THEN 4
          WHEN '30d' THEN 5
        END
    `).all();

    const records = query.results || [];

    // Group by symbol
    const bySymbol: Record<string, any> = {};
    for (const r of records as any[]) {
      const sym = r.normalized_symbol;
      if (!bySymbol[sym]) {
        bySymbol[sym] = { symbol: sym, periods: {} };
      }
      bySymbol[sym].periods[r.period] = {
        avg_ma_rate_1h: r.avg_ma_rate_1h,
        avg_ma_apr: r.avg_ma_apr,
        weighted_ma_rate_1h: r.weighted_ma_rate_1h,
        weighted_ma_apr: r.weighted_ma_apr,
        exchange_count: r.exchange_count,
        total_data_points: r.total_data_points,
        spread: r.spread,
        calculated_at: r.calculated_at,
      };
    }

    const data = Object.values(bySymbol).sort((a: any, b: any) => a.symbol.localeCompare(b.symbol));

    return {
      success: true,
      exchange: 'cross-exchange',
      symbols: data.length,
      count: records.length,
      data,
    };
  }
}
