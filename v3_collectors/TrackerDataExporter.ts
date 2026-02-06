/**
 * Tracker Data Exporter
 * 
 * Exports historical tracker data from market_history to V3 funding tables.
 * Covers the gap period: 2026-01-30 to 2026-02-05 18:00
 */

import { Env } from '../src/types';
import { EXCHANGE_CONFIGS } from './ExchangeConfig';

// Exchange name mapping: market_history → V3 table
const EXCHANGE_MAPPING: Record<string, string> = {
  'hyperliquid': 'hyperliquid',
  'lighter': 'lighter',
  'edgex': 'edgex',
  'paradex': 'paradex',
  'extended': 'extended',
  'variational': 'variational',
  'hyena': 'hyena',
  'flx': 'felix',
  'vntl': 'ventuals',
  'xyz': 'xyz'
};

// Exchange interval configuration (hours)
const EXCHANGE_INTERVALS: Record<string, number> = {
  'hyperliquid': 8,
  'lighter': 1,
  'edgex': 4,
  'paradex': 8,
  'extended': 1,
  'variational': 8,  // Default, can be variable
  'hyena': 8,
  'felix': 8,
  'ventuals': 8,
  'xyz': 8
};

interface MarketHistoryRow {
  exchange: string;
  symbol: string;
  normalized_symbol: string;
  hour_timestamp: number;
  avg_funding_rate: number;
  avg_funding_rate_annual: number;
  sample_count: number;
}

/**
 * Extract base asset from symbol
 */
function extractBaseAsset(symbol: string, exchange: string): string {
  // Remove common suffixes
  let base = symbol
    .replace(/-USD-PERP$/, '')
    .replace(/-PERP$/, '')
    .replace(/-USD$/, '')
    .replace(/USDT$/, '')
    .replace(/USD$/, '')
    .replace(/1000$/, '')
    .replace(/k$/, '');
  
  // Handle special cases
  if (exchange === 'paradex') {
    base = symbol.split('-')[0];
  }
  
  return base.toUpperCase();
}

/**
 * Calculate 1h normalized rate
 */
function calculate1hRate(rateRaw: number, intervalHours: number): number {
  return (rateRaw * 100) / intervalHours;
}

/**
 * Export tracker data for a single exchange
 */
export async function exportTrackerDataForExchange(
  env: Env,
  trackerExchange: string,
  endTimestamp: number = 1770253200  // 2026-02-05 18:00 (actually 01:00 UTC)
): Promise<number> {
  const v3Exchange = EXCHANGE_MAPPING[trackerExchange];
  
  if (!v3Exchange) {
    console.log(`[Export] Skipping ${trackerExchange} - no V3 mapping`);
    return 0;
  }
  
  const v3Table = `${v3Exchange}_funding_v3`;
  const intervalHours = EXCHANGE_INTERVALS[v3Exchange] || 8;
  
  console.log(`[Export] Starting export for ${trackerExchange} → ${v3Table}`);
  console.log(`[Export] Interval: ${intervalHours}h, End: ${new Date(endTimestamp * 1000).toISOString()}`);
  
  // Fetch data from market_history
  const query = `
    SELECT 
      exchange,
      symbol,
      normalized_symbol,
      hour_timestamp,
      avg_funding_rate,
      avg_funding_rate_annual,
      sample_count
    FROM market_history
    WHERE exchange = ?
      AND hour_timestamp <= ?
      AND sample_count > 0
    ORDER BY hour_timestamp, symbol
  `;
  
  const result = await env.DB_WRITE.prepare(query)
    .bind(trackerExchange, endTimestamp)
    .all();
  
  if (!result.success || !result.results || result.results.length === 0) {
    console.log(`[Export] No data found for ${trackerExchange}`);
    return 0;
  }
  
  console.log(`[Export] Found ${result.results.length} hourly records for ${trackerExchange}`);
  
  // Transform and insert in batches
  const BATCH_SIZE = 500;
  let totalInserted = 0;
  const collectedAt = Math.floor(Date.now() / 1000);
  
  for (let i = 0; i < result.results.length; i += BATCH_SIZE) {
    const batch = result.results.slice(i, i + BATCH_SIZE) as MarketHistoryRow[];
    const statements = [];
    
    for (const row of batch) {
      const baseAsset = extractBaseAsset(row.normalized_symbol, v3Exchange);
      const rateRaw = row.avg_funding_rate;
      const rateRawPercent = rateRaw * 100;
      const rate1hPercent = calculate1hRate(rateRaw, intervalHours);
      const rateApr = row.avg_funding_rate_annual;
      
      // Skip invalid rates
      if (Math.abs(rateRawPercent) > 10) {
        console.warn(`[Export] Skipping invalid rate for ${row.symbol}: ${rateRawPercent}%`);
        continue;
      }
      
      statements.push(
        env.DB_WRITE.prepare(`
          INSERT OR IGNORE INTO ${v3Table}
          (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, 
           interval_hours, rate_1h_percent, rate_apr, collected_at, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          row.normalized_symbol,
          baseAsset,
          row.hour_timestamp,
          rateRaw,
          rateRawPercent,
          intervalHours,
          rate1hPercent,
          rateApr,
          collectedAt,
          'tracker_export'
        )
      );
    }
    
    if (statements.length > 0) {
      await env.DB_WRITE.batch(statements);
      totalInserted += statements.length;
      console.log(`[Export] Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${statements.length} records`);
    }
  }
  
  console.log(`[Export] Completed ${trackerExchange}: ${totalInserted} records inserted into ${v3Table}`);
  return totalInserted;
}

/**
 * Export tracker data for all exchanges
 */
export async function exportAllTrackerData(
  env: Env,
  endTimestamp: number = 1770253200  // 2026-02-05 18:00 (actually 01:00 UTC)
): Promise<Record<string, number>> {
  console.log('[Export] Starting tracker data export for all exchanges');
  console.log(`[Export] End timestamp: ${endTimestamp} (${new Date(endTimestamp * 1000).toISOString()})`);
  
  const results: Record<string, number> = {};
  const exchanges = Object.keys(EXCHANGE_MAPPING);
  
  for (const trackerExchange of exchanges) {
    try {
      const count = await exportTrackerDataForExchange(env, trackerExchange, endTimestamp);
      results[trackerExchange] = count;
    } catch (error) {
      console.error(`[Export] Failed to export ${trackerExchange}:`, error);
      results[trackerExchange] = 0;
    }
  }
  
  const totalRecords = Object.values(results).reduce((sum, count) => sum + count, 0);
  console.log(`[Export] Total records exported: ${totalRecords}`);
  console.log('[Export] Export summary:', results);
  
  return results;
}
