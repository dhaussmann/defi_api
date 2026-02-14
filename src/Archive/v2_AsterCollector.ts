/**
 * V2 Aster Funding Rate Collector
 * 
 * Fetches funding rates from Aster API
 * - Variable intervals (detected from data)
 * - Calculates both hourly rate and annualized rate
 * 
 * Runs hourly via cron job
 */

import { Env } from '../types';

interface AsterMarket {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

interface AsterFundingRate {
  symbol: string;
  fundingTime: number;
  fundingRate: string;
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectAsterData(env: Env, limitMarkets?: number): Promise<void> {
  console.log('[V2 Aster] Starting data collection');

  try {
    // Fetch active markets
    let markets = await fetchActiveMarkets();
    console.log(`[V2 Aster] Found ${markets.length} active markets`);

    // Limit for testing if specified
    if (limitMarkets && limitMarkets > 0) {
      markets = markets.slice(0, limitMarkets);
      console.log(`[V2 Aster] Limited to ${markets.length} markets for testing`);
    }

    // Update market metadata
    await updateMarketMetadata(env, markets);

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
      console.log(`[V2 Aster] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(markets.length / BATCH_SIZE)} (${batch.length} markets)`);
      
      const results = await Promise.allSettled(
        batch.map(market => collectMarketData(env, market, startTimestamp, now))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          totalRecords += result.value;
          successCount++;
        } else {
          errorCount++;
          console.error(`[V2 Aster] Error collecting ${batch[idx].symbol}:`, result.reason);
        }
      });

      // Small delay between batches to avoid overwhelming the API
      if (i + BATCH_SIZE < markets.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[V2 Aster] Collection completed: ${totalRecords} records from ${markets.length} markets (${successCount} success, ${errorCount} errors)`);
  } catch (error) {
    console.error('[V2 Aster] Collection failed:', error);
  }
}

/**
 * Fetch active markets from Aster API
 */
async function fetchActiveMarkets(): Promise<AsterMarket[]> {
  try {
    const response = await fetch('https://fapi.asterdex.com/fapi/v1/exchangeInfo');
    
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
  } catch (error) {
    console.error('[V2 Aster] Failed to fetch markets:', error);
    return [];
  }
}

/**
 * Update market metadata
 */
async function updateMarketMetadata(
  env: Env,
  markets: AsterMarket[]
): Promise<void> {
  const timestamp = Date.now();
  
  const statements = markets.map(m =>
    env.DB_WRITE.prepare(
      'INSERT OR REPLACE INTO aster_markets (symbol, base_asset, quote_asset, contract_type, status, last_updated) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(m.symbol, m.baseAsset, m.quoteAsset, 'PERPETUAL', 'TRADING', timestamp)
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
  market: AsterMarket,
  startTimestamp: number,
  endTimestamp: number
): Promise<number> {
  try {
    // Convert to milliseconds for Aster API
    const startMs = startTimestamp * 1000;
    const endMs = endTimestamp * 1000;
    
    const response = await fetch(
      `https://fapi.asterdex.com/fapi/v1/fundingRate?symbol=${market.symbol}&startTime=${startMs}&endTime=${endMs}&limit=1000`
    );

    if (!response.ok) {
      throw new Error(`Funding API error: ${response.status}`);
    }

    const data = await response.json() as AsterFundingRate[];

    if (!Array.isArray(data) || data.length === 0) {
      return 0;
    }

    // Calculate median interval from actual data
    const intervals: number[] = [];
    for (let i = 1; i < data.length; i++) {
      intervals.push(data[i].fundingTime - data[i - 1].fundingTime);
    }

    let medianInterval = 28800000; // Default 8h in ms
    if (intervals.length > 0) {
      intervals.sort((a, b) => a - b);
      medianInterval = intervals[Math.floor(intervals.length / 2)];
    }

    const intervalHours = Math.round(medianInterval / (60 * 60 * 1000));
    const eventsPerYear = 365 * (24 / intervalHours);

    // Update market with detected interval
    await env.DB_WRITE.prepare(
      'UPDATE aster_markets SET detected_interval_hours = ? WHERE symbol = ?'
    ).bind(intervalHours, market.symbol).run();

    // Process only last 2 records to avoid duplicates
    const recentData = data.slice(-2);
    const collectedAt = Date.now();

    const statements = recentData.map(item => {
      const rate = parseFloat(item.fundingRate);
      const ratePercent = rate * 100;
      const rateHourly = ratePercent / intervalHours;
      const rateAnnual = ratePercent * eventsPerYear;

      return env.DB_WRITE.prepare(
        'INSERT OR REPLACE INTO aster_raw_data (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, rate_hourly, rate_annual, interval_hours, events_per_year, collected_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        market.symbol,
        market.baseAsset,
        item.fundingTime,
        rate,
        ratePercent,
        rateHourly,
        rateAnnual,
        intervalHours,
        eventsPerYear,
        collectedAt,
        'api'
      );
    });

    await env.DB_WRITE.batch(statements);

    return recentData.length;
  } catch (error) {
    console.error(`[V2 Aster] Error collecting ${market.symbol}:`, error);
    return 0;
  }
}
