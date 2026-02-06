/**
 * V2 Hyperliquid Funding Rate Collector
 * 
 * Fetches funding rates from Hyperliquid API
 * - 1 hour intervals
 * - Calculates both hourly rate and annualized rate
 * 
 * Runs hourly via cron job
 */

import { Env } from '../types';

interface HyperliquidMeta {
  universe: Array<{
    name: string;
  }>;
}

interface HyperliquidFundingRate {
  time: number;
  fundingRate: string;
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectHyperliquidData(env: Env, limitCoins?: number): Promise<void> {
  console.log('[V2 Hyperliquid] Starting data collection');

  try {
    // Fetch active coins
    let coins = await fetchActiveCoins();
    console.log(`[V2 Hyperliquid] Found ${coins.length} active coins`);

    // Limit for testing if specified
    if (limitCoins && limitCoins > 0) {
      coins = coins.slice(0, limitCoins);
      console.log(`[V2 Hyperliquid] Limited to ${coins.length} coins for testing`);
    }

    // Collect data for each coin (last 48 hours)
    const now = Date.now();
    const startTime = now - (48 * 60 * 60 * 1000); // 48 hours ago
    
    // Collect data in parallel batches to avoid timeout
    const BATCH_SIZE = 40; // Process 40 coins at a time
    let totalRecords = 0;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < coins.length; i += BATCH_SIZE) {
      const batch = coins.slice(i, i + BATCH_SIZE);
      console.log(`[V2 Hyperliquid] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(coins.length / BATCH_SIZE)} (${batch.length} coins)`);
      
      const results = await Promise.allSettled(
        batch.map(coin => collectCoinData(env, coin, startTime, now))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          totalRecords += result.value;
          successCount++;
        } else {
          errorCount++;
          console.error(`[V2 Hyperliquid] Error collecting ${batch[idx]}:`, result.reason);
        }
      });

      // Small delay between batches to avoid overwhelming the API
      if (i + BATCH_SIZE < coins.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[V2 Hyperliquid] Collection completed: ${totalRecords} records from ${coins.length} coins (${successCount} success, ${errorCount} errors)`);
  } catch (error) {
    console.error('[V2 Hyperliquid] Collection failed:', error);
  }
}

/**
 * Fetch active coins from Hyperliquid API
 */
async function fetchActiveCoins(): Promise<string[]> {
  try {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
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
  } catch (error) {
    console.error('[V2 Hyperliquid] Failed to fetch coins:', error);
    return [];
  }
}

/**
 * Collect funding data for a single coin
 */
async function collectCoinData(
  env: Env,
  coin: string,
  startTime: number,
  endTime: number
): Promise<number> {
  try {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
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

    // Process only last 2 records to avoid duplicates
    const recentData = data.slice(-2);
    const collectedAt = Math.floor(Date.now() / 1000); // Unix seconds
    const intervalHours = 1; // Hyperliquid uses 1h intervals
    const eventsPerYear = 365 * 24; // 8760 events per year

    const statements = recentData.map(item => {
      const rate = parseFloat(item.fundingRate);
      const ratePercent = rate * 100;
      const rateAnnual = ratePercent * eventsPerYear;

      return env.DB_WRITE.prepare(
        'INSERT OR REPLACE INTO hyperliquid_raw_data (symbol, timestamp, rate, rate_percent, rate_annual, collected_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        coin,
        item.time,
        rate,
        ratePercent,
        rateAnnual,
        collectedAt,
        'api'
      );
    });

    await env.DB_WRITE.batch(statements);

    return recentData.length;
  } catch (error) {
    console.error(`[V2 Hyperliquid] Error collecting ${coin}:`, error);
    return 0;
  }
}
