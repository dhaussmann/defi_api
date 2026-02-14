/**
 * Arbitrage Cache Module
 * Calculates and caches funding rate arbitrage opportunities between exchanges
 * Based on Moving Average data from funding_ma_cache
 */

import { Env } from './types';

// Timeframes available in the system
const TIMEFRAMES = ['24h', '3d', '7d', '14d', '30d'] as const;
type Timeframe = typeof TIMEFRAMES[number];

interface MAData {
  normalized_symbol: string;
  exchange: string;
  timeframe: Timeframe;
  avg_funding_rate: number;
  avg_funding_rate_annual: number;
  sample_count: number;
}

interface ArbitrageOpportunity {
  symbol: string;
  long_exchange: string;
  short_exchange: string;
  timeframe: Timeframe;
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
 * Calculate arbitrage opportunities for all symbols and timeframes
 */
export async function calculateAndCacheArbitrage(env: Env): Promise<void> {
  const startTime = Date.now();
  console.log('[Arbitrage] Starting arbitrage calculation...');

  const nowSeconds = Math.floor(Date.now() / 1000);
  let totalOpportunities = 0;

  try {
    // Fetch all MA data from cache
    const maDataResult = await env.DB_WRITE.prepare(`
      SELECT 
        normalized_symbol,
        exchange,
        timeframe,
        avg_funding_rate,
        avg_funding_rate_annual,
        sample_count
      FROM funding_ma_cache
      WHERE avg_funding_rate IS NOT NULL
        AND avg_funding_rate_annual IS NOT NULL
    `).all();

    if (!maDataResult.success || !maDataResult.results) {
      throw new Error('Failed to fetch MA data');
    }

    const maData = maDataResult.results as MAData[];
    console.log(`[Arbitrage] Loaded ${maData.length} MA records`);

    // Group by symbol
    const symbolMap = new Map<string, MAData[]>();
    for (const ma of maData) {
      if (!symbolMap.has(ma.normalized_symbol)) {
        symbolMap.set(ma.normalized_symbol, []);
      }
      symbolMap.get(ma.normalized_symbol)!.push(ma);
    }

    console.log(`[Arbitrage] Processing ${symbolMap.size} symbols`);

    // Calculate arbitrage opportunities for each timeframe
    for (const timeframe of TIMEFRAMES) {
      const opportunities: ArbitrageOpportunity[] = [];

      // For each symbol, compare all exchange pairs
      for (const [symbol, maList] of symbolMap.entries()) {
        // Filter for current timeframe
        const tfData = maList.filter(ma => ma.timeframe === timeframe);
        
        // Need at least 2 exchanges to compare
        if (tfData.length < 2) continue;

        // Compare all pairs
        for (let i = 0; i < tfData.length; i++) {
          for (let j = i + 1; j < tfData.length; j++) {
            const ma1 = tfData[i];
            const ma2 = tfData[j];

            // Skip if same exchange (shouldn't happen, but safety check)
            if (ma1.exchange === ma2.exchange) continue;

            const rate1 = ma1.avg_funding_rate;
            const rate2 = ma2.avg_funding_rate;
            const apr1 = ma1.avg_funding_rate_annual;
            const apr2 = ma2.avg_funding_rate_annual;

            // Determine long/short positions
            // Long on lower rate, short on higher rate
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

            // Calculate stability score across all timeframes
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
              timeframe,
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

      // Insert opportunities for this timeframe
      if (opportunities.length > 0) {
        console.log(`[Arbitrage] ${timeframe}: Found ${opportunities.length} opportunities`);

        // Batch insert
        const insertStmt = env.DB_WRITE.prepare(`
          INSERT OR REPLACE INTO arbitrage_cache (
            symbol, long_exchange, short_exchange, timeframe,
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
            opp.timeframe,
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

        await env.DB_WRITE.batch(batch);
        totalOpportunities += opportunities.length;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Arbitrage] Completed in ${duration}ms - Total: ${totalOpportunities} opportunities`);
  } catch (error) {
    console.error('[Arbitrage] Error calculating arbitrage:', error);
    throw error;
  }
}

/**
 * Calculate stability score for an exchange pair
 * Returns 0-5 based on how many timeframes show consistent spread direction
 */
function calculateStabilityScore(
  symbol: string,
  exchange1: string,
  exchange2: string,
  isRate1Lower: boolean,
  allMAData: MAData[]
): number {
  let consistentCount = 0;

  for (const timeframe of TIMEFRAMES) {
    const ma1 = allMAData.find(
      ma => ma.exchange === exchange1 && ma.timeframe === timeframe
    );
    const ma2 = allMAData.find(
      ma => ma.exchange === exchange2 && ma.timeframe === timeframe
    );

    if (ma1 && ma2) {
      const tfIsRate1Lower = ma1.avg_funding_rate < ma2.avg_funding_rate;
      if (tfIsRate1Lower === isRate1Lower) {
        consistentCount++;
      }
    }
  }

  return consistentCount;
}

/**
 * Get cached arbitrage opportunities with optional filtering
 */
export async function getCachedArbitrage(
  env: Env,
  options?: {
    symbols?: string[];
    exchanges?: string[];
    timeframes?: string[];
    minSpread?: number;
    minSpreadAPR?: number;
    onlyStable?: boolean;
  }
): Promise<any[]> {
  let query = `
    SELECT 
      symbol,
      long_exchange,
      short_exchange,
      timeframe,
      long_rate,
      short_rate,
      spread,
      long_apr,
      short_apr,
      spread_apr,
      stability_score,
      is_stable,
      calculated_at
    FROM arbitrage_cache
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

  if (options?.timeframes && options.timeframes.length > 0) {
    const placeholders = options.timeframes.map(() => '?').join(',');
    query += ` AND timeframe IN (${placeholders})`;
    params.push(...options.timeframes);
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

  query += ` ORDER BY spread_apr DESC`;

  const result = await env.DB_READ.prepare(query).bind(...params).all();

  if (!result.success || !result.results) {
    throw new Error('Failed to fetch cached arbitrage opportunities');
  }

  return result.results as any[];
}
