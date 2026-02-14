/**
 * Ethereal V3 Collector
 * 
 * Collects funding rate data from Ethereal exchange using unified V3 schema.
 * 
 * API Structure:
 * - Endpoint: https://api.ethereal.trade/v1/product?orderBy=createdAt
 * - Method: GET (returns all products with funding rates)
 * - Rate format: decimal (fundingRate1h is already 1h rate)
 * - Interval: 1 hour
 * - Symbol format: BTCUSD, ETHUSD etc.
 */

import { getExchangeConfig, calculateRates, validateRate } from './ExchangeConfig';

const EXCHANGE_NAME = 'ethereal';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

interface Env {
  DB_WRITE: D1Database;
}

interface EtherealProduct {
  id: string;
  ticker: string;
  displayTicker: string;
  baseTokenName: string;
  quoteTokenName: string;
  status: string;
  fundingRate1h: string;
  fundingUpdatedAt: number;
  openInterest: string;
  volume24h: string;
  maxLeverage: number;
}

interface EtherealResponse {
  data: EtherealProduct[];
  hasNext: boolean;
}

/**
 * Fetch all products with funding rates from Ethereal API
 */
async function fetchEtherealProducts(): Promise<EtherealProduct[]> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/v1/product?orderBy=createdAt`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Ethereal products: ${response.status}`);
  }
  
  const data = await response.json() as EtherealResponse;
  
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('Invalid API response: expected data array');
  }
  
  // Filter for active products only
  return data.data.filter(p => p.status === 'ACTIVE');
}

/**
 * Main collection function - called by cron
 */
export async function collectEtherealV3(env: Env): Promise<void> {
  console.log('[V3 Ethereal] Starting collection');
  const collectedAt = Math.floor(Date.now() / 1000);
  
  try {
    // Fetch all products with funding rates in one request
    const products = await fetchEtherealProducts();
    
    console.log(`[V3 Ethereal] Found ${products.length} active products`);
    
    if (products.length === 0) {
      console.log('[V3 Ethereal] No products found');
      return;
    }
    
    // Process each product
    const statements: any[] = [];
    
    for (const product of products) {
      if (!product.fundingRate1h) {
        continue;
      }
      
      // Parse funding rate and open interest (already 1h rate in decimal)
      const rateRaw = parseFloat(product.fundingRate1h);
      const openInterest = product.openInterest ? parseFloat(product.openInterest) : null;
      
      // Calculate rates using config system
      const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);
      
      // Validate rate
      const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
      if (!validation.valid) {
        console.error(`[V3 Ethereal] Invalid rate for ${product.ticker}: ${validation.message}`);
        continue;
      }
      if (validation.warning) {
        console.warn(`[V3 Ethereal] Warning for ${product.ticker}: ${validation.message}`);
      }
      
      // Use fundingUpdatedAt from API (milliseconds -> seconds)
      const fundingTime = Math.floor(product.fundingUpdatedAt / 1000);
      
      statements.push(
        env.DB_WRITE.prepare(`
          INSERT OR REPLACE INTO ethereal_funding_v3 
          (symbol, base_asset, funding_time, rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr, collected_at, source, open_interest)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          product.ticker,
          product.baseTokenName,
          fundingTime,
          rates.rateRaw,
          rates.rateRawPercent,
          CONFIG.defaultIntervalHours,
          rates.rate1hPercent,
          rates.rateApr,
          collectedAt,
          'api',
          openInterest
        )
      );
    }
    
    // Batch insert all records
    if (statements.length > 0) {
      await env.DB_WRITE.batch(statements);
      console.log(`[V3 Ethereal] Successfully inserted ${statements.length} records`);
    } else {
      console.log('[V3 Ethereal] No valid records to insert');
    }
    
  } catch (error) {
    console.error('[V3 Ethereal] Collection failed:', error);
    throw error;
  }
}
