/**
 * Unified Funding Rates Synchronization
 * 
 * Synchronisiert alle V3 Funding Tables in eine separate konsolidierte Datenbank (DB_UNIFIED)
 * mit normalisierten Symbolen für Cross-Exchange-Abfragen.
 */

import { Env } from './types';

// Liste aller V3 Exchanges
const V3_EXCHANGES = [
  'hyperliquid',
  'lighter',
  'aster',
  'edgex',
  'paradex',
  'extended',
  'nado',
  'hyena',
  'felix',
  'ventuals',
  'xyz',
  'variational',
  'ethereal'
];

/**
 * JavaScript-Funktion zur Symbol-Normalisierung
 * Converts exchange-specific symbol formats to a common base token name.
 * 
 * Exchange formats:
 *   Paradex:     BTC-USD-PERP
 *   Aster:       BTCUSDT
 *   EdgeX:       BTCUSD
 *   Lighter:     1000BONK
 *   Hyperliquid: BTC (already bare)
 *   Variational: BTC (already bare)
 *   Others:      prefix:SYMBOL (e.g. hyena:BTC)
 */
function normalizeSymbol(symbol: string): string {
  let s = symbol;

  // Step 1: Remove exchange prefixes (e.g. "hyena:BTC" -> "BTC")
  s = s.replace(/^[a-zA-Z]+:/i, '');

  // Step 2: Remove trading pair suffixes (order matters: longest first)
  s = s.replace(/-USD-PERP$/i, '');
  s = s.replace(/-PERP$/i, '');
  s = s.replace(/-USD$/i, '');
  s = s.replace(/USDT$/i, '');
  // Only strip trailing "USD" if the remaining part is >= 2 chars (avoid "S" from "SUSD")
  s = s.replace(/^(.{2,})USD$/i, '$1');

  // Step 3: Remove "1000" prefix for meme tokens (e.g. "1000BONK" -> "BONK", "1000FLOKI" -> "FLOKI")
  // But preserve tokens that start with digits naturally (e.g. "0G", "1INCH")
  s = s.replace(/^1000(?=[A-Z])/i, '');

  // Step 4: Clean separators
  s = s.replace(/\//g, '');
  s = s.replace(/_/g, '');

  return s.toUpperCase();
}

/**
 * Konvertiert Millisekunden-Timestamps zu Sekunden
 * Erkennt automatisch ob Timestamp in ms oder s ist
 */
function normalizeTimestamp(timestamp: number): number {
  // Timestamps > 10^12 sind in Millisekunden (nach Jahr 2286 in Sekunden)
  // Aktueller Unix-Timestamp in Sekunden ist ~1.7 * 10^9
  if (timestamp > 10000000000) {
    return Math.floor(timestamp / 1000);
  }
  return timestamp;
}

/**
 * Synchronisiert historische Import-Daten (optimiert für Bulk-Imports)
 * Verwendet funding_time statt collected_at für bessere Performance bei Imports
 */
async function syncImportToUnified(
  env: Env,
  exchange: string,
  daysBack: number = 30
): Promise<number> {
  const tableName = `${exchange}_funding_v3`;
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - (daysBack * 86400);
  
  console.log(`[ImportSync] Syncing ${exchange} imports from last ${daysBack} days`);
  
  try {
    // Query ALL import records from source table
    // We'll filter out already synced ones in JavaScript
    console.log(`[ImportSync] ${exchange}: Querying all import records`);
    
    const selectQuery = `
      SELECT 
        symbol,
        funding_time,
        base_asset,
        rate_raw,
        rate_raw_percent,
        interval_hours,
        rate_1h_percent,
        rate_apr,
        collected_at,
        source,
        open_interest
      FROM ${tableName}
      WHERE rate_raw IS NOT NULL
        AND funding_time IS NOT NULL
        AND funding_time >= ?
        AND ABS(rate_raw_percent) <= 10
        AND source = 'import'
      ORDER BY symbol, funding_time
      LIMIT 150000
    `;
    
    console.log(`[ImportSync] ${exchange}: Querying imports from ${new Date(startTime * 1000).toISOString()}`);
    console.log(`[ImportSync] ${exchange}: startTime=${startTime}, table=${tableName}`);
    
    const selectResult = await env.DB_WRITE.prepare(selectQuery)
      .bind(startTime)
      .all();
    
    console.log(`[ImportSync] ${exchange}: Query success=${selectResult.success}, results count=${selectResult.results?.length || 0}`);
    
    if (!selectResult.success) {
      console.error(`[ImportSync] ${exchange}: Query failed:`, selectResult.error);
      return 0;
    }
    
    if (!selectResult.results || selectResult.results.length === 0) {
      console.log(`[ImportSync] ${exchange}: No import data to sync`);
      return 0;
    }
    
    // Get already synced records to filter them out
    // Use LIMIT to avoid timeout on large result sets
    const syncedQuery = await env.DB_UNIFIED.prepare(`
      SELECT original_symbol || '-' || funding_time as key
      FROM unified_v3
      WHERE exchange = ? AND source = 'import'
      LIMIT 150000
    `).bind(exchange).all();
    
    const syncedKeys = new Set(syncedQuery.results?.map((r: any) => r.key) || []);
    console.log(`[ImportSync] ${exchange}: Found ${syncedKeys.size} already synced records to skip`);
    
    // Filter out already synced records
    const recordsToSync = selectResult.results.filter((row: any) => {
      const key = `${row.symbol}-${row.funding_time}`;
      return !syncedKeys.has(key);
    });
    
    console.log(`[ImportSync] ${exchange}: ${recordsToSync.length} new records to sync (${selectResult.results.length - recordsToSync.length} already synced)`);
    
    if (recordsToSync.length === 0) {
      console.log(`[ImportSync] ${exchange}: All records already synced`);
      return 0;
    }
    
    // Batch insert with larger batches for imports
    const BATCH_SIZE = 1000;
    let totalInserted = 0;
    
    for (let i = 0; i < recordsToSync.length; i += BATCH_SIZE) {
      const batch = recordsToSync.slice(i, i + BATCH_SIZE);
      const statements = batch.map((row: any) => {
        const normalizedSymbol = normalizeSymbol(row.symbol);
        const normalizedFundingTime = normalizeTimestamp(row.funding_time);
        const normalizedCollectedAt = normalizeTimestamp(row.collected_at);
        
        return env.DB_UNIFIED.prepare(`
          INSERT OR REPLACE INTO unified_v3 (
            exchange,
            original_symbol,
            normalized_symbol,
            funding_time,
            base_asset,
            rate_raw,
            rate_raw_percent,
            interval_hours,
            rate_1h_percent,
            rate_apr,
            collected_at,
            synced_at,
            source,
            open_interest
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          exchange,
          row.symbol,
          normalizedSymbol,
          normalizedFundingTime,
          row.base_asset,
          row.rate_raw,
          row.rate_raw_percent,
          row.interval_hours,
          row.rate_1h_percent,
          row.rate_apr,
          normalizedCollectedAt,
          now,
          row.source,
          row.open_interest ?? null
        );
      });
      
      await env.DB_UNIFIED.batch(statements);
      totalInserted += batch.length;
      console.log(`[ImportSync] ${exchange}: Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}, total: ${totalInserted}`);
    }
    
    console.log(`[ImportSync] ${exchange}: Successfully synced ${totalInserted} import records`);
    return totalInserted;
    
  } catch (error) {
    console.error(`[ImportSync] ${exchange}: Error syncing imports:`, error);
    throw error;
  }
}

/**
 * Synchronisiert eine einzelne V3 Exchange-Tabelle (inkrementell für Collector)
 */
export async function syncExchangeToUnified(
  env: Env,
  exchange: string,
  lastSyncTime: number
): Promise<number> {
  const tableName = `${exchange}_funding_v3`;
  const now = Math.floor(Date.now() / 1000);
  
  console.log(`[UnifiedSync] Syncing ${exchange} from ${new Date(lastSyncTime * 1000).toISOString()}`);
  
  try {
    // Query V3 table from DB_WRITE with LIMIT to avoid timeout
    // Normalize symbols in JavaScript instead of SQL for better performance
    const selectQuery = `
      SELECT 
        symbol,
        funding_time,
        base_asset,
        rate_raw,
        rate_raw_percent,
        interval_hours,
        rate_1h_percent,
        rate_apr,
        collected_at,
        source,
        open_interest
      FROM ${tableName}
      WHERE rate_raw IS NOT NULL
        AND funding_time IS NOT NULL
        AND ABS(rate_raw_percent) <= 10
        AND collected_at >= ?
      ORDER BY collected_at
      LIMIT 100000
    `;
    
    console.log(`[UnifiedSync] ${exchange}: Querying DB_WRITE with lastSyncTime=${lastSyncTime}`);
    
    const selectResult = await env.DB_WRITE.prepare(selectQuery)
      .bind(lastSyncTime)
      .all();
    
    console.log(`[UnifiedSync] ${exchange}: Query returned ${selectResult.results?.length || 0} records, success=${selectResult.success}`);
    
    if (!selectResult.success || !selectResult.results || selectResult.results.length === 0) {
      console.log(`[UnifiedSync] ${exchange}: No data to sync`);
      return 0;
    }
    
    // Normalize symbols in JavaScript and insert into DB_UNIFIED in batches
    const BATCH_SIZE = 500;
    let totalInserted = 0;
    
    for (let i = 0; i < selectResult.results.length; i += BATCH_SIZE) {
      const batch = selectResult.results.slice(i, i + BATCH_SIZE);
      const statements = batch.map((row: any) => {
        const normalizedSymbol = normalizeSymbol(row.symbol);
        const normalizedFundingTime = normalizeTimestamp(row.funding_time);
        const normalizedCollectedAt = normalizeTimestamp(row.collected_at);
        
        return env.DB_UNIFIED.prepare(`
          INSERT OR REPLACE INTO unified_v3 (
            normalized_symbol, exchange, funding_time, original_symbol, base_asset,
            rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr,
            collected_at, source, synced_at, open_interest
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          normalizedSymbol,
          exchange,
          normalizedFundingTime,
          row.symbol,
          row.base_asset,
          row.rate_raw,
          row.rate_raw_percent,
          row.interval_hours,
          row.rate_1h_percent,
          row.rate_apr,
          normalizedCollectedAt,
          row.source,
          now,
          row.open_interest ?? null
        );
      });
      
      await env.DB_UNIFIED.batch(statements);
      totalInserted += statements.length;
    }
    
    console.log(`[UnifiedSync] ${exchange}: ${totalInserted} records synced`);
    
    return totalInserted;
    
  } catch (error) {
    console.error(`[UnifiedSync] Error syncing ${exchange}:`, error);
    return 0;
  }
}

/**
 * Synchronisiert Import-Daten für alle oder spezifische V3 Exchanges
 */
export async function syncImportsToUnified(
  env: Env,
  exchanges?: string[],
  daysBack: number = 30
): Promise<{
  success: boolean;
  totalRecords: number;
  byExchange: Record<string, number>;
  duration: number;
}> {
  const startTime = Date.now();
  const exchangesToSync = exchanges || V3_EXCHANGES;
  
  console.log(`[ImportSync] Starting import sync for ${exchangesToSync.length} exchanges (${daysBack} days)`);
  
  const results: Record<string, number> = {};
  let totalRecords = 0;
  
  for (const exchange of exchangesToSync) {
    try {
      const count = await syncImportToUnified(env, exchange, daysBack);
      results[exchange] = count;
      totalRecords += count;
    } catch (error) {
      console.error(`[ImportSync] Failed to sync ${exchange}:`, error);
      results[exchange] = 0;
    }
  }
  
  const duration = Date.now() - startTime;
  
  console.log(`[ImportSync] Completed: ${totalRecords} total import records in ${duration}ms`);
  console.log('[ImportSync] By exchange:', results);
  
  return {
    success: true,
    totalRecords,
    byExchange: results,
    duration
  };
}

/**
 * Hauptfunktion: Synchronisiert alle V3 Exchanges (inkrementell)
 */
export async function syncAllV3ToUnified(env: Env): Promise<{
  success: boolean;
  totalRecords: number;
  byExchange: Record<string, number>;
  duration: number;
}> {
  const startTime = Date.now();
  console.log('[UnifiedSync] Starting sync of all V3 exchanges to unified_v3');
  
  // Hole letzten collected_at PRO EXCHANGE aus DB_UNIFIED
  // We compare against collected_at (not synced_at) because that's what the source query filters on
  const lastSyncQuery = await env.DB_UNIFIED.prepare(`
    SELECT exchange, MAX(collected_at) as last_collected FROM unified_v3 GROUP BY exchange
  `).all();
  
  const lastSyncByExchange: Record<string, number> = {};
  for (const row of (lastSyncQuery.results || []) as any[]) {
    lastSyncByExchange[row.exchange] = row.last_collected || 0;
  }
  console.log(`[UnifiedSync] Last collected_at per exchange:`, Object.entries(lastSyncByExchange).map(([e, t]) => `${e}=${new Date((t as number) * 1000).toISOString()}`).join(', '));
  
  const results: Record<string, number> = {};
  let totalRecords = 0;
  
  // Synchronisiere jede Exchange mit ihrem eigenen lastSyncTime
  // If an exchange has no data (lastSyncTime=0), start from 7 days ago
  // to prioritize recent data for MA calculations
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = nowSeconds - (7 * 86400);
  for (const exchange of V3_EXCHANGES) {
    try {
      const rawLastSync = lastSyncByExchange[exchange] || 0;
      const lastSyncTime = rawLastSync === 0 ? sevenDaysAgo : rawLastSync;
      const count = await syncExchangeToUnified(env, exchange, lastSyncTime);
      results[exchange] = count;
      totalRecords += count;
    } catch (error) {
      console.error(`[UnifiedSync] Failed to sync ${exchange}:`, error);
      results[exchange] = 0;
    }
  }
  
  const duration = Date.now() - startTime;
  
  console.log(`[UnifiedSync] Completed: ${totalRecords} total records in ${duration}ms`);
  console.log('[UnifiedSync] By exchange:', results);
  
  return {
    success: true,
    totalRecords,
    byExchange: results,
    duration
  };
}

/**
 * Hilfsfunktion: Hole Statistiken über unified_v3
 */
export async function getUnifiedFundingStats(env: Env): Promise<{
  totalRecords: number;
  uniqueSymbols: number;
  exchanges: number;
  oldestDate: string;
  newestDate: string;
  lastSync: string;
}> {
  const stats = await env.DB_UNIFIED.prepare(`
    SELECT 
      COUNT(*) as total_records,
      COUNT(DISTINCT normalized_symbol) as unique_symbols,
      COUNT(DISTINCT exchange) as exchanges,
      MIN(funding_time) as oldest_ts,
      MAX(funding_time) as newest_ts,
      MAX(synced_at) as last_sync_ts
    FROM unified_v3
  `).first();
  
  return {
    totalRecords: (stats?.total_records as number) || 0,
    uniqueSymbols: (stats?.unique_symbols as number) || 0,
    exchanges: (stats?.exchanges as number) || 0,
    oldestDate: stats?.oldest_ts 
      ? new Date((stats.oldest_ts as number) * 1000).toISOString() 
      : 'N/A',
    newestDate: stats?.newest_ts 
      ? new Date((stats.newest_ts as number) * 1000).toISOString() 
      : 'N/A',
    lastSync: stats?.last_sync_ts 
      ? new Date((stats.last_sync_ts as number) * 1000).toISOString() 
      : 'N/A'
  };
}

/**
 * Query-Hilfsfunktion: Hole alle Funding Rates für ein Symbol
 */
export async function queryUnifiedFundingRates(
  env: Env,
  normalizedSymbol: string,
  fromTimestamp?: number,
  toTimestamp?: number,
  exchanges?: string[]
): Promise<any[]> {
  let query = `
    SELECT 
      normalized_symbol,
      exchange,
      funding_time,
      datetime(funding_time, 'unixepoch') as timestamp,
      original_symbol,
      rate_raw,
      rate_raw_percent,
      interval_hours,
      rate_1h_percent,
      rate_apr,
      source,
      open_interest
    FROM unified_v3
    WHERE normalized_symbol = ?
  `;
  
  const params: any[] = [normalizedSymbol.toUpperCase()];
  
  if (fromTimestamp) {
    query += ' AND funding_time >= ?';
    params.push(fromTimestamp);
  }
  
  if (toTimestamp) {
    query += ' AND funding_time <= ?';
    params.push(toTimestamp);
  }
  
  if (exchanges && exchanges.length > 0) {
    const placeholders = exchanges.map(() => '?').join(',');
    query += ` AND exchange IN (${placeholders})`;
    params.push(...exchanges);
  }
  
  query += ' ORDER BY funding_time DESC, exchange';
  
  const result = await env.DB_UNIFIED.prepare(query)
    .bind(...params)
    .all();
  
  return result.results || [];
}
