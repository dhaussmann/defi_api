/**
 * Paradex V3 Collector
 * 
 * Collects funding rate data from Paradex exchange using unified V3 schema.
 * 
 * API Structure:
 * - Markets Endpoint: https://api.prod.paradex.trade/v1/markets
 * - Funding Endpoint: https://api.prod.paradex.trade/v1/funding/data?market={symbol}&page_size=1
 * - Rate format: decimal (e.g., 0.00004723617486 for 8h)
 * - Interval: 8 hours (fixed)
 */

import { getExchangeConfig, calculateRates, validateRate } from './ExchangeConfig';

const EXCHANGE_NAME = 'paradex';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

interface Env {
  DB_WRITE: D1Database;
}

interface ParadexMarket {
  symbol: string;
  asset_kind: string;
}

interface ParadexMarketsResponse {
  results: ParadexMarket[];
}

interface ParadexFundingData {
  market: string;
  funding_rate: string;
  timestamp: number;
}

interface ParadexFundingResponse {
  results: ParadexFundingData[];
}

/**
 * Fetch all PERP markets from Paradex
 */
async function fetchParadexMarkets(): Promise<string[]> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/v1/markets`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Paradex markets: ${response.status}`);
  }
  
  const data = await response.json() as ParadexMarketsResponse;
  
  // Filter only PERP markets
  const perpMarkets = data.results
    .filter(m => m.asset_kind === 'PERP')
    .map(m => m.symbol);
  
  return perpMarkets;
}

/**
 * Fetch funding rate for a specific market
 */
async function fetchMarketFundingRate(symbol: string): Promise<ParadexFundingData | null> {
  const response = await fetch(
    `${CONFIG.apiBaseUrl}/v1/funding/data?market=${symbol}&page_size=1`,
    {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    }
  );
  
  if (!response.ok) {
    console.warn(`[V3 Paradex] Failed to fetch funding for ${symbol}: ${response.status}`);
    return null;
  }
  
  const data = await response.json() as ParadexFundingResponse;
  
  if (!data.results || data.results.length === 0) {
    return null;
  }
  
  return data.results[0];
}

/**
 * Extract base asset from symbol (e.g., "BTC-USD-PERP" -> "BTC")
 */
function extractBaseAsset(symbol: string): string {
  return symbol.split('-')[0];
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectParadexV3(env: Env): Promise<void> {
  console.log('[V3 Paradex] Starting collection');
  const collectedAt = Math.floor(Date.now() / 1000);
  
  try {
    // Fetch all PERP markets
    const markets = await fetchParadexMarkets();
    console.log(`[V3 Paradex] Found ${markets.length} PERP markets`);
    
    if (markets.length === 0) {
      console.log('[V3 Paradex] No markets found');
      return;
    }
    
    // Fetch funding rates for all markets
    const statements: any[] = [];
    let successCount = 0;
    let failCount = 0;
    
    for (const symbol of markets) {
      try {
        const fundingData = await fetchMarketFundingRate(symbol);
        
        if (!fundingData) {
          failCount++;
          continue;
        }
        
        const baseAsset = extractBaseAsset(symbol);
        
        // Parse funding rate - already in decimal format for 8h
        const rateRaw = parseFloat(fundingData.funding_rate || '0');
        
        // Calculate rates using config system (8h interval)
        const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);
        
        // Validate rate
        const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
        if (!validation.valid) {
          console.error(`[V3 Paradex] Invalid rate for ${symbol}: ${validation.message}`);
          failCount++;
          continue;
        }
        if (validation.warning) {
          console.warn(`[V3 Paradex] Warning for ${symbol}: ${validation.message}`);
        }
        
        // Use current timestamp as funding_time
        const fundingTime = collectedAt;
        
        statements.push(
          env.DB_WRITE.prepare(`
            INSERT OR REPLACE INTO paradex_funding_v3 
            (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            symbol,
            baseAsset,
            fundingTime,
            rates.rateRaw,
            rates.rateRawPercent,
            CONFIG.defaultIntervalHours,
            rates.rate1hPercent,
            rates.rateApr,
            collectedAt,
            'api'
          )
        );
        
        successCount++;
        
      } catch (error) {
        console.error(`[V3 Paradex] Error fetching ${symbol}:`, error);
        failCount++;
      }
    }
    
    // Batch insert all records
    if (statements.length > 0) {
      await env.DB_WRITE.batch(statements);
      console.log(`[V3 Paradex] Successfully inserted ${statements.length} records (${successCount} success, ${failCount} failed)`);
    } else {
      console.log('[V3 Paradex] No valid records to insert');
    }
    
  } catch (error) {
    console.error('[V3 Paradex] Collection failed:', error);
    throw error;
  }
}
