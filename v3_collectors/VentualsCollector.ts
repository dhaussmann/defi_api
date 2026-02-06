/**
 * Ventuals V3 Collector
 * 
 * Collects funding rate data from Ventuals exchange using unified V3 schema.
 * Ventuals uses the Hyperliquid API infrastructure with dex: "vntl" parameter.
 * 
 * API Structure:
 * - Endpoint: https://api.hyperliquid.xyz/info
 * - Method: POST with {"type": "metaAndAssetCtxs", "dex": "vntl"}
 * - Returns: [meta, assetCtxs] where meta.universe contains market info
 * - Rate format: decimal (same as Hyperliquid)
 * - Interval: 1 hour
 * - Markets: Venture Capital perpetuals (SPACEX, OPENAI, ANTHROPIC, etc.)
 */

import { getExchangeConfig, calculateRates, validateRate } from './ExchangeConfig';

const EXCHANGE_NAME = 'ventuals';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

interface Env {
  DB_WRITE: D1Database;
}

interface VentualsUniverse {
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

interface VentualsAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
}

/**
 * Fetch markets and funding rates from Ventuals API
 * Returns [meta, assetCtxs] array
 */
async function fetchVentualsData(): Promise<[{ universe: VentualsUniverse[] }, VentualsAssetCtx[]]> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/info`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'metaAndAssetCtxs',
      dex: 'vntl'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Ventuals data: ${response.status}`);
  }
  
  const data = await response.json();
  
  // API returns [meta, assetCtxs]
  if (!Array.isArray(data) || data.length !== 2) {
    throw new Error('Invalid API response: expected array with 2 elements');
  }
  
  return data as [{ universe: VentualsUniverse[] }, VentualsAssetCtx[]];
}

/**
 * Extract base asset from symbol (e.g., "vntl:SPACEX" -> "SPACEX")
 */
function extractBaseAsset(symbol: string): string {
  return symbol.replace('vntl:', '');
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectVentualsV3(env: Env): Promise<void> {
  console.log('[V3 Ventuals] Starting collection');
  const collectedAt = Math.floor(Date.now() / 1000);
  
  try {
    // Fetch data from Ventuals API
    const [meta, assetCtxs] = await fetchVentualsData();
    const universe = meta.universe;
    
    console.log(`[V3 Ventuals] Found ${universe.length} markets, ${assetCtxs.length} asset contexts`);
    
    if (universe.length === 0 || assetCtxs.length === 0) {
      console.log('[V3 Ventuals] No markets found');
      return;
    }
    
    // Validate array lengths match
    if (universe.length !== assetCtxs.length) {
      console.warn(`[V3 Ventuals] Array length mismatch: universe=${universe.length}, assetCtxs=${assetCtxs.length}`);
    }
    
    // Process each market (map universe to assetCtxs by index)
    const statements: any[] = [];
    const maxLength = Math.min(universe.length, assetCtxs.length);
    
    for (let i = 0; i < maxLength; i++) {
      const universeItem = universe[i];
      const assetCtx = assetCtxs[i];
      
      if (!universeItem || !assetCtx || !universeItem.name) {
        continue;
      }
      
      // Symbol already has vntl: prefix from API
      const symbol = universeItem.name;
      const baseAsset = extractBaseAsset(symbol);
      
      // Parse funding rate
      const rateRaw = parseFloat(assetCtx.funding || '0');
      
      // Calculate rates using config system
      const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);
      
      // Validate rate
      const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
      if (!validation.valid) {
        console.error(`[V3 Ventuals] Invalid rate for ${symbol}: ${validation.message}`);
        continue;
      }
      if (validation.warning) {
        console.warn(`[V3 Ventuals] Warning for ${symbol}: ${validation.message}`);
      }
      
      // Use current timestamp as funding_time (Ventuals doesn't provide historical timestamps)
      const fundingTime = collectedAt;
      
      statements.push(
        env.DB_WRITE.prepare(`
          INSERT OR REPLACE INTO ventuals_funding_v3 
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
    }
    
    // Batch insert all records
    if (statements.length > 0) {
      await env.DB_WRITE.batch(statements);
      console.log(`[V3 Ventuals] Successfully inserted ${statements.length} records`);
    } else {
      console.log('[V3 Ventuals] No valid records to insert');
    }
    
  } catch (error) {
    console.error('[V3 Ventuals] Collection failed:', error);
    throw error;
  }
}
