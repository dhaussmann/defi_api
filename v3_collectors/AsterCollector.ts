/**
 * V3 Aster Funding Rate Collector
 * 
 * Features:
 * - Variable funding intervals (calculated from data median)
 * - Timestamps in milliseconds
 * - Binance-compatible API
 * - Unified V3 schema with percent-based rates
 * - Config system integration
 * 
 * Runs hourly via cron job
 */

import { Env } from '../src/types';
import { 
  EXCHANGE_CONFIGS, 
  calculateRates, 
  validateRate 
} from './ExchangeConfig';

const EXCHANGE_NAME = 'aster';
const CONFIG = EXCHANGE_CONFIGS[EXCHANGE_NAME];

interface AsterMarket {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

interface AsterFundingRate {
  symbol: string;
  fundingTime: number;  // Unix timestamp in milliseconds
  fundingRate: string;  // Decimal rate as string
}

/**
 * Fetch active markets from Aster API
 */
async function fetchActiveMarkets(): Promise<AsterMarket[]> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/exchangeInfo`);
  
  if (!response.ok) {
    throw new Error(`Markets API error: ${response.status}`);
  }

  const data = await response.json() as any;
  
  if (!data.symbols || !Array.isArray(data.symbols)) {
    throw new Error('Invalid markets response');
  }

  return data.symbols
    .filter((m: any) => m.contractType === 'PERPETUAL' && m.status === 'TRADING')
    .map((m: any) => ({
      symbol: m.symbol,
      baseAsset: m.baseAsset,
      quoteAsset: m.quoteAsset
    }));
}

/**
 * Calculate interval hours from funding data (median of intervals)
 */
function calculateIntervalHours(fundings: AsterFundingRate[]): number {
  if (fundings.length < 2) {
    return CONFIG.defaultIntervalHours;
  }

  const intervals: number[] = [];
  for (let i = 1; i < fundings.length; i++) {
    const diff = fundings[i].fundingTime - fundings[i - 1].fundingTime;
    if (diff > 0) {
      intervals.push(diff);
    }
  }

  if (intervals.length === 0) {
    return CONFIG.defaultIntervalHours;
  }

  // Use median interval
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];
  const calculatedHours = Math.round(medianInterval / (60 * 60 * 1000)); // Convert ms to hours
  
  // Return default if calculation results in 0 or invalid value
  return calculatedHours > 0 ? calculatedHours : CONFIG.defaultIntervalHours;
}

/**
 * Main collection function - collects current funding rates
 */
export async function collectAsterV3(env: Env): Promise<void> {
  console.log('[V3 Aster] Starting data collection');

  try {
    // Fetch all active markets dynamically
    const markets = await fetchActiveMarkets();
    console.log(`[V3 Aster] Found ${markets.length} active markets`);

    let totalRecords = 0;
    const collectedAt = Math.floor(Date.now() / 1000);

    // Collect data for last 48 hours (to calculate interval)
    const now = Date.now(); // milliseconds
    const startTime = now - (48 * 60 * 60 * 1000);

    // Process in batches to avoid timeouts
    const BATCH_SIZE = 30;
    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);
      console.log(`[V3 Aster] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(markets.length / BATCH_SIZE)}`);

      // Process batch sequentially to avoid DB batch size limits
      for (const market of batch) {
        try {
          const records = await collectMarketData(env, market, startTime, now, collectedAt);
          totalRecords += records;
        } catch (error) {
          console.error(`[V3 Aster] Error collecting ${market.symbol}:`, error);
        }
      }
    }

    console.log(`[V3 Aster] Collection completed: ${totalRecords} total records from ${markets.length} markets`);
  } catch (error) {
    console.error('[V3 Aster] Collection failed:', error);
  }
}

/**
 * Collect funding data for a single market
 */
async function collectMarketData(
  env: Env,
  market: AsterMarket,
  startTime: number,
  endTime: number,
  collectedAt: number
): Promise<number> {
  const response = await fetch(
    `${CONFIG.apiBaseUrl}/fundingRate?symbol=${market.symbol}&startTime=${startTime}&endTime=${endTime}&limit=1000`
  );

  if (!response.ok) {
    throw new Error(`Funding API error: ${response.status}`);
  }

  const data = await response.json() as AsterFundingRate[];

  if (!Array.isArray(data) || data.length === 0) {
    return 0;
  }

  // Calculate interval from data
  const intervalHours = calculateIntervalHours(data);

  // Process only the most recent record
  const recentData = data.slice(-1);

  const statements = recentData
    .map(item => {
      const rateRaw = parseFloat(item.fundingRate);
      const rates = calculateRates(rateRaw, intervalHours, EXCHANGE_NAME);
      
      // Validate rate
      const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
      if (!validation.valid) {
        console.error(`[V3 Aster] Invalid rate for ${market.symbol}: ${validation.message}`);
        return null;
      }
      if (validation.warning) {
        console.warn(`[V3 Aster] Warning for ${market.symbol}: ${validation.message}`);
      }

      // Convert milliseconds to seconds for funding_time
      const fundingTime = Math.floor(item.fundingTime / 1000);

      return env.DB_WRITE.prepare(`
        INSERT OR REPLACE INTO aster_funding_v3 
        (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        market.symbol,
        market.baseAsset,
        fundingTime,
        rates.rateRaw,
        rates.rateRawPercent,
        intervalHours,
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
export async function importAsterV3(
  env: Env,
  daysBack: number = 30
): Promise<{ success: boolean; records: number; errors: number }> {
  console.log(`[V3 Aster Import] Starting import for last ${daysBack} days`);

  const now = Date.now();
  const startTime = now - (daysBack * 86400 * 1000);
  const collectedAt = Math.floor(Date.now() / 1000);

  // Fetch all active markets dynamically
  const markets = await fetchActiveMarkets();
  console.log(`[V3 Aster Import] Found ${markets.length} active markets`);

  let totalRecords = 0;
  let errorCount = 0;

  // Process sequentially to avoid worker CPU limits
  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    console.log(`[V3 Aster Import] Processing ${i + 1}/${markets.length}: ${market.symbol}`);
    
    try {
      const records = await importMarketHistory(env, market, startTime, now, collectedAt);
      totalRecords += records;
      console.log(`[V3 Aster Import] ${market.symbol}: ${records} records imported`);
    } catch (error) {
      errorCount++;
      console.error(`[V3 Aster Import] Error importing ${market.symbol}:`, error);
    }
    
    // Small delay every 10 markets to avoid rate limits
    if ((i + 1) % 10 === 0 && i + 1 < markets.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`[V3 Aster Import] Completed: ${totalRecords} records, ${errorCount} errors`);
  
  return {
    success: errorCount === 0,
    records: totalRecords,
    errors: errorCount
  };
}

/**
 * Import historical funding data for a single market
 */
async function importMarketHistory(
  env: Env,
  market: AsterMarket,
  startTime: number,
  endTime: number,
  collectedAt: number
): Promise<number> {
  const response = await fetch(
    `${CONFIG.apiBaseUrl}/fundingRate?symbol=${market.symbol}&startTime=${startTime}&endTime=${endTime}&limit=1000`
  );

  if (!response.ok) {
    throw new Error(`Funding API error: ${response.status}`);
  }

  const data = await response.json() as AsterFundingRate[];
  
  if (!Array.isArray(data) || data.length === 0) {
    return 0;
  }

  // Calculate interval from data
  const intervalHours = calculateIntervalHours(data);

  // Process in batches of 100 records
  const BATCH_SIZE = 100;
  let recordCount = 0;

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    
    const statements = batch.map(item => {
      const rateRaw = parseFloat(item.fundingRate);
      const rates = calculateRates(rateRaw, intervalHours, EXCHANGE_NAME);
      
      // Validate rate
      const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
      if (!validation.valid) {
        console.error(`[V3 Aster Import] Invalid rate for ${market.symbol}: ${validation.message}`);
        return null;
      }

      const fundingTime = Math.floor(item.fundingTime / 1000);

      return env.DB_WRITE.prepare(`
        INSERT OR REPLACE INTO aster_funding_v3 
        (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        market.symbol,
        market.baseAsset,
        fundingTime,
        rates.rateRaw,
        rates.rateRawPercent,
        intervalHours,
        rates.rate1hPercent,
        rates.rateApr,
        collectedAt,
        'import'
      );
    }).filter(stmt => stmt !== null) as any[];

    if (statements.length > 0) {
      await env.DB_WRITE.batch(statements);
      recordCount += statements.length;
    }
  }

  return recordCount;
}
