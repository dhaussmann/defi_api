/**
 * Arbitrage V3 Calculation Module
 * Calculates funding rate arbitrage opportunities based on V3 Moving Average data
 * and live rates from unified_v3
 */

import { Env } from './types';

const PERIODS = ['live', '24h', '3d', '7d', '14d', '30d'] as const;

// Filter out MA entries with extreme APRs that distort arbitrage results
// (e.g. Variational tokens with >500% annualized rates)
const MAX_APR_FILTER = 500;

// Minimum open interest (USD) for Variational tokens to be included in arbitrage
const MIN_OI_VARIATIONAL = 200000;
type Period = typeof PERIODS[number];

interface MAData {
  normalized_symbol: string;
  exchange: string;
  period: string;
  ma_rate_1h: number;
  ma_apr: number;
  data_points: number;
}

interface ArbitrageOpportunity {
  symbol: string;
  long_exchange: string;
  short_exchange: string;
  period: Period;
  long_rate: number;
  short_rate: number;
  spread: number;
  long_apr: number;
  short_apr: number;
  spread_apr: number;
  stability_score: number;
  is_stable: boolean;
}

/**
 * Calculate and store V3 arbitrage opportunities
 */
export async function calculateArbitrageV3(env: Env): Promise<void> {
  const startTime = Date.now();
  console.log('[ArbitrageV3] Starting arbitrage calculation...');

  const nowSeconds = Math.floor(Date.now() / 1000);
  let totalOpportunities = 0;

  try {
    // Clear old arbitrage data before recalculating
    // This ensures filtered-out extreme entries don't persist from previous runs
    await env.DB_UNIFIED.prepare('DELETE FROM arbitrage_v3').run();
    console.log('[ArbitrageV3] Cleared old arbitrage data');

    // Fetch latest MA data for each symbol-exchange-period combination
    // Use JOIN instead of tuple IN subquery for D1/SQLite compatibility
    const maDataResult = await env.DB_UNIFIED.prepare(`
      SELECT 
        f.normalized_symbol,
        f.exchange,
        f.period,
        f.ma_rate_1h,
        f.ma_apr,
        f.data_points
      FROM funding_ma f
      INNER JOIN (
        SELECT normalized_symbol, exchange, period, MAX(calculated_at) as max_calc
        FROM funding_ma
        GROUP BY normalized_symbol, exchange, period
      ) latest ON f.normalized_symbol = latest.normalized_symbol
             AND f.exchange = latest.exchange
             AND f.period = latest.period
             AND f.calculated_at = latest.max_calc
      WHERE f.ma_rate_1h IS NOT NULL
        AND f.ma_apr IS NOT NULL
    `).all();

    if (!maDataResult.success || !maDataResult.results) {
      throw new Error('Failed to fetch MA data');
    }

    const rawMAData = maDataResult.results as MAData[];
    console.log(`[ArbitrageV3] Loaded ${rawMAData.length} MA records`);

    // Build set of Variational symbol/exchange pairs with insufficient open interest
    const lowOISet = new Set<string>();
    try {
      const oiResult = await env.DB_UNIFIED.prepare(`
        SELECT u.normalized_symbol, u.exchange, u.open_interest
        FROM unified_v3 u
        INNER JOIN (
          SELECT normalized_symbol, exchange, MAX(funding_time) as max_ft
          FROM unified_v3
          WHERE exchange = 'variational'
            AND open_interest IS NOT NULL
          GROUP BY normalized_symbol, exchange
        ) latest ON u.normalized_symbol = latest.normalized_symbol
                 AND u.exchange = latest.exchange
                 AND u.funding_time = latest.max_ft
        WHERE u.exchange = 'variational'
          AND (u.open_interest IS NULL OR u.open_interest < ?)
      `).bind(MIN_OI_VARIATIONAL).all();
      if (oiResult.success && oiResult.results) {
        for (const row of oiResult.results as any[]) {
          lowOISet.add(`${row.normalized_symbol}:${row.exchange}`);
        }
      }
      console.log(`[ArbitrageV3] Found ${lowOISet.size} Variational symbols with OI < ${MIN_OI_VARIATIONAL}`);
    } catch (e) {
      console.error('[ArbitrageV3] Error fetching OI data:', e);
    }

    // Filter out extreme APRs and low-OI Variational tokens
    const maData = rawMAData.filter(ma => {
      if (Math.abs(ma.ma_apr) > MAX_APR_FILTER) return false;
      if (lowOISet.has(`${ma.normalized_symbol}:${ma.exchange}`)) return false;
      return true;
    });
    const filtered = rawMAData.length - maData.length;
    if (filtered > 0) {
      console.log(`[ArbitrageV3] Filtered out ${filtered} MA records (extreme APR or low OI)`);
    }

    // Fetch live rates: latest snapshot per symbol/exchange from last 15 minutes
    // Use JOIN instead of tuple IN subquery for D1/SQLite compatibility
    const liveCutoff = nowSeconds - 900;
    const liveCutoffMs = liveCutoff * 1000;
    const liveResult = await env.DB_UNIFIED.prepare(`
      SELECT 
        u.normalized_symbol,
        u.exchange,
        'live' as period,
        u.rate_1h_percent as ma_rate_1h,
        u.rate_apr as ma_apr,
        1 as data_points
      FROM unified_v3 u
      INNER JOIN (
        SELECT normalized_symbol, exchange, MAX(funding_time) as max_ft
        FROM unified_v3
        WHERE rate_1h_percent IS NOT NULL
          AND (
            (funding_time > 10000000000 AND funding_time >= ?) OR
            (funding_time <= 10000000000 AND funding_time >= ?)
          )
        GROUP BY normalized_symbol, exchange
      ) latest ON u.normalized_symbol = latest.normalized_symbol
             AND u.exchange = latest.exchange
             AND u.funding_time = latest.max_ft
      WHERE u.rate_1h_percent IS NOT NULL
        AND u.rate_apr IS NOT NULL
    `).bind(liveCutoffMs, liveCutoff).all();

    if (liveResult.success && liveResult.results) {
      const rawLiveData = liveResult.results as MAData[];
      const liveData = rawLiveData.filter(d => {
        if (Math.abs(d.ma_apr) > MAX_APR_FILTER) return false;
        if (lowOISet.has(`${d.normalized_symbol}:${d.exchange}`)) return false;
        return true;
      });
      const liveFiltered = rawLiveData.length - liveData.length;
      maData.push(...liveData);
      console.log(`[ArbitrageV3] Loaded ${rawLiveData.length} live rate records (filtered ${liveFiltered} extreme)`);
    }

    // Group by symbol
    const symbolMap = new Map<string, MAData[]>();
    for (const ma of maData) {
      if (!symbolMap.has(ma.normalized_symbol)) {
        symbolMap.set(ma.normalized_symbol, []);
      }
      symbolMap.get(ma.normalized_symbol)!.push(ma);
    }

    console.log(`[ArbitrageV3] Processing ${symbolMap.size} symbols`);

    // Calculate arbitrage opportunities for each period
    for (const period of PERIODS) {
      const opportunities: ArbitrageOpportunity[] = [];

      // For each symbol, compare all exchange pairs
      for (const [symbol, maList] of symbolMap.entries()) {
        // Filter for current period
        const periodData = maList.filter(ma => ma.period === period);
        
        // Need at least 2 exchanges to compare
        if (periodData.length < 2) continue;

        // Compare all pairs
        for (let i = 0; i < periodData.length; i++) {
          for (let j = i + 1; j < periodData.length; j++) {
            const ma1 = periodData[i];
            const ma2 = periodData[j];

            // Skip if same exchange
            if (ma1.exchange === ma2.exchange) continue;

            const rate1 = ma1.ma_rate_1h;
            const rate2 = ma2.ma_rate_1h;
            const apr1 = ma1.ma_apr;
            const apr2 = ma2.ma_apr;

            // Determine long/short positions
            const isRate1Lower = rate1 < rate2;
            const longExchange = isRate1Lower ? ma1.exchange : ma2.exchange;
            const shortExchange = isRate1Lower ? ma2.exchange : ma1.exchange;
            const longRate = isRate1Lower ? rate1 : rate2;
            const shortRate = isRate1Lower ? rate2 : rate1;
            const longAPR = isRate1Lower ? apr1 : apr2;
            const shortAPR = isRate1Lower ? apr2 : apr1;

            // Calculate spread
            const spread = Math.abs(rate2 - rate1);
            const spreadAPR = Math.abs(shortAPR - longAPR);

            // Calculate stability score
            const stabilityScore = calculateStabilityScore(
              symbol,
              ma1.exchange,
              ma2.exchange,
              isRate1Lower,
              maList
            );

            opportunities.push({
              symbol,
              long_exchange: longExchange,
              short_exchange: shortExchange,
              period,
              long_rate: longRate,
              short_rate: shortRate,
              spread,
              long_apr: longAPR,
              short_apr: shortAPR,
              spread_apr: spreadAPR,
              stability_score: stabilityScore,
              is_stable: stabilityScore >= 4
            });
          }
        }
      }

      // Insert opportunities for this period
      if (opportunities.length > 0) {
        console.log(`[ArbitrageV3] ${period}: Found ${opportunities.length} opportunities`);

        const insertStmt = env.DB_UNIFIED.prepare(`
          INSERT OR REPLACE INTO arbitrage_v3 (
            symbol, long_exchange, short_exchange, period,
            long_rate, short_rate, spread,
            long_apr, short_apr, spread_apr,
            stability_score, is_stable, calculated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const batch = opportunities.map(opp =>
          insertStmt.bind(
            opp.symbol,
            opp.long_exchange,
            opp.short_exchange,
            opp.period,
            opp.long_rate,
            opp.short_rate,
            opp.spread,
            opp.long_apr,
            opp.short_apr,
            opp.spread_apr,
            opp.stability_score,
            opp.is_stable ? 1 : 0,
            nowSeconds
          )
        );

        await env.DB_UNIFIED.batch(batch);
        totalOpportunities += opportunities.length;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[ArbitrageV3] Completed in ${duration}ms - Total: ${totalOpportunities} opportunities`);
  } catch (error) {
    console.error('[ArbitrageV3] Error calculating arbitrage:', error);
    throw error;
  }
}

function calculateStabilityScore(
  symbol: string,
  exchange1: string,
  exchange2: string,
  isRate1Lower: boolean,
  allMAData: MAData[]
): number {
  let consistentCount = 0;

  for (const period of PERIODS) {
    const ma1 = allMAData.find(
      ma => ma.exchange === exchange1 && ma.period === period
    );
    const ma2 = allMAData.find(
      ma => ma.exchange === exchange2 && ma.period === period
    );

    if (ma1 && ma2) {
      const periodIsRate1Lower = ma1.ma_rate_1h < ma2.ma_rate_1h;
      if (periodIsRate1Lower === isRate1Lower) {
        consistentCount++;
      }
    }
  }

  return consistentCount;
}

export async function queryArbitrageV3(
  env: Env,
  options?: {
    symbols?: string[];
    exchanges?: string[];
    periods?: string[];
    minSpread?: number;
    minSpreadAPR?: number;
    onlyStable?: boolean;
    sortBy?: string;
    order?: string;
    limit?: number;
  }
): Promise<any> {
  try {
    let query = `
      SELECT 
        symbol, long_exchange, short_exchange, period,
        long_rate, short_rate, spread,
        long_apr, short_apr, spread_apr,
        stability_score, is_stable, calculated_at
      FROM arbitrage_v3
      WHERE 1=1
    `;

    const params: any[] = [];

    if (options?.symbols && options.symbols.length > 0) {
      const placeholders = options.symbols.map(() => '?').join(',');
      query += ` AND symbol IN (${placeholders})`;
      params.push(...options.symbols);
    }

    if (options?.exchanges && options.exchanges.length > 0) {
      const placeholders = options.exchanges.map(() => '?').join(',');
      query += ` AND (long_exchange IN (${placeholders}) OR short_exchange IN (${placeholders}))`;
      params.push(...options.exchanges, ...options.exchanges);
    }

    if (options?.periods && options.periods.length > 0) {
      const placeholders = options.periods.map(() => '?').join(',');
      query += ` AND period IN (${placeholders})`;
      params.push(...options.periods);
    }

    if (options?.minSpread !== undefined) {
      query += ` AND spread >= ?`;
      params.push(options.minSpread);
    }

    if (options?.minSpreadAPR !== undefined) {
      query += ` AND spread_apr >= ?`;
      params.push(options.minSpreadAPR);
    }

    if (options?.onlyStable) {
      query += ` AND is_stable = 1`;
    }

    const sortBy = options?.sortBy || 'spread_apr';
    const order = options?.order || 'desc';
    const validSortFields = ['spread', 'spread_apr', 'stability_score'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'spread_apr';
    const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${sortOrder}`;

    if (options?.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const result = await env.DB_UNIFIED.prepare(query).bind(...params).all();

    if (!result.success || !result.results) {
      throw new Error('Failed to fetch arbitrage opportunities');
    }

    return result.results;
  } catch (error) {
    console.error('[ArbitrageV3] Error querying arbitrage:', error);
    throw error;
  }
}
