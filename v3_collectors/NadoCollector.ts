/**
 * Nado V3 Collector
 * 
 * Collects funding rate data from Nado exchange using unified V3 schema.
 * 
 * API Structure:
 * - Assets endpoint: https://gateway.test.nado.xyz/v2/assets
 * - Funding rates endpoint: https://archive.test.nado.xyz/v1
 * - Rate format: funding_rate_x18 (multiplied by 10^18)
 * - Interval: 24 hours
 */

import { getExchangeConfig, calculateRates, validateRate } from './ExchangeConfig';

const EXCHANGE_NAME = 'nado';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

interface Env {
  DB_WRITE: D1Database;
}

interface NadoAsset {
  product_id: number;
  symbol: string;
  market_type: string;
}

interface NadoFundingRate {
  product_id: number;
  funding_rate_x18: string;
  update_time: string;
}

interface NadoFundingResponse {
  [product_id: string]: NadoFundingRate;
}

/**
 * Fetch active perpetual markets from Nado
 */
async function fetchActiveMarkets(): Promise<NadoAsset[]> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/assets`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Nado markets: ${response.status}`);
  }
  
  const assets = await response.json() as NadoAsset[];
  
  // Filter for perpetual markets only
  return assets.filter(asset => asset.market_type === 'perp');
}

/**
 * Fetch funding rates for all markets in a single batch request
 */
async function fetchFundingRates(productIds: number[]): Promise<NadoFundingResponse> {
  const url = 'https://archive.test.nado.xyz/v1';
  const payload = {
    funding_rates: {
      product_ids: productIds
    }
  };
  
  console.log(`[V3 Nado] Fetching from: ${url}`);
  console.log(`[V3 Nado] Payload: ${JSON.stringify(payload).substring(0, 100)}...`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify(payload)
  });
  
  console.log(`[V3 Nado] Response status: ${response.status}`);
  console.log(`[V3 Nado] Response headers: ${JSON.stringify([...response.headers.entries()])}`);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[V3 Nado] Error response: ${errorText.substring(0, 200)}`);
    throw new Error(`Failed to fetch Nado funding rates: ${response.status} - ${errorText.substring(0, 100)}`);
  }
  
  return await response.json() as NadoFundingResponse;
}

/**
 * Convert funding_rate_x18 to decimal rate
 * funding_rate_x18 is the rate multiplied by 10^18
 */
function convertX18ToDecimal(rateX18: string): number {
  const rate = parseFloat(rateX18) / 1e18;
  return rate;
}

/**
 * Extract base asset from symbol (e.g., "BTC-PERP" -> "BTC")
 */
function extractBaseAsset(symbol: string): string {
  return symbol.replace('-PERP', '');
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectNadoV3(env: Env): Promise<void> {
  console.log('[V3 Nado] Starting collection');
  const collectedAt = Math.floor(Date.now() / 1000);
  
  try {
    // Fetch active markets
    console.log('[V3 Nado] Fetching active markets...');
    const markets = await fetchActiveMarkets();
    console.log(`[V3 Nado] Found ${markets.length} perpetual markets`);
    
    if (markets.length === 0) {
      console.log('[V3 Nado] No markets found');
      return;
    }
    
    // Extract product IDs
    const productIds = markets.map(m => m.product_id);
    console.log(`[V3 Nado] Product IDs: ${productIds.slice(0, 5).join(', ')}...`);
    
    // Fetch all funding rates in one batch
    console.log('[V3 Nado] Fetching funding rates...');
    const fundingRates = await fetchFundingRates(productIds);
    console.log(`[V3 Nado] Fetched funding rates for ${Object.keys(fundingRates).length} markets`);
    
    // Process each market
    const statements: any[] = [];
    
    for (const market of markets) {
      const fundingData = fundingRates[market.product_id.toString()];
      
      if (!fundingData) {
        console.warn(`[V3 Nado] No funding data for ${market.symbol} (product_id: ${market.product_id})`);
        continue;
      }
      
      // Convert x18 format to decimal
      const rateRaw = convertX18ToDecimal(fundingData.funding_rate_x18);
      
      // Calculate rates using config system
      const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);
      
      // Validate rate
      const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
      if (!validation.valid) {
        console.error(`[V3 Nado] Invalid rate for ${market.symbol}: ${validation.message}`);
        continue;
      }
      if (validation.warning) {
        console.warn(`[V3 Nado] Warning for ${market.symbol}: ${validation.message}`);
      }
      
      // Use update_time from API
      const fundingTime = parseInt(fundingData.update_time);
      const baseAsset = extractBaseAsset(market.symbol);
      
      statements.push(
        env.DB_WRITE.prepare(`
          INSERT OR REPLACE INTO nado_funding_v3 
          (symbol, base_asset, product_id, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          market.symbol,
          baseAsset,
          market.product_id,
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
    }
    
    // Batch insert all records
    if (statements.length > 0) {
      await env.DB_WRITE.batch(statements);
      console.log(`[V3 Nado] Successfully inserted ${statements.length} records`);
    } else {
      console.log('[V3 Nado] No valid records to insert');
    }
    
  } catch (error) {
    console.error('[V3 Nado] Collection failed:', error);
    throw error;
  }
}
