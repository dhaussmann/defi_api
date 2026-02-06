/**
 * Felix V3 Collector
 * 
 * Collects funding rate data from Felix exchange using unified V3 schema.
 * Felix uses the Hyperliquid API infrastructure with dex: "flx" parameter.
 * 
 * API Structure:
 * - Endpoint: https://api.hyperliquid.xyz/info
 * - Method: POST with {"type": "metaAndAssetCtxs", "dex": "flx"}
 * - Returns: [meta, assetCtxs] where meta.universe contains market info
 * - Rate format: decimal (same as Hyperliquid)
 * - Interval: 1 hour
 * - Markets: Stock perpetuals (TSLA, NVDA, etc.)
 */

import { getExchangeConfig, calculateRates, validateRate } from './ExchangeConfig';

const EXCHANGE_NAME = 'felix';
const CONFIG = getExchangeConfig(EXCHANGE_NAME);

interface Env {
  DB_WRITE: D1Database;
}

interface FelixUniverse {
  name: string;
  szDecimals: number;
  maxLeverage: number;
}

interface FelixAssetCtx {
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
 * Fetch markets and funding rates from Felix API
 * Returns [meta, assetCtxs] array
 */
async function fetchFelixData(): Promise<[{ universe: FelixUniverse[] }, FelixAssetCtx[]]> {
  const response = await fetch(`${CONFIG.apiBaseUrl}/info`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'metaAndAssetCtxs',
      dex: 'flx'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch Felix data: ${response.status}`);
  }
  
  const data = await response.json();
  
  // API returns [meta, assetCtxs]
  if (!Array.isArray(data) || data.length !== 2) {
    throw new Error('Invalid API response: expected array with 2 elements');
  }
  
  return data as [{ universe: FelixUniverse[] }, FelixAssetCtx[]];
}

/**
 * Extract base asset from symbol (e.g., "flx:TSLA" -> "TSLA")
 */
function extractBaseAsset(symbol: string): string {
  return symbol.replace('flx:', '');
}

/**
 * Main collection function - called by hourly cron
 */
export async function collectFelixV3(env: Env): Promise<void> {
  console.log('[V3 Felix] Starting collection');
  const collectedAt = Math.floor(Date.now() / 1000);
  
  try {
    // Fetch data from Felix API
    const [meta, assetCtxs] = await fetchFelixData();
    const universe = meta.universe;
    
    console.log(`[V3 Felix] Found ${universe.length} markets, ${assetCtxs.length} asset contexts`);
    
    if (universe.length === 0 || assetCtxs.length === 0) {
      console.log('[V3 Felix] No markets found');
      return;
    }
    
    // Validate array lengths match
    if (universe.length !== assetCtxs.length) {
      console.warn(`[V3 Felix] Array length mismatch: universe=${universe.length}, assetCtxs=${assetCtxs.length}`);
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
      
      // Symbol already has flx: prefix from API
      const symbol = universeItem.name;
      const baseAsset = extractBaseAsset(symbol);
      
      // Parse funding rate
      const rateRaw = parseFloat(assetCtx.funding || '0');
      
      // Calculate rates using config system
      const rates = calculateRates(rateRaw, CONFIG.defaultIntervalHours, EXCHANGE_NAME);
      
      // Validate rate
      const validation = validateRate(rates.rateRawPercent, EXCHANGE_NAME);
      if (!validation.valid) {
        console.error(`[V3 Felix] Invalid rate for ${symbol}: ${validation.message}`);
        continue;
      }
      if (validation.warning) {
        console.warn(`[V3 Felix] Warning for ${symbol}: ${validation.message}`);
      }
      
      // Use current timestamp as funding_time (Felix doesn't provide historical timestamps)
      const fundingTime = collectedAt;
      
      statements.push(
        env.DB_WRITE.prepare(`
          INSERT OR REPLACE INTO felix_funding_v3 
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
      console.log(`[V3 Felix] Successfully inserted ${statements.length} records`);
    } else {
      console.log('[V3 Felix] No valid records to insert');
    }
    
  } catch (error) {
    console.error('[V3 Felix] Collection failed:', error);
    throw error;
  }
}
