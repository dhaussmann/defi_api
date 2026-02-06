/**
 * Variational V3 Collector
 * 
 * Collects funding rate data from Variational exchange using unified V3 schema.
 * 
 * API Structure:
 * - Endpoint: https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats
 * - Method: GET
 * - Returns: {listings: [...]} with market data
 * - Rate format: funding_rate / 10 / 100 (custom conversion)
 * - Interval: Variable per market (funding_interval_s in seconds)
 */

import { getExchangeConfig, calculateRates, validateRate } from './ExchangeConfig';

const EXCHANGE_NAME = 'variational';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

interface Env {
  DB_WRITE: D1Database;
}

interface VariationalListing {
  ticker: string;
  name: string;
  mark_price: string;
  volume_24h: string;
  open_interest: {
    long_open_interest: string;
    short_open_interest: string;
  };
  funding_rate: string;
  funding_interval_s: number;
  market_id?: number;
}

interface VariationalResponse {
  listings: VariationalListing[];
}

/**
 * Fetch market data from Variational API
 */
async function fetchVariationalData(): Promise<VariationalResponse> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/metadata/stats`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Variational data: ${response.status}`);
  }
  
  const data = await response.json() as VariationalResponse;
  
  if (!data.listings || !Array.isArray(data.listings)) {
    throw new Error('Invalid API response: missing listings array');
  }
  
  return data;
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectVariationalV3(env: Env): Promise<void> {
  console.log('[V3 Variational] Starting collection');
  const collectedAt = Math.floor(Date.now() / 1000);
  
  try {
    // Fetch data from Variational API
    const data = await fetchVariationalData();
    const listings = data.listings;
    
    console.log(`[V3 Variational] Found ${listings.length} markets`);
    
    if (listings.length === 0) {
      console.log('[V3 Variational] No markets found');
      return;
    }
    
    // Process each market
    const statements: any[] = [];
    
    for (const listing of listings) {
      const ticker = listing.ticker;
      if (!ticker) {
        continue;
      }
      
      // Parse funding rate - API format: divide by 10, then by 100
      const fundingRateFromAPI = parseFloat(listing.funding_rate || '0');
      const rateRaw = fundingRateFromAPI / 10 / 100;
      
      // Parse funding interval - convert seconds to hours
      const fundingIntervalSeconds = listing.funding_interval_s || 28800; // Default 8h
      const intervalHours = Math.round(fundingIntervalSeconds / 3600);
      
      // Calculate rates using config system
      const rates = calculateRates(rateRaw, intervalHours, EXCHANGE_NAME);
      
      // Validate rate
      const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
      if (!validation.valid) {
        console.error(`[V3 Variational] Invalid rate for ${ticker}: ${validation.message}`);
        continue;
      }
      if (validation.warning) {
        console.warn(`[V3 Variational] Warning for ${ticker}: ${validation.message}`);
      }
      
      // Use current timestamp as funding_time
      const fundingTime = collectedAt;
      
      statements.push(
        env.DB_WRITE.prepare(`
          INSERT OR REPLACE INTO variational_funding_v3 
          (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          ticker,
          ticker, // base_asset = ticker for Variational
          fundingTime,
          rates.rateRaw,
          rates.rateRawPercent,
          intervalHours,
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
      console.log(`[V3 Variational] Successfully inserted ${statements.length} records`);
    } else {
      console.log('[V3 Variational] No valid records to insert');
    }
    
  } catch (error) {
    console.error('[V3 Variational] Collection failed:', error);
    throw error;
  }
}
