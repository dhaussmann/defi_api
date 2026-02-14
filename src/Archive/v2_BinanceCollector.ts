/**
 * V2 Binance Funding Rate Collector
 * 
 * Fetches funding rates from Binance Futures API
 * - Variable intervals (typically 8h)
 * - Automatic interval detection from actual data
 * - Calculates both hourly rate and annualized rate
 * 
 * Runs hourly via cron job
 */

import { Env } from '../types';

interface BinanceExchangeInfo {
  symbols: Array<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    contractType: string;
    status: string;
  }>;
}

interface BinanceFundingRate {
  symbol: string;
  fundingTime: number;
  fundingRate: string;
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectBinanceData(env: Env, limitSymbols?: number): Promise<void> {
  console.log('[V2 Binance] Starting data collection');

  try {
    // Fetch active perpetual contracts
    let symbols = await fetchActivePerpetuals();
    console.log(`[V2 Binance] Found ${symbols.length} active perpetual contracts`);

    // Limit for testing if specified
    if (limitSymbols && limitSymbols > 0) {
      symbols = symbols.slice(0, limitSymbols);
      console.log(`[V2 Binance] Limited to ${symbols.length} symbols for testing`);
    }

    // Update market metadata
    await updateMarketMetadata(env, symbols);

    // Collect data in parallel batches to avoid timeout
    const BATCH_SIZE = 50; // Process 50 symbols at a time
    let totalRecords = 0;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      console.log(`[V2 Binance] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(symbols.length / BATCH_SIZE)} (${batch.length} symbols)`);
      
      const results = await Promise.allSettled(
        batch.map(symbolInfo => collectSymbolData(env, symbolInfo))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          totalRecords += result.value;
          successCount++;
        } else {
          errorCount++;
          console.error(`[V2 Binance] Error collecting ${batch[idx].symbol}:`, result.reason);
        }
      });

      // Small delay between batches to avoid overwhelming the API
      if (i + BATCH_SIZE < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[V2 Binance] Collection completed: ${totalRecords} records from ${symbols.length} markets (${successCount} success, ${errorCount} errors)`);
  } catch (error) {
    console.error('[V2 Binance] Collection failed:', error);
  }
}

/**
 * Fetch all active perpetual contracts from Binance API
 */
async function fetchActivePerpetuals(): Promise<Array<{symbol: string, baseAsset: string, quoteAsset: string}>> {
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DefiAPI/1.0)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Exchange info API error: ${response.status}`);
    }

    const data = await response.json() as BinanceExchangeInfo;
    
    if (!data.symbols || !Array.isArray(data.symbols)) {
      throw new Error('Invalid exchange info response');
    }

    const perpetuals = data.symbols
      .filter(s => s.contractType === 'PERPETUAL' && s.status === 'TRADING')
      .map(s => ({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset
      }));

    return perpetuals;
  } catch (error) {
    console.error('[V2 Binance] Failed to fetch perpetuals:', error);
    return [];
  }
}

/**
 * Update market metadata
 */
async function updateMarketMetadata(
  env: Env,
  symbols: Array<{symbol: string, baseAsset: string, quoteAsset: string}>
): Promise<void> {
  const timestamp = Date.now();
  
  const batches = [];
  for (let i = 0; i < symbols.length; i += 50) {
    batches.push(symbols.slice(i, i + 50));
  }

  for (const batch of batches) {
    const statements = batch.map(s =>
      env.DB_WRITE.prepare(
        'INSERT OR REPLACE INTO binance_markets (symbol, base_asset, quote_asset, contract_type, status, last_updated) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(s.symbol, s.baseAsset, s.quoteAsset, 'PERPETUAL', 'TRADING', timestamp)
    );

    await env.DB_WRITE.batch(statements);
  }
}

/**
 * Collect funding data for a single symbol
 */
async function collectSymbolData(
  env: Env,
  symbolInfo: {symbol: string, baseAsset: string, quoteAsset: string}
): Promise<number> {
  const now = Date.now();
  const lookbackMs = 48 * 60 * 60 * 1000; // 48 hours lookback
  const startTime = now - lookbackMs;

  try {
    const response = await fetch(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbolInfo.symbol}&startTime=${startTime}&limit=1000`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DefiAPI/1.0)'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Funding rate API error: ${response.status}`);
    }

    const data = await response.json() as BinanceFundingRate[];

    if (!Array.isArray(data) || data.length === 0) {
      return 0;
    }

    // Calculate median interval from actual data
    const intervals: number[] = [];
    for (let i = 1; i < data.length; i++) {
      intervals.push(data[i].fundingTime - data[i - 1].fundingTime);
    }

    let medianInterval = 28800000; // Default 8h
    if (intervals.length > 0) {
      intervals.sort((a, b) => a - b);
      medianInterval = intervals[Math.floor(intervals.length / 2)];
    }

    const intervalHours = Math.round(medianInterval / (60 * 60 * 1000));
    const eventsPerYear = 365 * (24 * 60 * 60 * 1000 / medianInterval);

    // Update market with detected interval
    await env.DB_WRITE.prepare(
      'UPDATE binance_markets SET funding_interval_hours = ? WHERE symbol = ?'
    ).bind(intervalHours, symbolInfo.symbol).run();

    // Process only new records (last 2 intervals to ensure we don't miss any)
    const recentData = data.slice(-2);
    const collectedAt = Date.now();

    const statements = recentData.map(item => {
      const rate = parseFloat(item.fundingRate);
      const ratePercent = rate * 100;
      const rateHourly = ratePercent / intervalHours;
      const rateAnnual = ratePercent * eventsPerYear;

      return env.DB_WRITE.prepare(
        'INSERT OR IGNORE INTO binance_raw_data (symbol, base_asset, timestamp, rate, rate_percent, rate_hourly, rate_annual, funding_interval_hours, collected_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        symbolInfo.symbol,
        symbolInfo.baseAsset,
        item.fundingTime,
        rate,
        ratePercent,
        rateHourly,
        rateAnnual,
        intervalHours,
        collectedAt,
        'api'
      );
    });

    await env.DB_WRITE.batch(statements);

    return recentData.length;
  } catch (error) {
    console.error(`[V2 Binance] Error collecting ${symbolInfo.symbol}:`, error);
    return 0;
  }
}
