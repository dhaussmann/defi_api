/**
 * V2 Extended Funding Rate Collector
 * 
 * Fetches funding rates from Extended API
 * - 1 hour intervals
 * - Calculates both hourly rate and annualized rate
 * 
 * Runs hourly via cron job
 */

import { Env } from '../types';

interface ExtendedFundingRate {
  m: string;      // market name (e.g. "BTC-USD")
  f: string;      // funding rate as string
  T: number;      // timestamp in milliseconds
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectExtendedData(env: Env, limitMarkets?: number): Promise<void> {
  console.log('[V2 Extended] Starting data collection');

  try {
    // Fetch active markets
    let markets = await fetchActiveMarkets();
    console.log(`[V2 Extended] Found ${markets.length} active markets`);

    // Limit for testing if specified
    if (limitMarkets && limitMarkets > 0) {
      markets = markets.slice(0, limitMarkets);
      console.log(`[V2 Extended] Limited to ${markets.length} markets for testing`);
    }

    // Collect data for each market (last 48 hours)
    const now = Math.floor(Date.now() / 1000);
    const startTimestamp = now - (48 * 60 * 60); // 48 hours ago
    
    // Collect data in parallel batches to avoid timeout
    const BATCH_SIZE = 30; // Process 30 markets at a time
    let totalRecords = 0;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);
      console.log(`[V2 Extended] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(markets.length / BATCH_SIZE)} (${batch.length} markets)`);
      
      const results = await Promise.allSettled(
        batch.map(market => collectMarketData(env, market, startTimestamp, now))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          totalRecords += result.value;
          successCount++;
        } else {
          errorCount++;
          console.error(`[V2 Extended] Error collecting ${batch[idx].name}:`, result.reason);
        }
      });

      // Small delay between batches to avoid overwhelming the API
      if (i + BATCH_SIZE < markets.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[V2 Extended] Collection completed: ${totalRecords} records from ${markets.length} markets (${successCount} success, ${errorCount} errors)`);
  } catch (error) {
    console.error('[V2 Extended] Collection failed:', error);
  }
}

/**
 * Fetch active markets from Extended API
 */
async function fetchActiveMarkets(): Promise<Array<{name: string, baseAsset: string}>> {
  try {
    const response = await fetch('https://api.starknet.extended.exchange/api/v1/info/markets', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DefiAPI/1.0)',
        'Accept': 'application/json'
      }
    });
    
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
        baseAsset: m.assetName
      }));
  } catch (error) {
    console.error('[V2 Extended] Failed to fetch markets:', error);
    return [];
  }
}

/**
 * Collect funding data for a single market
 */
async function collectMarketData(
  env: Env,
  market: {name: string, baseAsset: string},
  startTimestamp: number,
  endTimestamp: number
): Promise<number> {
  try {
    // Extended doesn't have historical funding API - we get current funding rate from markets API
    const response = await fetch('https://api.starknet.extended.exchange/api/v1/info/markets', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DefiAPI/1.0)',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Markets API error: ${response.status}`);
    }

    const json = await response.json() as any;
    
    if (!json.data || !Array.isArray(json.data)) {
      return 0;
    }

    // Find our market
    const marketData = json.data.find((m: any) => m.name === market.name);
    if (!marketData || !marketData.marketStats) {
      return 0;
    }

    const stats = marketData.marketStats;
    const collectedAt = Date.now();
    const timestamp = stats.nextFundingRate || collectedAt; // Use next funding time as timestamp
    const intervalHours = 1; // Extended uses 1h intervals
    const eventsPerYear = 365 * 24; // 8760 events per year

    // Store current funding rate
    const rate = parseFloat(stats.fundingRate);
    const ratePercent = rate * 100;
    const rateAnnual = ratePercent * eventsPerYear;

    const statement = env.DB_WRITE.prepare(
      'INSERT OR REPLACE INTO extended_raw_data (symbol, base_asset, timestamp, rate, rate_percent, rate_annual, collected_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      market.name,
      market.baseAsset,
      timestamp,
      rate,
      ratePercent,
      rateAnnual,
      Math.floor(collectedAt / 1000),
      'api'
    );

    await statement.run();

    return 1;
  } catch (error) {
    console.error(`[V2 Extended] Error collecting ${market.name}:`, error);
    return 0;
  }
}
