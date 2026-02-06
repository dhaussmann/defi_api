/**
 * V3 Extended Funding Rate Collector
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

interface ExtendedFundingData {
  m: string;  // market name (e.g. "BTC-USD")
  f: string;  // funding rate (decimal)
  T: number;  // timestamp (Unix seconds)
}

interface ExtendedMarket {
  name: string;      // e.g. "BTC-USD"
  assetName: string; // e.g. "BTC"
}

const EXCHANGE_NAME = 'extended';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

/**
 * Fetch all active markets from Extended API
 */
async function fetchActiveMarkets(): Promise<ExtendedMarket[]> {
  const headers: Record<string, string> = {
    'Accept': 'application/json'
  };
  
  if (CONFIG.requiresUserAgent) {
    headers['User-Agent'] = 'Mozilla/5.0 (compatible; DefiAPI/1.0)';
  }
  
  const response = await fetch(`${CONFIG.apiBaseUrl}/info/markets`, { headers });

  if (!response.ok) {
    throw new Error(`Markets API error: ${response.status}`);
  }

  const json = await response.json() as any;
  
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error('Invalid markets response');
  }

  return json.data
    .filter((m: any) => m.status === 'ACTIVE' && m.active === true)
    .map((m: any) => ({
      name: m.name,
      assetName: m.assetName
    }));
}

/**
 * Main collection function - collects current funding rates
 */
export async function collectExtendedV3(env: Env): Promise<void> {
  console.log('[V3 Extended] Starting data collection');

  try {
    // Fetch all active markets dynamically
    const markets = await fetchActiveMarkets();
    console.log(`[V3 Extended] Found ${markets.length} active markets`);

    let totalRecords = 0;
    const collectedAt = Math.floor(Date.now() / 1000);

    // Fetch all market data once (optimization)
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };
    if (CONFIG.requiresUserAgent) {
      headers['User-Agent'] = 'Mozilla/5.0 (compatible; DefiAPI/1.0)';
    }
    const response = await fetch(`${CONFIG.apiBaseUrl}/info/markets`, { headers });
    if (!response.ok) {
      throw new Error(`Markets API error: ${response.status}`);
    }
    const json = await response.json() as any;
    const allMarketsData = json.data || [];

    // Process in smaller batches to avoid worker CPU limits
    const BATCH_SIZE = 30;
    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);
      console.log(`[V3 Extended] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(markets.length / BATCH_SIZE)}`);

      // Process batch sequentially to avoid DB batch size limits
      for (const market of batch) {
        try {
          const records = await collectMarketDataOptimized(env, market, allMarketsData, collectedAt);
          totalRecords += records;
        } catch (error) {
          console.error(`[V3 Extended] Error collecting ${market.assetName}:`, error);
        }
      }
    }

    console.log(`[V3 Extended] Collection completed: ${totalRecords} total records from ${markets.length} markets`);
  } catch (error) {
    console.error('[V3 Extended] Collection failed:', error);
  }
}

/**
 * Optimized: Collect funding data from pre-fetched market data
 */
async function collectMarketDataOptimized(
  env: Env,
  market: ExtendedMarket,
  allMarketsData: any[],
  collectedAt: number
): Promise<number> {
  // Find market data from pre-fetched data (no additional API call)
  const json = { data: allMarketsData };
  
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error('Invalid markets response');
  }

  // Find our market
  const marketData = json.data.find((m: any) => m.name === market.name);
  if (!marketData || !marketData.marketStats) {
    return 0;
  }

  const stats = marketData.marketStats;
  // Convert timestamp from milliseconds to seconds
  const fundingTime = Math.floor(stats.nextFundingRate / 1000) || collectedAt;
  
  // Parse rate and calculate using exchange config
  const rateRaw = parseFloat(stats.fundingRate);
  const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);
  
  // Validate rate
  const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
  if (!validation.valid) {
    console.error(`[V3 Extended] Invalid rate for ${market.name}: ${validation.message}`);
    return 0;
  }
  if (validation.warning) {
    console.warn(`[V3 Extended] Warning for ${market.name}: ${validation.message}`);
  }

  // Insert into V3 table
  await env.DB_WRITE.prepare(`
    INSERT OR REPLACE INTO extended_funding_v3 
    (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    market.name,
    market.assetName,
    fundingTime,
    rates.rateRaw,
    rates.rateRawPercent,
    CONFIG.defaultIntervalHours,
    rates.rate1hPercent,
    rates.rateApr,
    collectedAt,
    'api'
  ).run();

  return 1;
}

/**
 * Import historical data (called via API endpoint)
 */
export async function importExtendedV3(
  env: Env,
  daysBack: number = 30
): Promise<{ success: boolean; records: number; errors: number }> {
  console.log(`[V3 Extended Import] Starting import for last ${daysBack} days`);

  const endTs = Date.now();
  const startTs = endTs - (daysBack * 86400 * 1000);
  const collectedAt = Math.floor(Date.now() / 1000);

  // Fetch all active markets dynamically
  const markets = await fetchActiveMarkets();
  console.log(`[V3 Extended Import] Found ${markets.length} active markets`);

  let totalRecords = 0;
  let errorCount = 0;

  // Process sequentially to avoid worker CPU limits
  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];
    console.log(`[V3 Extended Import] Processing ${i + 1}/${markets.length}: ${market.assetName}`);
    
    try {
      const records = await importMarketHistory(env, market, startTs, endTs, collectedAt);
      totalRecords += records;
      console.log(`[V3 Extended Import] ${market.assetName}: ${records} records imported`);
    } catch (error) {
      errorCount++;
      console.error(`[V3 Extended Import] Error importing ${market.assetName}:`, error);
    }
    
    // Small delay every 10 markets to avoid rate limits
    if ((i + 1) % 10 === 0 && i + 1 < markets.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`[V3 Extended Import] Completed: ${totalRecords} records, ${errorCount} errors`);
  
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
  market: ExtendedMarket,
  startTs: number,
  endTs: number,
  collectedAt: number
): Promise<number> {
  // Fetch historical funding data (direct API, no proxy)
  const apiUrl = `${CONFIG.apiBaseUrl}/info/${market.name}/funding?startTime=${startTs}&endTime=${endTs}`;
  
  const headers: Record<string, string> = {
    'Accept': 'application/json'
  };
  
  if (CONFIG.requiresUserAgent) {
    headers['User-Agent'] = 'Mozilla/5.0 (compatible; DefiAPI/1.0)';
  }
  
  const response = await fetch(apiUrl, { headers });

  if (!response.ok) {
    throw new Error(`Funding API error: ${response.status}`);
  }

  const data = await response.json() as any;
  
  // Handle both array and wrapped response
  const fundings: ExtendedFundingData[] = Array.isArray(data) ? data : (data.data || []);
  
  if (fundings.length === 0) {
    return 0;
  }

  // Process in batches of 100
  const BATCH_SIZE = 100;
  let recordCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < fundings.length; i += BATCH_SIZE) {
    const batch = fundings.slice(i, i + BATCH_SIZE);
    
    const statements = batch
      .map(item => {
        const rateRaw = parseFloat(item.f);
        const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);
        
        // Validate rate
        const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
        if (!validation.valid) {
          invalidCount++;
          return null;
        }
        
        return env.DB_WRITE.prepare(`
          INSERT OR REPLACE INTO extended_funding_v3 
          (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          market.name,
          market.assetName,
          item.T,
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
    console.warn(`[V3 Extended Import] ${market.assetName}: Skipped ${invalidCount} invalid records`);
  }

  return recordCount;
}
