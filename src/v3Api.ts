/**
 * V3 API Endpoints for unified_v3 table
 * Cross-exchange funding rate queries with flexible time ranges
 */

import { Env } from './types';

// Minimum open interest (USD) for Variational tokens to appear in API responses
const MIN_OI_VARIATIONAL = 200000;

// In-memory cache for low-OI symbols (survives within a single Worker invocation)
let _lowOICache: { symbols: Set<string>; ts: number } | null = null;
const LOW_OI_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LOW_OI_KV_KEY = 'low_oi_variational';
const LOW_OI_KV_TTL = 300; // 5 minutes

/**
 * Get set of Variational symbols with open interest below threshold.
 * Uses 3-tier cache: in-memory → KV → DB query
 */
export async function getLowOIVariationalSymbols(env: Env): Promise<Set<string>> {
  // Tier 1: In-memory cache (same Worker instance)
  const now = Date.now();
  if (_lowOICache && (now - _lowOICache.ts) < LOW_OI_CACHE_TTL_MS) {
    return _lowOICache.symbols;
  }

  // Tier 2: KV cache
  try {
    if (env.CACHE) {
      const cached = await env.CACHE.get(LOW_OI_KV_KEY, 'text');
      if (cached) {
        const symbols = new Set<string>(JSON.parse(cached));
        _lowOICache = { symbols, ts: now };
        return symbols;
      }
    }
  } catch { /* fall through to DB */ }

  // Tier 3: DB query
  const lowOI = new Set<string>();
  try {
    const result = await env.DB_UNIFIED.prepare(`
      SELECT u.normalized_symbol
      FROM unified_v3 u
      INNER JOIN (
        SELECT normalized_symbol, MAX(funding_time) as max_ft
        FROM unified_v3
        WHERE exchange = 'variational'
          AND open_interest IS NOT NULL
        GROUP BY normalized_symbol
      ) latest ON u.normalized_symbol = latest.normalized_symbol
               AND u.funding_time = latest.max_ft
      WHERE u.exchange = 'variational'
        AND (u.open_interest IS NULL OR u.open_interest < ?)
    `).bind(MIN_OI_VARIATIONAL).all();
    if (result.success && result.results) {
      for (const row of result.results as any[]) {
        lowOI.add(row.normalized_symbol);
      }
    }

    // Store in KV + memory
    _lowOICache = { symbols: lowOI, ts: now };
    try {
      if (env.CACHE) {
        await env.CACHE.put(LOW_OI_KV_KEY, JSON.stringify([...lowOI]), { expirationTtl: LOW_OI_KV_TTL });
      }
    } catch { /* non-critical */ }
  } catch (e) {
    console.error('[V3 API] Error fetching low-OI Variational symbols:', e);
  }
  return lowOI;
}

interface TimeRange {
  from: number;
  to: number;
}

/**
 * Parse time range parameter (24h, 3d, 7d, 14d, 30d)
 */
function parseTimeRange(range: string): TimeRange | null {
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
 * Parse custom date/time (ISO 8601 or Unix timestamp)
 */
function parseDateTime(dateStr: string): number | null {
  // Try Unix timestamp first
  if (/^\d+$/.test(dateStr)) {
    return parseInt(dateStr);
  }
  
  // Try ISO 8601 date
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return null;
  }
  
  return Math.floor(date.getTime() / 1000);
}

/**
 * GET /api/v3/funding/rates
 * Query funding rates (1h normalized) with flexible filtering
 * 
 * Query params:
 * - symbol: Symbol to query (required, e.g., BTC, ETH)
 * - exchanges: Comma-separated list of exchanges (optional, e.g., hyperliquid,paradex)
 * - range: Time range (optional, e.g., 24h, 3d, 7d, 14d, 30d)
 * - from: Custom start time (optional, ISO 8601 or Unix timestamp)
 * - to: Custom end time (optional, ISO 8601 or Unix timestamp)
 * - limit: Max results (optional, default 1000)
 */
export async function handleFundingRates(
  env: Env,
  searchParams: URLSearchParams
): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  const symbol = searchParams.get('symbol');
  
  if (!symbol) {
    return Response.json({
      success: false,
      error: 'Symbol parameter is required'
    }, { status: 400, headers: corsHeaders });
  }
  
  // Parse exchanges filter
  const exchangesParam = searchParams.get('exchanges') || searchParams.get('exchange');
  const exchanges = exchangesParam ? exchangesParam.split(',').map(e => e.trim()) : undefined;
  
  // Parse time range
  let fromTs: number | undefined;
  let toTs: number | undefined;
  
  const rangeParam = searchParams.get('range');
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
  
  // Custom date range overrides range parameter
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  
  if (fromParam) {
    const parsed = parseDateTime(fromParam);
    if (parsed === null) {
      return Response.json({
        success: false,
        error: 'Invalid from date format. Use ISO 8601 (e.g., 2026-02-03T11:00:00Z) or Unix timestamp'
      }, { status: 400, headers: corsHeaders });
    }
    fromTs = parsed;
  }
  
  if (toParam) {
    const parsed = parseDateTime(toParam);
    if (parsed === null) {
      return Response.json({
        success: false,
        error: 'Invalid to date format. Use ISO 8601 (e.g., 2026-02-05T14:00:00Z) or Unix timestamp'
      }, { status: 400, headers: corsHeaders });
    }
    toTs = parsed;
  }
  
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam), 100000) : 100000;
  
  try {
    // Build query
    let query = `
      SELECT 
        normalized_symbol,
        exchange,
        funding_time,
        datetime(funding_time, 'unixepoch') as timestamp,
        original_symbol,
        rate_1h_percent,
        interval_hours,
        source,
        open_interest
      FROM unified_v3
      WHERE normalized_symbol = ?
    `;
    
    const params: any[] = [symbol.toUpperCase()];
    
    if (fromTs !== undefined) {
      query += ' AND funding_time >= ?';
      params.push(fromTs);
    }
    
    if (toTs !== undefined) {
      query += ' AND funding_time <= ?';
      params.push(toTs);
    }
    
    if (exchanges && exchanges.length > 0) {
      const placeholders = exchanges.map(() => '?').join(',');
      query += ` AND exchange IN (${placeholders})`;
      params.push(...exchanges);
    }
    
    query += ' ORDER BY funding_time DESC, exchange';
    query += ` LIMIT ${limit}`;
    
    const result = await env.DB_UNIFIED.prepare(query).bind(...params).all();
    
    // Filter out Variational tokens with low open interest
    const lowOI = await getLowOIVariationalSymbols(env);
    const rows = (result.results || []).filter((r: any) =>
      !(r.exchange === 'variational' && lowOI.has(r.normalized_symbol))
    );

    return Response.json({
      success: true,
      symbol: symbol.toUpperCase(),
      filters: {
        exchanges: exchanges || 'all',
        timeRange: {
          from: fromTs ? new Date(fromTs * 1000).toISOString() : null,
          to: toTs ? new Date(toTs * 1000).toISOString() : null
        }
      },
      count: rows.length,
      data: rows
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[V3 API] Funding rates query error:', error);
    return Response.json({
      success: false,
      error: String(error)
    }, { status: 500, headers: corsHeaders });
  }
}

/**
 * GET /api/v3/funding/apr
 * Query funding rates APR with flexible filtering
 * 
 * Query params: Same as /api/v3/funding/rates
 */
export async function handleFundingAPR(
  env: Env,
  searchParams: URLSearchParams
): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  const symbol = searchParams.get('symbol');
  
  if (!symbol) {
    return Response.json({
      success: false,
      error: 'Symbol parameter is required'
    }, { status: 400, headers: corsHeaders });
  }
  
  // Parse exchanges filter
  const exchangesParam = searchParams.get('exchanges') || searchParams.get('exchange');
  const exchanges = exchangesParam ? exchangesParam.split(',').map(e => e.trim()) : undefined;
  
  // Parse time range
  let fromTs: number | undefined;
  let toTs: number | undefined;
  
  const rangeParam = searchParams.get('range');
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
  
  // Custom date range overrides range parameter
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  
  if (fromParam) {
    const parsed = parseDateTime(fromParam);
    if (parsed === null) {
      return Response.json({
        success: false,
        error: 'Invalid from date format. Use ISO 8601 (e.g., 2026-02-03T11:00:00Z) or Unix timestamp'
      }, { status: 400, headers: corsHeaders });
    }
    fromTs = parsed;
  }
  
  if (toParam) {
    const parsed = parseDateTime(toParam);
    if (parsed === null) {
      return Response.json({
        success: false,
        error: 'Invalid to date format. Use ISO 8601 (e.g., 2026-02-05T14:00:00Z) or Unix timestamp'
      }, { status: 400, headers: corsHeaders });
    }
    toTs = parsed;
  }
  
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.min(parseInt(limitParam), 100000) : 100000;
  
  try {
    // Build query
    let query = `
      SELECT 
        normalized_symbol,
        exchange,
        funding_time,
        datetime(funding_time, 'unixepoch') as timestamp,
        original_symbol,
        rate_apr,
        rate_1h_percent,
        interval_hours,
        source
      FROM unified_v3
      WHERE normalized_symbol = ?
        AND rate_apr IS NOT NULL
    `;
    
    const params: any[] = [symbol.toUpperCase()];
    
    if (fromTs !== undefined) {
      query += ' AND funding_time >= ?';
      params.push(fromTs);
    }
    
    if (toTs !== undefined) {
      query += ' AND funding_time <= ?';
      params.push(toTs);
    }
    
    if (exchanges && exchanges.length > 0) {
      const placeholders = exchanges.map(() => '?').join(',');
      query += ` AND exchange IN (${placeholders})`;
      params.push(...exchanges);
    }
    
    query += ' ORDER BY funding_time DESC, exchange';
    query += ` LIMIT ${limit}`;
    
    const result = await env.DB_UNIFIED.prepare(query).bind(...params).all();
    
    // Filter out Variational tokens with low open interest
    const lowOI = await getLowOIVariationalSymbols(env);
    const rows = (result.results || []).filter((r: any) =>
      !(r.exchange === 'variational' && lowOI.has(r.normalized_symbol))
    );

    return Response.json({
      success: true,
      symbol: symbol.toUpperCase(),
      filters: {
        exchanges: exchanges || 'all',
        timeRange: {
          from: fromTs ? new Date(fromTs * 1000).toISOString() : null,
          to: toTs ? new Date(toTs * 1000).toISOString() : null
        }
      },
      count: rows.length,
      data: rows
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[V3 API] Funding APR query error:', error);
    return Response.json({
      success: false,
      error: String(error)
    }, { status: 500, headers: corsHeaders });
  }
}

/**
 * GET /api/v3/funding/summary
 * Get aggregated statistics for a symbol across exchanges
 * 
 * Query params:
 * - symbol: Symbol to query (required)
 * - range: Time range (optional, default 24h)
 */
export async function handleFundingSummary(
  env: Env,
  searchParams: URLSearchParams
): Promise<Response> {
  const symbol = searchParams.get('symbol');
  
  if (!symbol) {
    return Response.json({
      success: false,
      error: 'Symbol parameter is required'
    }, { status: 400 });
  }
  
  // Parse time range (default 24h)
  const rangeParam = searchParams.get('range') || '24h';
  const timeRange = parseTimeRange(rangeParam);
  
  if (!timeRange) {
    return Response.json({
      success: false,
      error: 'Invalid range format. Use: 24h, 3d, 7d, 14d, 30d'
    }, { status: 400 });
  }
  
  try {
    const query = `
      SELECT 
        exchange,
        COUNT(*) as data_points,
        AVG(rate_1h_percent) as avg_rate_1h,
        MIN(rate_1h_percent) as min_rate_1h,
        MAX(rate_1h_percent) as max_rate_1h,
        AVG(rate_apr) as avg_apr,
        MIN(rate_apr) as min_apr,
        MAX(rate_apr) as max_apr,
        MAX(funding_time) as latest_funding_time
      FROM unified_v3
      WHERE normalized_symbol = ?
        AND funding_time >= ?
        AND funding_time <= ?
      GROUP BY exchange
      ORDER BY exchange
    `;
    
    const result = await env.DB_UNIFIED.prepare(query)
      .bind(symbol.toUpperCase(), timeRange.from, timeRange.to)
      .all();
    
    // Filter out Variational entries with low open interest
    const lowOI = await getLowOIVariationalSymbols(env);
    const exchanges = (result.results || []).filter((r: any) =>
      !(r.exchange === 'variational' && lowOI.has(symbol.toUpperCase()))
    );

    return Response.json({
      success: true,
      symbol: symbol.toUpperCase(),
      timeRange: {
        from: new Date(timeRange.from * 1000).toISOString(),
        to: new Date(timeRange.to * 1000).toISOString(),
        range: rangeParam
      },
      exchanges
    });
  } catch (error) {
    console.error('[V3 API] Funding summary query error:', error);
    return Response.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}

/**
 * GET /api/v3/symbols
 * Returns all available symbols across all exchanges
 * 
 * Query params:
 * - exchange: Filter by specific exchange (optional)
 */
export async function handleSymbols(
  env: Env,
  searchParams: URLSearchParams
): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  
  const exchangeFilter = searchParams.get('exchange');
  
  try {
    let query = `
      SELECT DISTINCT normalized_symbol, exchange
      FROM unified_v3
      WHERE rate_1h_percent IS NOT NULL
    `;
    
    const params: any[] = [];
    
    if (exchangeFilter) {
      query += ' AND exchange = ?';
      params.push(exchangeFilter);
    }
    
    query += ' ORDER BY normalized_symbol, exchange';
    
    const result = await env.DB_UNIFIED.prepare(query).bind(...params).all();
    
    // Group symbols by exchange
    const symbolsByExchange: Record<string, string[]> = {};
    const allSymbols = new Set<string>();
    
    // Filter out Variational symbols with low open interest
    const lowOI = await getLowOIVariationalSymbols(env);

    for (const row of (result.results || [])) {
      const symbol = row.normalized_symbol as string;
      const exchange = row.exchange as string;
      
      if (exchange === 'variational' && lowOI.has(symbol)) continue;

      allSymbols.add(symbol);
      
      if (!symbolsByExchange[exchange]) {
        symbolsByExchange[exchange] = [];
      }
      symbolsByExchange[exchange].push(symbol);
    }
    
    const sortedSymbols = Array.from(allSymbols).sort();
    
    return Response.json({
      success: true,
      count: sortedSymbols.length,
      symbols: sortedSymbols,
      by_exchange: symbolsByExchange,
      exchanges: Object.keys(symbolsByExchange).sort()
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[V3 API] Symbols query error:', error);
    return Response.json({
      success: false,
      error: String(error)
    }, { status: 500, headers: corsHeaders });
  }
}
