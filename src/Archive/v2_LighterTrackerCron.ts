/**
 * V2 Lighter Tracker - Hourly Cron Job
 * 
 * Fetches funding rate data from Lighter API every hour (at :00)
 * Stores data in lighter_funding_v2 table with pre-calculated APR
 * 
 * This is a simplified, cron-based approach compared to the WebSocket-based V1 tracker
 */

import { Env } from '../types';

interface LighterMarket {
  market_id: number;
  symbol: string;
  status: string;
}

interface LighterFunding {
  timestamp: number;
  value: string;
  rate: string;
  direction: 'long' | 'short';
}

interface LighterFundingsResponse {
  fundings: LighterFunding[];
}

/**
 * Main function to fetch and store Lighter funding data
 * Called by cron trigger every hour
 */
export async function collectLighterFundingV2(env: Env): Promise<void> {
  const startTime = Date.now();
  console.log('[V2 Lighter] Starting hourly funding rate collection...');

  try {
    // Update tracker status
    await updateTrackerStatus(env, 'running', null);

    // Step 1: Fetch active markets
    const markets = await fetchActiveMarkets();
    console.log(`[V2 Lighter] Found ${markets.length} active markets`);

    // Step 2: Update market metadata
    await updateMarketMetadata(env, markets);

    // Step 3: Fetch funding data for each market (last 2 hours to ensure we don't miss anything)
    const now = Math.floor(Date.now() / 1000);
    const twoHoursAgo = now - (2 * 3600);
    
    let totalRecords = 0;
    const batchSize = 10; // Process 10 markets at a time
    
    for (let i = 0; i < markets.length; i += batchSize) {
      const batch = markets.slice(i, i + batchSize);
      const batchPromises = batch.map(market => 
        fetchAndStoreFundingData(env, market, twoHoursAgo, now)
      );
      
      const results = await Promise.allSettled(batchPromises);
      
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          totalRecords += result.value;
        } else {
          console.error(`[V2 Lighter] Failed to process ${batch[idx].symbol}:`, result.reason);
        }
      });
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < markets.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Update tracker status
    const duration = Date.now() - startTime;
    await updateTrackerStatus(env, 'idle', null);
    await incrementTrackerStats(env, totalRecords);

    console.log(`[V2 Lighter] Collection complete: ${totalRecords} records in ${duration}ms`);

  } catch (error) {
    console.error('[V2 Lighter] Collection failed:', error);
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await updateTrackerStatus(env, 'error', errorMsg);
    throw error;
  }
}

/**
 * Fetch active markets from Lighter API
 */
async function fetchActiveMarkets(): Promise<LighterMarket[]> {
  const response = await fetch('https://mainnet.zklighter.elliot.ai/api/v1/orderBooks');
  
  if (!response.ok) {
    throw new Error(`Failed to fetch markets: ${response.status}`);
  }

  const data = await response.json() as { order_books: LighterMarket[] };
  
  return data.order_books.filter(m => m.status === 'active');
}

/**
 * Update market metadata in database
 */
async function updateMarketMetadata(env: Env, markets: LighterMarket[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  
  const statements = markets.map(market => 
    env.DB_WRITE.prepare(`
      INSERT OR REPLACE INTO lighter_markets_v2 (market_id, symbol, status, last_updated)
      VALUES (?, ?, ?, ?)
    `).bind(market.market_id, market.symbol, market.status, now)
  );

  await env.DB_WRITE.batch(statements);
  console.log(`[V2 Lighter] Updated metadata for ${markets.length} markets`);
}

/**
 * Fetch and store funding data for a single market
 */
async function fetchAndStoreFundingData(
  env: Env,
  market: LighterMarket,
  startTimestamp: number,
  endTimestamp: number
): Promise<number> {
  try {
    // Fetch funding data from API
    const url = `https://mainnet.zklighter.elliot.ai/api/v1/fundings?market_id=${market.market_id}&resolution=1h&start_timestamp=${startTimestamp}&end_timestamp=${endTimestamp}&count_back=0`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as LighterFundingsResponse;

    if (!data.fundings || data.fundings.length === 0) {
      return 0;
    }

    // Prepare insert statements
    const collectedAt = Math.floor(Date.now() / 1000);
    const statements = data.fundings.map(funding => {
      const rate = parseFloat(funding.rate);
      const rateAnnual = rate * 24 * 365; // APR calculation
      const cumulativeValue = parseFloat(funding.value);

      return env.DB_WRITE.prepare(`
        INSERT OR REPLACE INTO lighter_funding_v2 (
          market_id, symbol, timestamp,
          rate, rate_hourly, rate_annual,
          direction, cumulative_value,
          collected_at, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        market.market_id,
        market.symbol,
        funding.timestamp,
        rate,
        rate,
        rateAnnual,
        funding.direction,
        cumulativeValue,
        collectedAt,
        'api'
      );
    });

    // Execute batch insert
    await env.DB_WRITE.batch(statements);

    console.log(`[V2 Lighter] ${market.symbol}: Stored ${data.fundings.length} records`);
    return data.fundings.length;

  } catch (error) {
    console.error(`[V2 Lighter] Error processing ${market.symbol}:`, error);
    return 0;
  }
}

/**
 * Update tracker status
 */
async function updateTrackerStatus(
  env: Env,
  status: 'idle' | 'running' | 'error',
  error: string | null
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  
  if (status === 'idle' || status === 'running') {
    await env.DB_WRITE.prepare(`
      UPDATE lighter_tracker_status_v2 
      SET status = ?, last_run = ?, last_success = ?, last_error = NULL
      WHERE id = 1
    `).bind(status, now, now).run();
  } else {
    await env.DB_WRITE.prepare(`
      UPDATE lighter_tracker_status_v2 
      SET status = ?, last_run = ?, last_error = ?
      WHERE id = 1
    `).bind(status, now, error).run();
  }
}

/**
 * Increment tracker statistics
 */
async function incrementTrackerStats(env: Env, recordCount: number): Promise<void> {
  await env.DB_WRITE.prepare(`
    UPDATE lighter_tracker_status_v2 
    SET total_runs = total_runs + 1, total_records = total_records + ?
    WHERE id = 1
  `).bind(recordCount).run();
}

/**
 * Sync data from DB_WRITE to DB_READ
 * Should be called after collection
 */
export async function syncLighterFundingV2ToRead(env: Env): Promise<void> {
  console.log('[V2 Lighter] Starting sync to DB_READ...');

  try {
    const twoHoursAgo = Math.floor(Date.now() / 1000) - (2 * 3600);

    // Fetch recent data from DB_WRITE
    const sourceData = await env.DB_WRITE.prepare(`
      SELECT * FROM lighter_funding_v2 
      WHERE timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT 5000
    `).bind(twoHoursAgo).all();

    if (!sourceData.results || sourceData.results.length === 0) {
      console.log('[V2 Lighter] No recent data to sync');
      return;
    }

    console.log(`[V2 Lighter] Syncing ${sourceData.results.length} records to DB_READ`);

    // Batch insert to DB_READ
    const statements = sourceData.results.map((row: any) => 
      env.DB_READ.prepare(`
        INSERT OR REPLACE INTO lighter_funding_v2 (
          market_id, symbol, timestamp,
          rate, rate_hourly, rate_annual,
          direction, cumulative_value,
          collected_at, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        row.market_id,
        row.symbol,
        row.timestamp,
        row.rate,
        row.rate_hourly,
        row.rate_annual,
        row.direction,
        row.cumulative_value,
        row.collected_at,
        row.source
      )
    );

    await env.DB_READ.batch(statements);

    // Also sync market metadata
    const markets = await env.DB_WRITE.prepare(`
      SELECT * FROM lighter_markets_v2
    `).all();

    if (markets.results && markets.results.length > 0) {
      const marketStatements = markets.results.map((row: any) =>
        env.DB_READ.prepare(`
          INSERT OR REPLACE INTO lighter_markets_v2 (market_id, symbol, status, last_updated)
          VALUES (?, ?, ?, ?)
        `).bind(row.market_id, row.symbol, row.status, row.last_updated)
      );

      await env.DB_READ.batch(marketStatements);
    }

    console.log(`[V2 Lighter] Sync complete: ${sourceData.results.length} records`);

  } catch (error) {
    console.error('[V2 Lighter] Sync failed:', error);
    throw error;
  }
}
