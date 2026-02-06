/**
 * V2 Lighter Funding Rate Collector
 * 
 * Fetches funding rates from Lighter API
 * - Variable intervals
 * - Calculates both hourly rate and annualized rate
 * 
 * Runs hourly via cron job
 */

import { Env } from '../types';

interface LighterMarket {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

interface LighterFunding {
  value: string;
  rate: string;
  direction: 'long' | 'short';
}

interface LighterFundingsResponse {
  fundings: LighterFunding[];
}

/**
 * Main collection function - fetches and stores Lighter funding data
 */
export async function collectLighterData(env: Env, limitMarkets?: number): Promise<void> {
  console.log('[V2 Lighter] Starting data collection');

  try {
    // Update market metadata
    await updateMarketMetadata(env);

    // Fetch active markets
    let markets = await fetchActiveMarkets();
    console.log(`[V2 Lighter] Found ${markets.length} active markets`);

    // Limit for testing if specified
    if (limitMarkets && limitMarkets > 0) {
      markets = markets.slice(0, limitMarkets);
      console.log(`[V2 Lighter] Limited to ${markets.length} markets for testing`);
    }

    // Collect data for each market (last 24 hours)
    const now = Math.floor(Date.now() / 1000);
    const startTimestamp = now - (24 * 60 * 60); // 24 hours ago
    
    // Collect data in parallel batches to avoid timeout
    const BATCH_SIZE = 30; // Process 30 markets at a time
    let totalRecords = 0;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);
      console.log(`[V2 Lighter] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(markets.length / BATCH_SIZE)} (${batch.length} markets)`);
      
      const results = await Promise.allSettled(
        batch.map(market => collectMarketData(env, market, startTimestamp, now))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          totalRecords += result.value;
          successCount++;
        } else {
          errorCount++;
          console.error(`[V2 Lighter] Error collecting ${batch[idx].symbol}:`, result.reason);
        }
      });

      // Small delay between batches to avoid overwhelming the API
      if (i + BATCH_SIZE < markets.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[V2 Lighter] Collection completed: ${totalRecords} records from ${markets.length} markets (${successCount} success, ${errorCount} errors)`);
  } catch (error) {
    console.error('[V2 Lighter] Collection failed:', error);
  }
}

/**
 * Fetch active markets from Lighter API
 */
async function fetchActiveMarkets(): Promise<LighterMarket[]> {
  try {
    const response = await fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBooks');
    
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
  } catch (error) {
    console.error('[V2 Lighter] Failed to fetch markets:', error);
    return [];
  }
}

/**
 * Update market metadata
 */
async function updateMarketMetadata(env: Env): Promise<void> {
  const markets = await fetchActiveMarkets();
  const timestamp = Math.floor(Date.now() / 1000);
  
  const statements = markets.map(m =>
    env.DB_WRITE.prepare(
      'INSERT OR REPLACE INTO lighter_markets (market_id, symbol, status, last_updated) VALUES (?, ?, ?, ?)'
    ).bind(m.id, m.symbol, 'active', timestamp)
  );

  // Batch in groups of 50
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB_WRITE.batch(statements.slice(i, i + 50));
  }
}

/**
 * Collect funding data for a single market
 */
async function collectMarketData(
  env: Env,
  market: LighterMarket,
  startTimestamp: number,
  endTimestamp: number
): Promise<number> {
  try {
    const response = await fetch(
      `https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=${market.id}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}&count_back=0`
    );

    if (!response.ok) {
      throw new Error(`Funding API error: ${response.status}`);
    }

    const data = await response.json() as LighterFundingsResponse;

    if (!data.fundings || !Array.isArray(data.fundings) || data.fundings.length === 0) {
      return 0;
    }

    // Process only last 2 records to avoid duplicates
    const recentData = data.fundings.slice(-2);
    const collectedAt = Math.floor(Date.now() / 1000); // Unix seconds

    // Calculate interval from data
    let intervalHours = 8; // Default
    if (data.fundings.length > 1) {
      const intervals: number[] = [];
      for (let i = 1; i < data.fundings.length; i++) {
        const diff = parseFloat(data.fundings[i].value) - parseFloat(data.fundings[i - 1].value);
        intervals.push(diff);
      }
      if (intervals.length > 0) {
        intervals.sort((a, b) => a - b);
        const medianInterval = intervals[Math.floor(intervals.length / 2)];
        intervalHours = Math.round(medianInterval / 3600);
      }
    }

    const eventsPerYear = 365 * (24 / intervalHours);

    const statements = recentData.map(item => {
      const timestampMs = parseFloat(item.value) * 1000;
      const rate = parseFloat(item.rate);
      const ratePercent = rate * 100;
      const rateHourly = ratePercent / intervalHours;
      const rateAnnual = ratePercent * eventsPerYear;

      return env.DB_WRITE.prepare(
        'INSERT OR REPLACE INTO lighter_raw_data (market_id, symbol, timestamp, rate, rate_annual, direction, cumulative_value, collected_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        market.id,
        market.symbol,
        timestampMs,
        rate,
        rateAnnual,
        item.direction,
        parseFloat(item.value),
        collectedAt,
        'api'
      );
    });

    await env.DB_WRITE.batch(statements);

    return recentData.length;
  } catch (error) {
    console.error(`[V2 Lighter] Error collecting ${market.symbol}:`, error);
    return 0;
  }
}
