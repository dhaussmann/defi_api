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
  'variational'
];

/**
 * JavaScript-Funktion zur Symbol-Normalisierung
 * Identisch zur Logik in aggregateTo1Hour()
 */
function normalizeSymbol(symbol: string): string {
  return symbol
    .replace(/hyna:/gi, '')
    .replace(/hyena:/gi, '')
    .replace(/xyz:/gi, '')
    .replace(/flx:/gi, '')
    .replace(/felix:/gi, '')
    .replace(/vntl:/gi, '')
    .replace(/ventuals:/gi, '')
    .replace(/km:/gi, '')
    .replace(/edgex:/gi, '')
    .replace(/aster:/gi, '')
    .replace(/paradex:/gi, '')
    .replace(/extended:/gi, '')
    .replace(/lighter:/gi, '')
    .replace(/nado:/gi, '')
    .replace(/variational:/gi, '')
    .replace(/-USD-PERP/g, '')
    .replace(/-PERP/g, '')
    .replace(/-USD/g, '')
    .replace(/USDT/g, '')
    .replace(/USD/g, '')
    .replace(/1000/g, '')
    .replace(/k/g, '')
    .replace(/\//g, '')
    .replace(/_/g, '')
    .toUpperCase();
}

/**
 * Synchronisiert eine einzelne V3 Exchange-Tabelle
 */
async function syncExchangeToUnified(
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
        source
      FROM ${tableName}
      WHERE rate_raw IS NOT NULL
        AND ABS(rate_raw_percent) <= 10
        AND collected_at >= ?
      ORDER BY collected_at
      LIMIT 50000
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
        return env.DB_UNIFIED.prepare(`
          INSERT OR REPLACE INTO unified_v3 (
            normalized_symbol, exchange, funding_time, original_symbol, base_asset,
            rate_raw, rate_raw_percent, interval_hours, rate_1h_percent, rate_apr,
            collected_at, source, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          normalizedSymbol,
          exchange,
          row.funding_time,
          row.symbol,
          row.base_asset,
          row.rate_raw,
          row.rate_raw_percent,
          row.interval_hours,
          row.rate_1h_percent,
          row.rate_apr,
          row.collected_at,
          row.source,
          now
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
 * Hauptfunktion: Synchronisiert alle V3 Exchanges
 */
export async function syncAllV3ToUnified(env: Env): Promise<{
  success: boolean;
  totalRecords: number;
  byExchange: Record<string, number>;
  duration: number;
}> {
  const startTime = Date.now();
  console.log('[UnifiedSync] Starting sync of all V3 exchanges to unified_v3');
  
  // Hole letzten Sync-Zeitpunkt aus DB_UNIFIED
  const lastSyncQuery = await env.DB_UNIFIED.prepare(`
    SELECT MAX(synced_at) as last_sync FROM unified_v3
  `).first();
  
  const lastSyncTime = (lastSyncQuery?.last_sync as number) || 0;
  console.log(`[UnifiedSync] Last sync: ${lastSyncTime ? new Date(lastSyncTime * 1000).toISOString() : 'never'}`);
  
  const results: Record<string, number> = {};
  let totalRecords = 0;
  
  // Synchronisiere jede Exchange
  for (const exchange of V3_EXCHANGES) {
    try {
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
      source
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
