/**
 * V3 Lighter Funding Rate Collector
 * 
 * Features:
 * - Variable funding intervals (calculated from data)
 * - Direction field (long/short)
 * - Cumulative value timestamps
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

const EXCHANGE_NAME = 'lighter';
const CONFIG = EXCHANGE_CONFIGS[EXCHANGE_NAME];

interface LighterMarket {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

interface LighterFunding {
  timestamp: number;    // Unix timestamp in seconds
  value: string;        // Cumulative value
  rate: string;         // Funding rate as decimal
  direction: 'long' | 'short';
}

interface LighterFundingsResponse {
  fundings: LighterFunding[];
}

/**
 * Fetch active markets from Lighter API
 */
async function fetchActiveMarkets(): Promise<LighterMarket[]> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/orderBooks`);
  
  if (!response.ok) {
    throw new Error(`Markets API error: ${response.status}`);
  }

  const data = await response.json() as any;
  
  if (!data.order_books || !Array.isArray(data.order_books)) {
    throw new Error('Invalid markets response');
  }

  return data.order_books
    .filter((m: any) => m.status === 'active')
    .map((m: any) => ({
      id: m.market_id,
      symbol: m.symbol,
      baseAsset: m.base_asset || m.symbol.split('-')[0],
      quoteAsset: m.quote_asset || 'USDT'
    }));
}

/**
 * Calculate interval hours from funding data
 */
function calculateIntervalHours(fundings: LighterFunding[]): number {
  if (fundings.length < 2) {
    return CONFIG.defaultIntervalHours;
  }

  const intervals: number[] = [];
  for (let i = 1; i < fundings.length; i++) {
    const diff = fundings[i].timestamp - fundings[i - 1].timestamp;
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
  const calculatedHours = Math.round(medianInterval / 3600);
  
  // Return default if calculation results in 0 or invalid value
  return calculatedHours > 0 ? calculatedHours : CONFIG.defaultIntervalHours;
}

/**
 * Main collection function - collects current funding rates
 * Always inserts a record for every market at the current hour
 */
export async function collectLighterV3(env: Env): Promise<void> {
  console.log('[V3 Lighter] Starting data collection');

  try {
    // Fetch all active markets dynamically
    const markets = await fetchActiveMarkets();
    console.log(`[V3 Lighter] Found ${markets.length} active markets`);

    let totalRecords = 0;
    const collectedAt = Math.floor(Date.now() / 1000);
    
    // Round to current hour for consistent funding_time
    const currentHour = Math.floor(collectedAt / 3600) * 3600;

    // Collect data for last 24 hours (to calculate interval)
    const now = Math.floor(Date.now() / 1000);
    const startTimestamp = now - (24 * 60 * 60);

    // Process in batches to avoid timeouts
    const BATCH_SIZE = 30;
    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);
      console.log(`[V3 Lighter] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(markets.length / BATCH_SIZE)}`);

      // Process batch sequentially to avoid DB batch size limits
      for (const market of batch) {
        try {
          console.log(`[V3 Lighter] Collecting ${market.symbol} (ID: ${market.id})...`);
          const records = await collectMarketData(env, market, startTimestamp, now, collectedAt, currentHour);
          totalRecords += records;
          console.log(`[V3 Lighter] ${market.symbol}: ${records} records collected`);
        } catch (error) {
          console.error(`[V3 Lighter] Error collecting ${market.symbol}:`, error);
        }
      }
    }

    console.log(`[V3 Lighter] Collection completed: ${totalRecords} total records from ${markets.length} markets`);
  } catch (error) {
    console.error('[V3 Lighter] Collection failed:', error);
  }
}

/**
 * Collect funding data for a single market
 * Always inserts a record for the current hour using the most recent funding rate
 */
async function collectMarketData(
  env: Env,
  market: LighterMarket,
  startTimestamp: number,
  endTimestamp: number,
  collectedAt: number,
  currentHour: number
): Promise<number> {
  const apiUrl = `${CONFIG.apiBaseUrl}/fundings?market_id=${market.id}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}&count_back=0`;
  console.log(`[V3 Lighter] API call: ${apiUrl}`);
  
  const response = await fetch(apiUrl);

  if (!response.ok) {
    console.error(`[V3 Lighter] API error ${response.status} for ${market.symbol}`);
    throw new Error(`Funding API error: ${response.status}`);
  }

  const data = await response.json() as LighterFundingsResponse;
  console.log(`[V3 Lighter] ${market.symbol}: received ${data.fundings?.length || 0} fundings`);

  if (!data.fundings || !Array.isArray(data.fundings) || data.fundings.length === 0) {
    console.log(`[V3 Lighter] ${market.symbol}: no funding data`);
    return 0;
  }

  // Calculate interval from data
  const intervalHours = calculateIntervalHours(data.fundings);
  console.log(`[V3 Lighter] ${market.symbol}: interval = ${intervalHours}h`);

  // Get the most recent funding rate
  const mostRecent = data.fundings[data.fundings.length - 1];
  console.log(`[V3 Lighter] ${market.symbol}: using most recent rate from ${new Date(mostRecent.timestamp * 1000).toISOString()}`);

  // Apply correct sign based on direction
  const rateRaw = mostRecent.direction === 'short' ? -parseFloat(mostRecent.rate) : parseFloat(mostRecent.rate);
  const rates = calculateRates(rateRaw, intervalHours, EXCHANGE_NAME);
  
  // Validate rate
  const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
  if (!validation.valid) {
    console.error(`[V3 Lighter] Invalid rate for ${market.symbol}: ${validation.message}`);
    return 0;
  }
  if (validation.warning) {
    console.warn(`[V3 Lighter] Warning for ${market.symbol}: ${validation.message}`);
  }

  // Always use current hour as funding_time for consistency
  const fundingTime = currentHour;

  const statement = env.DB_WRITE.prepare(`
    INSERT OR REPLACE INTO lighter_funding_v3 
    (symbol, base_asset, market_id, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, direction, cumulative_value, collected_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    market.symbol,
    market.baseAsset,
    parseInt(market.id),
    fundingTime,
    rates.rateRaw,
    rates.rateRawPercent,
    intervalHours,
    rates.rate1hPercent,
    rates.rateApr,
    mostRecent.direction,
    parseFloat(mostRecent.value),
    collectedAt,
    'api'
  );

  await env.DB_WRITE.batch([statement]);
  return 1;
}

/**
 * Import historical data (called via API endpoint)
 */
export async function importLighterV3(
  env: Env,
  daysBack: number = 30
): Promise<{ success: boolean; records: number; errors: number }> {
  console.log(`[V3 Lighter Import] Starting import for last ${daysBack} days`);

  const now = Math.floor(Date.now() / 1000);
  const startTimestamp = now - (daysBack * 86400);
  const collectedAt = Math.floor(Date.now() / 1000);

  // Fetch all active markets dynamically
  const markets = await fetchActiveMarkets();
  console.log(`[V3 Lighter Import] Found ${markets.length} active markets`);

  let totalRecords = 0;
  let errorCount = 0;

  // Process sequentially to avoid worker CPU limits
  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    console.log(`[V3 Lighter Import] Processing ${i + 1}/${markets.length}: ${market.symbol}`);
    
    try {
      const records = await importMarketHistory(env, market, startTimestamp, now, collectedAt);
      totalRecords += records;
      console.log(`[V3 Lighter Import] ${market.symbol}: ${records} records imported`);
    } catch (error) {
      errorCount++;
      console.error(`[V3 Lighter Import] Error importing ${market.symbol}:`, error);
    }
    
    // Small delay every 10 markets to avoid rate limits
    if ((i + 1) % 10 === 0 && i + 1 < markets.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`[V3 Lighter Import] Completed: ${totalRecords} records, ${errorCount} errors`);
  
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
  market: LighterMarket,
  startTimestamp: number,
  endTimestamp: number,
  collectedAt: number
): Promise<number> {
  const response = await fetch(
    `${CONFIG.apiBaseUrl}/fundings?market_id=${market.id}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}&count_back=0`
  );

  if (!response.ok) {
    throw new Error(`Funding API error: ${response.status}`);
  }

  const data = await response.json() as LighterFundingsResponse;
  
  if (!data.fundings || !Array.isArray(data.fundings) || data.fundings.length === 0) {
    return 0;
  }

  // Calculate interval from data
  const intervalHours = calculateIntervalHours(data.fundings);

  // Process in batches of 100 records
  const BATCH_SIZE = 100;
  let recordCount = 0;

  for (let i = 0; i < data.fundings.length; i += BATCH_SIZE) {
    const batch = data.fundings.slice(i, i + BATCH_SIZE);
    
    const statements = batch.map(item => {
      // Apply correct sign based on direction
      // short = shorts pay longs → negative rate
      // long = longs pay shorts → positive rate
      const rateRaw = item.direction === 'short' ? -parseFloat(item.rate) : parseFloat(item.rate);
      const rates = calculateRates(rateRaw, intervalHours, EXCHANGE_NAME);
      
      // Validate rate
      const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
      if (!validation.valid) {
        console.error(`[V3 Lighter Import] Invalid rate for ${market.symbol}: ${validation.message}`);
        return null;
      }

      const fundingTime = item.timestamp;

      return env.DB_WRITE.prepare(`
        INSERT OR REPLACE INTO lighter_funding_v3 
        (symbol, base_asset, market_id, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, direction, cumulative_value, collected_at, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        market.symbol,
        market.baseAsset,
        parseInt(market.id),
        fundingTime,
        rates.rateRaw,
        rates.rateRawPercent,
        intervalHours,
        rates.rate1hPercent,
        rates.rateApr,
        item.direction,
        parseFloat(item.value),
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
