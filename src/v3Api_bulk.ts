/**
 * Bulk V3 API Endpoints
 * Query multiple symbols at once for efficiency
 * Includes /latest endpoint for frontend table views
 */

import { Env } from './types';
import { getLowOIVariationalSymbols } from './v3Api';

/**
 * Parse time range parameter (24h, 3d, 7d, 14d, 30d)
 */
function parseTimeRange(range: string): { from: number; to: number } | null {
  const now = Math.floor(Date.now() / 1000);
  const match = range.match(/^(\d+)([hdw])$/);
  
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  let seconds = 0;
  switch (unit) {
    case 'h': seconds = value * 3600; break;
    case 'd': seconds = value * 86400; break;
    case 'w': seconds = value * 604800; break;
    default: return null;
  }
  
  return {
    from: now - seconds,
    to: now
  };
}

/**
 * GET /api/v3/funding/rates/bulk
 * Query funding rates for multiple symbols at once
 * 
 * Query params:
 * - symbols: Comma-separated list of symbols (optional, if not provided returns all symbols)
 * - exchanges: Comma-separated list of exchanges (optional)
 * - range: Time range (optional, e.g., 24h, 3d, 7d)
 * - limit: Max results per symbol (optional, default 100)
 */
export async function handleBulkFundingRates(
  env: Env,
  searchParams: URLSearchParams
): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  
  const symbolsParam = searchParams.get('symbols');
  
  let symbols: string[] = [];
  
  if (symbolsParam) {
    symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase());
    
    if (symbols.length === 0 || symbols.length > 50) {
      return Response.json({
        success: false,
        error: 'Must provide between 1 and 50 symbols'
      }, { status: 400, headers: corsHeaders });
    }
  }
  
  const exchangesParam = searchParams.get('exchanges');
  const exchanges = exchangesParam ? exchangesParam.split(',').map(e => e.trim()) : undefined;
  
  const rangeParam = searchParams.get('range');
  let fromTs: number | undefined;
  let toTs: number | undefined;
  
  if (rangeParam) {
    const timeRange = parseTimeRange(rangeParam);
    if (!timeRange) {
      return Response.json({
        success: false,
        error: 'Invalid range format. Use: 24h, 3d, 7d, 14d, 30d'
      }, { status: 400, headers: corsHeaders });
    }
    fromTs = timeRange.from;
    toTs = timeRange.to;
  }
  
  const limitParam = searchParams.get('limit');
  const limitPerSymbol = limitParam ? parseInt(limitParam) : 100;
  
  if (isNaN(limitPerSymbol) || limitPerSymbol < 1 || limitPerSymbol > 1000) {
    return Response.json({
      success: false,
      error: 'Limit must be between 1 and 1000'
    }, { status: 400, headers: corsHeaders });
  }
  
  try {
    // Build query to get all matching records
    let query = `
      SELECT normalized_symbol, exchange, funding_time, original_symbol, rate_1h_percent, interval_hours, source
      FROM unified_v3
      WHERE 1=1
    `;
    
    const params: any[] = [];
    
    // Filter by symbols if provided
    if (symbols.length > 0) {
      const symbolPlaceholders = symbols.map(() => '?').join(',');
      query += ` AND normalized_symbol IN (${symbolPlaceholders})`;
      params.push(...symbols);
    }
    
    // Filter by time range
    if (fromTs !== undefined) {
      query += ' AND funding_time >= ?';
      params.push(fromTs);
    }
    
    if (toTs !== undefined) {
      query += ' AND funding_time <= ?';
      params.push(toTs);
    }
    
    // Filter by exchanges if specified
    if (exchanges && exchanges.length > 0) {
      const exchangePlaceholders = exchanges.map(() => '?').join(',');
      query += ` AND exchange IN (${exchangePlaceholders})`;
      params.push(...exchanges);
    }
    
    query += ' ORDER BY exchange, normalized_symbol, funding_time DESC';
    
    const result = await env.DB_UNIFIED.prepare(query).bind(...params).all();
    const lowOI = await getLowOIVariationalSymbols(env);
    const allRecords = (result.results || []).filter((r: any) =>
      !(r.exchange === 'variational' && lowOI.has(r.normalized_symbol))
    );
    
    // If no symbols specified, get unique symbols from results
    if (symbols.length === 0) {
      const uniqueSymbols = new Set<string>();
      for (const record of allRecords) {
        uniqueSymbols.add(record.normalized_symbol as string);
      }
      symbols = Array.from(uniqueSymbols).sort();
    }
    
    // Group by exchange
    const groupedByExchange: Record<string, any[]> = {};
    const recordsPerExchange: Record<string, number> = {};
    const maxRecordsPerExchange = symbols.length > 0 ? limitPerSymbol * symbols.length : limitPerSymbol * 100;
    
    for (const record of allRecords) {
      const exchange = record.exchange as string;
      if (!groupedByExchange[exchange]) {
        groupedByExchange[exchange] = [];
        recordsPerExchange[exchange] = 0;
      }
      
      // Apply limit per exchange
      if (recordsPerExchange[exchange] < maxRecordsPerExchange) {
        groupedByExchange[exchange].push(record);
        recordsPerExchange[exchange]++;
      }
    }
    
    const totalRecords = Object.values(groupedByExchange).reduce((sum, arr) => sum + arr.length, 0);
    
    return Response.json({
      success: true,
      symbols: symbols,
      filters: {
        exchanges: exchanges || 'all',
        timeRange: {
          from: fromTs ? new Date(fromTs * 1000).toISOString() : null,
          to: toTs ? new Date(toTs * 1000).toISOString() : null
        }
      },
      exchanges: Object.keys(groupedByExchange).sort(),
      count: totalRecords,
      data: groupedByExchange
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[V3 API] Bulk funding rates query error:', error);
    return Response.json({
      success: false,
      error: String(error)
    }, { status: 500, headers: corsHeaders });
  }
}

/**
 * GET /api/v3/funding/rates/latest
 * Returns the most recent funding rate per symbol per exchange
 * Optimized for frontend table views (~50KB instead of ~75MB)
 * 
 * Query params:
 * - exchanges: Comma-separated list of exchanges (optional)
 * - sort: Sort field: 'apr', 'rate', 'symbol' (optional, default 'symbol')
 * - order: Sort order: 'asc', 'desc' (optional, default 'desc' for apr/rate, 'asc' for symbol)
 * - symbols: Comma-separated list of symbols to filter (optional)
 */
export async function handleLatestFundingRates(
  env: Env,
  searchParams: URLSearchParams
): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  const exchangesParam = searchParams.get('exchanges');
  const exchanges = exchangesParam ? exchangesParam.split(',').map(e => e.trim()) : undefined;

  const symbolsParam = searchParams.get('symbols');
  const symbols = symbolsParam ? symbolsParam.split(',').map(s => s.trim().toUpperCase()) : undefined;

  const sort = searchParams.get('sort') || 'symbol';
  const orderParam = searchParams.get('order');
  const order = orderParam || (sort === 'symbol' ? 'asc' : 'desc');

  try {
    // Use 24h cutoff to limit scan range, then GROUP BY + HAVING for latest per symbol/exchange
    // Round cutoff to nearest hour to maximize KV cache hits (same key for 1 hour window)
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - 86400;
    const cutoffRounded = Math.floor(cutoff / 3600) * 3600;

    let query = `
      SELECT 
        normalized_symbol,
        exchange,
        MAX(funding_time) as funding_time,
        original_symbol,
        rate_1h_percent,
        rate_apr,
        interval_hours,
        source,
        open_interest
      FROM unified_v3
      WHERE rate_1h_percent IS NOT NULL
        AND funding_time > ?
    `;

    const params: any[] = [cutoffRounded];

    if (exchanges && exchanges.length > 0) {
      const placeholders = exchanges.map(() => '?').join(',');
      query += ` AND exchange IN (${placeholders})`;
      params.push(...exchanges);
    }

    if (symbols && symbols.length > 0) {
      const placeholders = symbols.map(() => '?').join(',');
      query += ` AND normalized_symbol IN (${placeholders})`;
      params.push(...symbols);
    }

    query += ` GROUP BY normalized_symbol, exchange`;

    // Sort
    const validSorts: Record<string, string> = {
      'apr': 'rate_apr',
      'rate': 'rate_1h_percent',
      'symbol': 'normalized_symbol',
      'exchange': 'exchange',
      'time': 'funding_time',
    };
    const sortField = validSorts[sort] || 'normalized_symbol';
    const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortField} ${sortOrder}`;

    const result = await env.DB_UNIFIED.prepare(query).bind(...params).all();
    const lowOI = await getLowOIVariationalSymbols(env);
    const records = (result.results || []).filter((r: any) =>
      !(r.exchange === 'variational' && lowOI.has(r.normalized_symbol))
    );

    // Get unique counts
    const uniqueSymbols = new Set(records.map((r: any) => r.normalized_symbol));
    const uniqueExchanges = new Set(records.map((r: any) => r.exchange));

    return Response.json({
      success: true,
      count: records.length,
      symbols: uniqueSymbols.size,
      exchanges: Array.from(uniqueExchanges).sort(),
      sort: { field: sort, order: sortOrder.toLowerCase() },
      data: records
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[V3 API] Latest funding rates query error:', error);
    return Response.json({
      success: false,
      error: String(error)
    }, { status: 500, headers: corsHeaders });
  }
}

/**
 * GET /api/v3/funding/ma/bulk
 * Query moving averages for multiple symbols at once
 * 
 * Query params:
 * - symbols: Comma-separated list of symbols (optional, if not provided returns all symbols)
 * - period: MA period (required, e.g., 1h, 24h, 3d, 7d, 14d, 30d)
 * - exchanges: Comma-separated list of exchanges (optional)
 * - limit: Max results per symbol (optional, default 10)
 */
export async function handleBulkFundingMA(
  env: Env,
  searchParams: URLSearchParams
): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  
  const symbolsParam = searchParams.get('symbols');
  const period = searchParams.get('period');
  
  if (!period) {
    return Response.json({
      success: false,
      error: 'Period parameter is required (1h, 24h, 3d, 7d, 14d, 30d)'
    }, { status: 400, headers: corsHeaders });
  }
  
  if (!['1h', '24h', '3d', '7d', '14d', '30d'].includes(period)) {
    return Response.json({
      success: false,
      error: 'Invalid period. Use: 1h, 24h, 3d, 7d, 14d, 30d'
    }, { status: 400, headers: corsHeaders });
  }
  
  let symbols: string[] = [];
  
  if (symbolsParam) {
    symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase());
    
    if (symbols.length === 0 || symbols.length > 50) {
      return Response.json({
        success: false,
        error: 'Must provide between 1 and 50 symbols'
      }, { status: 400, headers: corsHeaders });
    }
  }
  
  const exchangesParam = searchParams.get('exchanges');
  const exchanges = exchangesParam ? exchangesParam.split(',').map(e => e.trim()) : undefined;
  
  const limitParam = searchParams.get('limit');
  const limitPerSymbol = limitParam ? parseInt(limitParam) : 10;
  
  if (isNaN(limitPerSymbol) || limitPerSymbol < 1 || limitPerSymbol > 100) {
    return Response.json({
      success: false,
      error: 'Limit must be between 1 and 100'
    }, { status: 400, headers: corsHeaders });
  }
  
  try {
    // Build query to get all matching MAs
    let query = `
      SELECT normalized_symbol, exchange, period, ma_rate_1h, ma_apr, data_points, std_dev, min_rate, max_rate, calculated_at, period_start, period_end
      FROM funding_ma
      WHERE period = ?
    `;
    
    const params: any[] = [period];
    
    // Filter by symbols if provided
    if (symbols.length > 0) {
      const symbolPlaceholders = symbols.map(() => '?').join(',');
      query += ` AND normalized_symbol IN (${symbolPlaceholders})`;
      params.push(...symbols);
    }
    
    // Filter by exchanges if specified
    if (exchanges && exchanges.length > 0) {
      const exchangePlaceholders = exchanges.map(() => '?').join(',');
      query += ` AND exchange IN (${exchangePlaceholders})`;
      params.push(...exchanges);
    }
    
    query += ' ORDER BY exchange, normalized_symbol, calculated_at DESC';
    
    const result = await env.DB_UNIFIED.prepare(query).bind(...params).all();
    const lowOI = await getLowOIVariationalSymbols(env);
    const allRecords = (result.results || []).filter((r: any) =>
      !(r.exchange === 'variational' && lowOI.has(r.normalized_symbol))
    );
    
    // If no symbols specified, get unique symbols from results
    if (symbols.length === 0) {
      const uniqueSymbols = new Set<string>();
      for (const record of allRecords) {
        uniqueSymbols.add(record.normalized_symbol as string);
      }
      symbols = Array.from(uniqueSymbols).sort();
    }
    
    // Group by exchange
    const groupedByExchange: Record<string, any[]> = {};
    const recordsPerExchange: Record<string, number> = {};
    const maxRecordsPerExchange = symbols.length > 0 ? limitPerSymbol * symbols.length : limitPerSymbol * 100;
    
    for (const record of allRecords) {
      const exchange = record.exchange as string;
      if (!groupedByExchange[exchange]) {
        groupedByExchange[exchange] = [];
        recordsPerExchange[exchange] = 0;
      }
      
      // Apply limit per exchange
      if (recordsPerExchange[exchange] < maxRecordsPerExchange) {
        groupedByExchange[exchange].push(record);
        recordsPerExchange[exchange]++;
      }
    }
    
    const totalRecords = Object.values(groupedByExchange).reduce((sum, arr) => sum + arr.length, 0);
    
    return Response.json({
      success: true,
      symbols: symbols,
      period: period,
      filters: {
        exchanges: exchanges || 'all'
      },
      exchanges: Object.keys(groupedByExchange).sort(),
      count: totalRecords,
      data: groupedByExchange
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[V3 API] Bulk MA query error:', error);
    return Response.json({
      success: false,
      error: String(error)
    }, { status: 500, headers: corsHeaders });
  }
}
