/**
 * Moving Average Cache Module
 * Pre-calculates and caches funding rate moving averages for all tokens and exchanges
 * Runs every 5 minutes via cron job
 */

import { Env } from './types';

// Timeframes to calculate (in seconds)
const TIMEFRAMES = {
  '24h': 24 * 60 * 60,
  '3d': 3 * 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '14d': 14 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
};

/**
 * Calculate and cache moving averages for all tokens and exchanges
 * This function is called every 5 minutes by the cron job
 * Processes one timeframe per invocation to avoid timeout
 */
export async function calculateAndCacheFundingMAs(env: Env): Promise<void> {
  const startTime = Date.now();
  console.log('[MA Cache] Starting moving average calculation...');

  const nowSeconds = Math.floor(Date.now() / 1000);
  
  // Determine which timeframe to calculate based on current minute
  // This ensures we cycle through all timeframes every 25 minutes (5 timeframes × 5 min)
  const currentMinute = new Date().getMinutes();
  const timeframeIndex = currentMinute % 5;
  const timeframeNames = Object.keys(TIMEFRAMES);
  const timeframeName = timeframeNames[timeframeIndex];
  const timeframeSeconds = TIMEFRAMES[timeframeName as keyof typeof TIMEFRAMES];

  try {
    const fromTimestamp = nowSeconds - timeframeSeconds;

    console.log(`[MA Cache] Calculating ${timeframeName} moving averages...`);

    // Single query to calculate MAs for all symbol/exchange combinations for this timeframe
    const query = `
      INSERT OR REPLACE INTO funding_ma_cache (
        normalized_symbol,
        exchange,
        timeframe,
        avg_funding_rate,
        avg_funding_rate_annual,
        sample_count,
        calculated_at
      )
      SELECT 
        normalized_symbol,
        exchange,
        ? as timeframe,
        AVG(avg_funding_rate) as avg_funding_rate,
        AVG(avg_funding_rate_annual) as avg_funding_rate_annual,
        COUNT(*) as sample_count,
        ? as calculated_at
      FROM market_stats_1m
      WHERE minute_timestamp >= ?
        AND minute_timestamp <= ?
        AND avg_funding_rate IS NOT NULL
      GROUP BY normalized_symbol, exchange
    `;

    const result = await env.DB.prepare(query)
      .bind(timeframeName, nowSeconds, fromTimestamp, nowSeconds)
      .run();

    if (result.success) {
      const rowsAffected = result.meta.changes || 0;
      const duration = Date.now() - startTime;
      console.log(`[MA Cache] ${timeframeName}: Cached ${rowsAffected} combinations in ${duration}ms`);
    } else {
      console.error(`[MA Cache] ${timeframeName}: Failed to cache data`);
    }
  } catch (error) {
    console.error('[MA Cache] Error calculating moving averages:', error);
    throw error;
  }
}

/**
 * Get cached moving averages with optional filtering
 */
export async function getCachedFundingMAs(
  env: Env,
  exchanges?: string[],
  symbols?: string[],
  timeframes?: string[]
): Promise<any[]> {
  let query = `
    SELECT 
      normalized_symbol,
      exchange,
      timeframe,
      avg_funding_rate,
      avg_funding_rate_annual,
      sample_count,
      calculated_at
    FROM funding_ma_cache
    WHERE 1=1
  `;

  const params: any[] = [];

  if (exchanges && exchanges.length > 0) {
    const placeholders = exchanges.map(() => '?').join(',');
    query += ` AND exchange IN (${placeholders})`;
    params.push(...exchanges);
  }

  if (symbols && symbols.length > 0) {
    const placeholders = symbols.map(() => '?').join(',');
    query += ` AND normalized_symbol IN (${placeholders})`;
    params.push(...symbols);
  }

  if (timeframes && timeframes.length > 0) {
    const placeholders = timeframes.map(() => '?').join(',');
    query += ` AND timeframe IN (${placeholders})`;
    params.push(...timeframes);
  }

  query += ` ORDER BY normalized_symbol, exchange, timeframe`;

  const result = await env.DB.prepare(query).bind(...params).all();

  if (!result.success || !result.results) {
    throw new Error('Failed to fetch cached moving averages');
  }

  return result.results as any[];
}
