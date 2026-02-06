/**
 * V3 Hyperliquid Funding Rate Collector
 * 
 * Unified schema with:
 * - Consistent percent-based rates
 * - 1h normalized rates
 * - APR calculation
 * - Exchange-specific configuration
 * 
 * Direct API access (no proxy)
 */

import { Env } from '../src/types';
import { 
  getExchangeConfig, 
  calculateRates, 
  validateRate 
} from './ExchangeConfig';

interface HyperliquidMeta {
  universe: Array<{
    name: string;
  }>;
}

interface HyperliquidFundingRate {
  time: number;        // Unix timestamp in milliseconds
  fundingRate: string; // Decimal format
}

const EXCHANGE_NAME = 'hyperliquid';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

/**
 * Fetch active coins from Hyperliquid API
 */
async function fetchActiveCoins(): Promise<string[]> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'meta' })
  });

  if (!response.ok) {
    throw new Error(`Meta API error: ${response.status}`);
  }

  const data = await response.json() as HyperliquidMeta;
  
  if (!data.universe || !Array.isArray(data.universe)) {
    throw new Error('Invalid meta response');
  }

  return data.universe.map(coin => coin.name);
}

/**
 * Main collection function - collects current funding rates
 */
export async function collectHyperliquidV3(env: Env): Promise<void> {
  console.log('[V3 Hyperliquid] Starting data collection');

  try {
    // Fetch all active coins dynamically
    const coins = await fetchActiveCoins();
    console.log(`[V3 Hyperliquid] Found ${coins.length} active coins`);

    let totalRecords = 0;
    const collectedAt = Math.floor(Date.now() / 1000);

    // Collect data for last 1.5 hours (safety buffer for hourly cron)
    const now = Date.now();
    const startTime = now - (90 * 60 * 1000);

    // Process in batches to avoid timeouts
    const BATCH_SIZE = 50;
    for (let i = 0; i < coins.length; i += BATCH_SIZE) {
      const batch = coins.slice(i, i + BATCH_SIZE);
      console.log(`[V3 Hyperliquid] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(coins.length / BATCH_SIZE)}`);

      const results = await Promise.allSettled(
        batch.map(coin => collectCoinData(env, coin, startTime, now, collectedAt))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          totalRecords += result.value;
        } else {
          console.error(`[V3 Hyperliquid] Error collecting ${batch[idx]}:`, result.reason);
        }
      });
    }

    console.log(`[V3 Hyperliquid] Collection completed: ${totalRecords} total records from ${coins.length} coins`);
  } catch (error) {
    console.error('[V3 Hyperliquid] Collection failed:', error);
  }
}

/**
 * Collect funding data for a single coin
 */
async function collectCoinData(
  env: Env,
  coin: string,
  startTime: number,
  endTime: number,
  collectedAt: number
): Promise<number> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'fundingHistory',
      coin: coin,
      startTime: startTime,
      endTime: endTime
    })
  });

  if (!response.ok) {
    throw new Error(`Funding history API error: ${response.status}`);
  }

  const data = await response.json() as HyperliquidFundingRate[];

  if (!Array.isArray(data) || data.length === 0) {
    return 0;
  }

  // Process only the most recent record
  const recentData = data.slice(-1);

  const statements = recentData
    .map(item => {
      const rateRaw = parseFloat(item.fundingRate);
      const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);
      
      // Validate rate
      const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
      if (!validation.valid) {
        console.error(`[V3 Hyperliquid] Invalid rate for ${coin}: ${validation.message}`);
        return null;
      }
      if (validation.warning) {
        console.warn(`[V3 Hyperliquid] Warning for ${coin}: ${validation.message}`);
      }

      return env.DB_WRITE.prepare(`
        INSERT OR REPLACE INTO hyperliquid_funding_v3 
        (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        coin,
        coin,
        Math.floor(item.time / 1000), // Convert ms to seconds
        rates.rateRaw,
        rates.rateRawPercent,
        CONFIG.defaultIntervalHours,
        rates.rate1hPercent,
        rates.rateApr,
        collectedAt,
        'api'
      );
    })
    .filter(stmt => stmt !== null) as any[];

  if (statements.length > 0) {
    await env.DB_WRITE.batch(statements);
  }

  return statements.length;
}

/**
 * Import historical data (called via API endpoint)
 */
export async function importHyperliquidV3(
  env: Env,
  daysBack: number = 30
): Promise<{ success: boolean; records: number; errors: number }> {
  console.log(`[V3 Hyperliquid Import] Starting import for last ${daysBack} days`);

  const endTs = Date.now();
  const startTs = endTs - (daysBack * 86400 * 1000);
  const collectedAt = Math.floor(Date.now() / 1000);

  // Fetch all active coins dynamically
  const coins = await fetchActiveCoins();
  console.log(`[V3 Hyperliquid Import] Found ${coins.length} active coins`);

  let totalRecords = 0;
  let errorCount = 0;

  // Process in batches
  const BATCH_SIZE = 10;
  for (let i = 0; i < coins.length; i += BATCH_SIZE) {
    const batch = coins.slice(i, i + BATCH_SIZE);
    console.log(`[V3 Hyperliquid Import] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(coins.length / BATCH_SIZE)}`);

    for (const coin of batch) {
      try {
        const records = await importCoinHistory(env, coin, startTs, endTs, collectedAt);
        totalRecords += records;
        console.log(`[V3 Hyperliquid Import] ${coin}: ${records} records imported`);
      } catch (error) {
        errorCount++;
        console.error(`[V3 Hyperliquid Import] Error importing ${coin}:`, error);
      }
    }

    // Small delay between batches
    if (i + BATCH_SIZE < coins.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`[V3 Hyperliquid Import] Completed: ${totalRecords} records, ${errorCount} errors`);
  
  return {
    success: errorCount === 0,
    records: totalRecords,
    errors: errorCount
  };
}

/**
 * Import historical funding data for a single coin
 */
async function importCoinHistory(
  env: Env,
  coin: string,
  startTs: number,
  endTs: number,
  collectedAt: number
): Promise<number> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'fundingHistory',
      coin: coin,
      startTime: startTs,
      endTime: endTs
    })
  });

  if (!response.ok) {
    throw new Error(`Funding history API error: ${response.status}`);
  }

  const data = await response.json() as HyperliquidFundingRate[];
  
  if (!Array.isArray(data) || data.length === 0) {
    return 0;
  }

  // Process in batches of 100
  const BATCH_SIZE = 100;
  let recordCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    
    const statements = batch
      .map(item => {
        const rateRaw = parseFloat(item.fundingRate);
        const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);
        
        // Validate rate
        const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
        if (!validation.valid) {
          invalidCount++;
          return null;
        }
        
        return env.DB_WRITE.prepare(`
          INSERT OR REPLACE INTO hyperliquid_funding_v3 
          (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          coin,
          coin,
          Math.floor(item.time / 1000), // Convert ms to seconds
          rates.rateRaw,
          rates.rateRawPercent,
          CONFIG.defaultIntervalHours,
          rates.rate1hPercent,
          rates.rateApr,
          collectedAt,
          'import'
        );
      })
      .filter(stmt => stmt !== null) as any[];

    if (statements.length > 0) {
      await env.DB_WRITE.batch(statements);
      recordCount += statements.length;
    }
  }

  if (invalidCount > 0) {
    console.warn(`[V3 Hyperliquid Import] ${coin}: Skipped ${invalidCount} invalid records`);
  }

  return recordCount;
}
