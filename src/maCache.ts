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
 * Calculates all timeframes sequentially with small delays to avoid timeout
 */
export async function calculateAndCacheFundingMAs(env: Env): Promise<void> {
  const startTime = Date.now();
  console.log('[MA Cache] Starting moving average calculation for all timeframes...');

  const nowSeconds = Math.floor(Date.now() / 1000);
  let totalCalculated = 0;

  try {
    // Calculate each timeframe sequentially using only market_history
    for (const [timeframeName, timeframeSeconds] of Object.entries(TIMEFRAMES)) {
      const fromTimestamp = nowSeconds - timeframeSeconds;

      console.log(`[MA Cache] Calculating ${timeframeName}...`);

      // Simple query: calculate MA directly from market_history hourly aggregates
      // Calculate avg_funding_rate_annual using the same logic as in aggregation
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
          symbol as normalized_symbol,
          exchange,
          ? as timeframe,
          AVG(avg_funding_rate) as avg_funding_rate,
          AVG(avg_funding_rate_annual) as avg_funding_rate_annual,
          COUNT(*) as sample_count,
          ? as calculated_at
        FROM market_history
        WHERE hour_timestamp >= ?
          AND hour_timestamp <= ?
          AND avg_funding_rate IS NOT NULL
        GROUP BY symbol, exchange
      `;

      const result = await env.DB_WRITE.prepare(query)
        .bind(timeframeName, nowSeconds, fromTimestamp, nowSeconds)
        .run();

      if (result.success) {
        const rowsAffected = result.meta.changes || 0;
        totalCalculated += rowsAffected;
        console.log(`[MA Cache] ${timeframeName}: Cached ${rowsAffected} combinations`);
      } else {
        console.error(`[MA Cache] ${timeframeName}: Failed to cache data`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[MA Cache] All timeframes calculated in ${duration}ms - Total: ${totalCalculated} entries`);
  } catch (error) {
    console.error('[MA Cache] Error calculating moving averages:', error);
    throw error;
  }
}

/**
 * Calculate all timeframes at once (for initial population or manual refresh)
 * This should only be used for admin/manual triggers, not in cron
 */
export async function calculateAllTimeframes(env: Env): Promise<void> {
  // Use the same logic as calculateAndCacheFundingMAs
  await calculateAndCacheFundingMAs(env);
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
    // Support pattern matching for symbols to handle exchange-specific formats
    // e.g., BTC matches BTC, BTCUSD, BTC-USD, BTC-USD-PERP, hyna:BTC, etc.
    const symbolConditions = symbols.map(() => {
      return `(normalized_symbol = ? OR normalized_symbol = ? OR normalized_symbol LIKE ? OR normalized_symbol LIKE ? OR normalized_symbol LIKE ?)`;
    }).join(' OR ');
    query += ` AND (${symbolConditions})`;
    
    // For each symbol, add patterns: exact, exact USD, %-USD%, %:symbol, symbol%
    for (const symbol of symbols) {
      params.push(symbol);             // Exact match: BTC
      params.push(`${symbol}USD`);     // Exact match: BTCUSD
      params.push(`${symbol}-USD%`);   // Pattern: BTC-USD-PERP
      params.push(`%:${symbol}`);      // Pattern: hyna:BTC, flx:BTC
      params.push(`${symbol}%`);       // Pattern: BTC* (catch-all)
    }
  }

  if (timeframes && timeframes.length > 0) {
    const placeholders = timeframes.map(() => '?').join(',');
    query += ` AND timeframe IN (${placeholders})`;
    params.push(...timeframes);
  }

  query += ` ORDER BY normalized_symbol, exchange, timeframe`;

  const result = await env.DB_WRITE.prepare(query).bind(...params).all();

  if (!result.success || !result.results) {
    throw new Error('Failed to fetch cached moving averages');
  }

  return result.results as any[];
}
