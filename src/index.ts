import { LighterTracker } from './LighterTracker';
import { ParadexTracker } from './ParadexTracker';
import { HyperliquidTracker } from './HyperliquidTracker';
import { EdgeXTracker } from './EdgeXTracker';
import { AsterTracker } from './AsterTracker';
import { PacificaTracker } from './PacificaTracker';
import { ExtendedTracker } from './ExtendedTracker';
import { Env, ApiResponse, MarketStatsQuery, MarketStatsRecord } from './types';

export { LighterTracker, ParadexTracker, HyperliquidTracker, EdgeXTracker, AsterTracker, PacificaTracker, ExtendedTracker };

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Update normalized_tokens table every minute
    ctx.waitUntil(updateNormalizedTokens(env));

    // Run hourly aggregation (at minute 0 of each hour)
    const now = new Date();
    if (now.getMinutes() === 0) {
      ctx.waitUntil(aggregateOldMarketData(env));
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Ensure trackers are started automatically on any request
      await ensureTrackersStarted(env);

      // Route requests
      if (path.startsWith('/tracker/')) {
        return await handleTrackerRoute(request, env, path, corsHeaders);
      } else if (path.startsWith('/api/')) {
        return await handleApiRoute(request, env, path, corsHeaders);
      } else if (path === '/' || path === '') {
        return handleRoot(corsHeaders);
      } else {
        return new Response('Not found', { status: 404, headers: corsHeaders });
      }
    } catch (error) {
      console.error('Request error:', error);
      return Response.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Internal server error',
        } as ApiResponse,
        { status: 500, headers: corsHeaders }
      );
    }
  },
};

// Ensure all trackers are started automatically
async function ensureTrackersStarted(env: Env): Promise<void> {
  try {
    // Start Lighter Tracker
    const lighterId = env.LIGHTER_TRACKER.idFromName('lighter-main');
    const lighterStub = env.LIGHTER_TRACKER.get(lighterId);
    await lighterStub.fetch('https://internal/status');

    // Start Paradex Tracker
    const paradexId = env.PARADEX_TRACKER.idFromName('paradex-main');
    const paradexStub = env.PARADEX_TRACKER.get(paradexId);
    await paradexStub.fetch('https://internal/status');

    // Start Hyperliquid Tracker
    const hyperliquidId = env.HYPERLIQUID_TRACKER.idFromName('hyperliquid-main');
    const hyperliquidStub = env.HYPERLIQUID_TRACKER.get(hyperliquidId);
    await hyperliquidStub.fetch('https://internal/status');

    // Start EdgeX Tracker
    const edgexId = env.EDGEX_TRACKER.idFromName('edgex-main');
    const edgexStub = env.EDGEX_TRACKER.get(edgexId);
    await edgexStub.fetch('https://internal/status');

    // Start Aster Tracker
    const asterId = env.ASTER_TRACKER.idFromName('aster-main');
    const asterStub = env.ASTER_TRACKER.get(asterId);
    await asterStub.fetch('https://internal/status');

    // Start Pacifica Tracker
    const pacificaId = env.PACIFICA_TRACKER.idFromName('pacifica-main');
    const pacificaStub = env.PACIFICA_TRACKER.get(pacificaId);
    await pacificaStub.fetch('https://internal/status');

    // Start Extended Tracker
    console.log('[Worker] Starting Extended Tracker initialization');
    const extendedId = env.EXTENDED_TRACKER.idFromName('extended-main');
    console.log('[Worker] Extended ID created:', extendedId.toString());
    const extendedStub = env.EXTENDED_TRACKER.get(extendedId);
    console.log('[Worker] Extended stub obtained, calling fetch');
    await extendedStub.fetch('https://internal/status');
    console.log('[Worker] Extended Tracker initialized');
  } catch (error) {
    console.error('[Worker] Failed to ensure trackers started:', error);
  }
}

// Handle tracker control routes
async function handleTrackerRoute(
  request: Request,
  env: Env,
  path: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  let exchange: string;
  let doPath: string;
  let stub: DurableObjectStub;

  // Determine which exchange tracker to use
  if (path.startsWith('/tracker/lighter/')) {
    exchange = 'lighter';
    doPath = path.replace('/tracker/lighter', '');
    const id = env.LIGHTER_TRACKER.idFromName('lighter-main');
    stub = env.LIGHTER_TRACKER.get(id);
  } else if (path.startsWith('/tracker/paradex/')) {
    exchange = 'paradex';
    doPath = path.replace('/tracker/paradex', '');
    const id = env.PARADEX_TRACKER.idFromName('paradex-main');
    stub = env.PARADEX_TRACKER.get(id);
  } else if (path.startsWith('/tracker/hyperliquid/')) {
    exchange = 'hyperliquid';
    doPath = path.replace('/tracker/hyperliquid', '');
    const id = env.HYPERLIQUID_TRACKER.idFromName('hyperliquid-main');
    stub = env.HYPERLIQUID_TRACKER.get(id);
  } else if (path.startsWith('/tracker/edgex/')) {
    exchange = 'edgex';
    doPath = path.replace('/tracker/edgex', '');
    const id = env.EDGEX_TRACKER.idFromName('edgex-main');
    stub = env.EDGEX_TRACKER.get(id);
  } else if (path.startsWith('/tracker/aster/')) {
    exchange = 'aster';
    doPath = path.replace('/tracker/aster', '');
    const id = env.ASTER_TRACKER.idFromName('aster-main');
    stub = env.ASTER_TRACKER.get(id);
  } else if (path.startsWith('/tracker/pacifica/')) {
    exchange = 'pacifica';
    doPath = path.replace('/tracker/pacifica', '');
    const id = env.PACIFICA_TRACKER.idFromName('pacifica-main');
    stub = env.PACIFICA_TRACKER.get(id);
  } else if (path.startsWith('/tracker/extended/')) {
    console.log('[Worker] Extended tracker route matched');
    exchange = 'extended';
    doPath = path.replace('/tracker/extended', '');
    console.log(`[Worker] Extended doPath: ${doPath}`);
    const id = env.EXTENDED_TRACKER.idFromName('extended-main');
    stub = env.EXTENDED_TRACKER.get(id);
    console.log('[Worker] Extended stub obtained');
  } else {
    // Backward compatibility: /tracker/* routes to lighter
    exchange = 'lighter';
    doPath = path.replace('/tracker', '');
    const id = env.LIGHTER_TRACKER.idFromName('lighter-main');
    stub = env.LIGHTER_TRACKER.get(id);
  }

  // Forward request to Durable Object
  const doUrl = new URL(request.url);
  doUrl.pathname = doPath;

  const response = await stub.fetch(doUrl.toString(), request);
  const data = await response.json();

  return Response.json(data, {
    status: response.status,
    headers: corsHeaders,
  });
}

// Handle API data routes
async function handleApiRoute(
  request: Request,
  env: Env,
  path: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);

  switch (path) {
    case '/api/stats':
      return await getMarketStats(env, url, corsHeaders);
    case '/api/latest':
      return await getLatestStats(env, url, corsHeaders);
    case '/api/status':
      return await getTrackerStatus(env, corsHeaders);
    case '/api/trackers':
      return await getAllTrackersStatus(env, corsHeaders);
    case '/api/compare':
      return await compareTokenAcrossExchanges(env, url, corsHeaders);
    case '/api/tokens':
      return await getAvailableTokens(env, corsHeaders);
    case '/api/markets':
      return await getAllMarkets(env, url, corsHeaders);
    case '/api/funding-history':
      return await getFundingRateHistory(env, url, corsHeaders);
    case '/api/market-history':
      return await getMarketHistory(env, url, corsHeaders);
    case '/api/volatility':
      return await getVolatility(env, url, corsHeaders);
    case '/api/normalized-data':
      return await getNormalizedData(env, url, corsHeaders);
    default:
      return new Response('API endpoint not found', {
        status: 404,
        headers: corsHeaders,
      });
  }
}

// Normalize symbol names to a common format (base asset)
function normalizeSymbol(symbol: string): string {
  // Remove common suffixes
  let normalized = symbol
    .replace(/-USD-PERP$/i, '')  // Paradex: BTC-USD-PERP -> BTC
    .replace(/-USD$/i, '')        // Extended: BTC-USD -> BTC
    .replace(/USDT$/i, '')        // Aster: BTCUSDT -> BTC
    .replace(/USD$/i, '')         // EdgeX: BTCUSD -> BTC
    .replace(/^1000/i, '')        // Remove 1000 prefix: 1000PEPE -> PEPE
    .replace(/^k/i, '')           // Remove k prefix: kBONK -> BONK
    .toUpperCase();

  return normalized;
}

// Update normalized_tokens table with latest data from all exchanges
async function updateNormalizedTokens(env: Env): Promise<void> {
  try {
    console.log('[Cron] Starting normalized_tokens update');

    // Get latest data from each exchange
    const query = `
      WITH ranked_data AS (
        SELECT
          exchange,
          symbol,
          mark_price,
          index_price,
          open_interest_usd,
          daily_base_token_volume as volume_24h,
          funding_rate,
          next_funding_time,
          daily_price_change,
          daily_price_low,
          daily_price_high,
          created_at,
          ROW_NUMBER() OVER (PARTITION BY exchange, symbol ORDER BY created_at DESC) as rn
        FROM market_stats
        WHERE created_at > ?
      )
      SELECT * FROM ranked_data WHERE rn = 1
    `;

    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    const result = await env.DB.prepare(query).bind(fiveMinutesAgo).all();

    if (!result.success || !result.results) {
      throw new Error('Failed to fetch latest market data');
    }

    console.log(`[Cron] Fetched ${result.results.length} latest market entries`);

    // Group by normalized symbol and prepare upserts
    const upserts: D1PreparedStatement[] = [];
    const now = Math.floor(Date.now() / 1000);

    for (const row of result.results as any[]) {
      const normalizedSymbol = normalizeSymbol(row.symbol);
      const fundingRate = parseFloat(row.funding_rate || '0');

      // Lighter provides funding_rate already as percentage (0.0012 = 0.0012%)
      // Other exchanges provide it as decimal (0.0001 = 0.01%)
      // APR calculation: rate * 3 (per day) * 365 (days per year) * 100 (to percentage)
      // For Lighter: already in %, so multiply by 3 * 365 only
      const fundingRateAnnual = row.exchange === 'lighter'
        ? fundingRate * 3 * 365
        : fundingRate * 3 * 365 * 100;

      upserts.push(
        env.DB.prepare(
          `INSERT INTO normalized_tokens (
            symbol, exchange, mark_price, index_price, open_interest_usd,
            volume_24h, funding_rate, funding_rate_annual, next_funding_time,
            price_change_24h, price_low_24h, price_high_24h, original_symbol, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(symbol, exchange) DO UPDATE SET
            mark_price = excluded.mark_price,
            index_price = excluded.index_price,
            open_interest_usd = excluded.open_interest_usd,
            volume_24h = excluded.volume_24h,
            funding_rate = excluded.funding_rate,
            funding_rate_annual = excluded.funding_rate_annual,
            next_funding_time = excluded.next_funding_time,
            price_change_24h = excluded.price_change_24h,
            price_low_24h = excluded.price_low_24h,
            price_high_24h = excluded.price_high_24h,
            original_symbol = excluded.original_symbol,
            updated_at = excluded.updated_at`
        ).bind(
          normalizedSymbol,
          row.exchange,
          parseFloat(row.mark_price || '0'),
          parseFloat(row.index_price || '0'),
          parseFloat(row.open_interest_usd || '0'),
          parseFloat(row.volume_24h || '0'),
          fundingRate,
          fundingRateAnnual,
          row.next_funding_time ? parseInt(row.next_funding_time) : null,
          parseFloat(row.daily_price_change || '0'),
          parseFloat(row.daily_price_low || '0'),
          parseFloat(row.daily_price_high || '0'),
          row.symbol,
          now
        )
      );
    }

    if (upserts.length > 0) {
      await env.DB.batch(upserts);
      console.log(`[Cron] Updated ${upserts.length} normalized token entries`);
    } else {
      console.log('[Cron] No updates needed');
    }
  } catch (error) {
    console.error('[Cron] Failed to update normalized_tokens:', error);
  }
}

// Aggregate old market_stats data (>7 days) into market_history table
async function aggregateOldMarketData(env: Env): Promise<void> {
  try {
    console.log('[Cron] Starting market_stats aggregation for data older than 7 days');

    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
    const now = Math.floor(Date.now() / 1000);

    // Get the oldest timestamp in market_stats that needs aggregation
    const oldestQuery = await env.DB.prepare(
      'SELECT MIN(created_at) as oldest FROM market_stats WHERE created_at < ?'
    ).bind(sevenDaysAgo).first<{ oldest: number }>();

    if (!oldestQuery || !oldestQuery.oldest) {
      console.log('[Cron] No old data to aggregate');
      return;
    }

    const oldestTimestamp = oldestQuery.oldest;
    console.log(`[Cron] Aggregating data from ${new Date(oldestTimestamp * 1000).toISOString()}`);

    // Aggregate data hour by hour
    // Round to hour: hour_timestamp = (created_at / 3600) * 3600
    const aggregationQuery = `
      INSERT OR REPLACE INTO market_history (
        exchange, symbol, normalized_symbol,
        avg_mark_price, avg_index_price, min_price, max_price, price_volatility,
        volume_base, volume_quote,
        avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
        avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
        hour_timestamp, sample_count, aggregated_at
      )
      SELECT
        exchange,
        symbol,
        UPPER(
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol,
            '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')
        ) as normalized_symbol,
        -- Prices
        AVG(CAST(mark_price AS REAL)) as avg_mark_price,
        AVG(CAST(index_price AS REAL)) as avg_index_price,
        MIN(CAST(mark_price AS REAL)) as min_price,
        MAX(CAST(mark_price AS REAL)) as max_price,
        -- Volatility: (max - min) / avg * 100
        CASE
          WHEN AVG(CAST(mark_price AS REAL)) > 0
          THEN ((MAX(CAST(mark_price AS REAL)) - MIN(CAST(mark_price AS REAL))) / AVG(CAST(mark_price AS REAL)) * 100)
          ELSE 0
        END as price_volatility,
        -- Volume (sum)
        SUM(daily_base_token_volume) as volume_base,
        SUM(daily_quote_token_volume) as volume_quote,
        -- Open Interest
        AVG(CAST(open_interest AS REAL)) as avg_open_interest,
        AVG(CAST(open_interest_usd AS REAL)) as avg_open_interest_usd,
        MAX(CAST(open_interest_usd AS REAL)) as max_open_interest_usd,
        -- Funding Rate
        AVG(CAST(funding_rate AS REAL)) as avg_funding_rate,
        CASE
          WHEN exchange = 'lighter'
          THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365
          ELSE AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
        END as avg_funding_rate_annual,
        MIN(CAST(funding_rate AS REAL)) as min_funding_rate,
        MAX(CAST(funding_rate AS REAL)) as max_funding_rate,
        -- Timestamp rounded to hour
        (created_at / 3600) * 3600 as hour_timestamp,
        COUNT(*) as sample_count,
        ? as aggregated_at
      FROM market_stats
      WHERE created_at < ?
      GROUP BY exchange, symbol, hour_timestamp
    `;

    const result = await env.DB.prepare(aggregationQuery)
      .bind(now, sevenDaysAgo)
      .run();

    console.log(`[Cron] Aggregated ${result.meta.changes} hourly records into market_history`);

    // Now delete the old data from market_stats
    const deleteResult = await env.DB.prepare(
      'DELETE FROM market_stats WHERE created_at < ?'
    ).bind(sevenDaysAgo).run();

    console.log(`[Cron] Deleted ${deleteResult.meta.changes} old records from market_stats`);
    console.log('[Cron] Market data aggregation completed successfully');

  } catch (error) {
    console.error('[Cron] Failed to aggregate market data:', error);
  }
}

// Get all available tokens (normalized)
async function getAvailableTokens(
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Query from the optimized normalized_tokens table
    const query = `
      SELECT
        symbol,
        exchange,
        original_symbol
      FROM normalized_tokens
      ORDER BY symbol, exchange
    `;

    const result = await env.DB.prepare(query).all();

    if (!result.success || !result.results) {
      throw new Error('Database query failed');
    }

    // Group by normalized symbol
    const tokenMap = new Map<string, {
      normalized: string;
      exchanges: string[];
      original_symbols: { exchange: string; symbol: string }[];
    }>();

    for (const row of result.results as any[]) {
      if (!tokenMap.has(row.symbol)) {
        tokenMap.set(row.symbol, {
          normalized: row.symbol,
          exchanges: [],
          original_symbols: [],
        });
      }

      const tokenData = tokenMap.get(row.symbol)!;
      tokenData.exchanges.push(row.exchange);
      tokenData.original_symbols.push({
        exchange: row.exchange,
        symbol: row.original_symbol,
      });
    }

    // Convert map to array and sort by number of exchanges (descending)
    const tokens = Array.from(tokenMap.values())
      .map(token => ({
        token: token.normalized,
        exchanges_count: token.exchanges.length,
        exchanges: token.exchanges.sort(),
        original_symbols: token.original_symbols.sort((a, b) =>
          a.exchange.localeCompare(b.exchange)
        ),
      }))
      .sort((a, b) => {
        // Sort by exchange count (descending), then alphabetically
        if (b.exchanges_count !== a.exchanges_count) {
          return b.exchanges_count - a.exchanges_count;
        }
        return a.token.localeCompare(b.token);
      });

    return Response.json(
      {
        success: true,
        data: {
          total_tokens: tokens.length,
          tokens,
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in getAvailableTokens:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get available tokens',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get all markets from normalized_tokens table
async function getAllMarkets(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Optional filters
    const exchange = url.searchParams.get('exchange');
    const symbol = url.searchParams.get('symbol');
    const limit = parseInt(url.searchParams.get('limit') || '1000');

    // Build query with optional filters
    let query = `
      SELECT
        symbol,
        exchange,
        original_symbol,
        mark_price,
        index_price,
        open_interest_usd,
        volume_24h,
        funding_rate,
        funding_rate_annual,
        next_funding_time,
        price_change_24h,
        price_low_24h,
        price_high_24h,
        datetime(updated_at, 'unixepoch') as timestamp
      FROM normalized_tokens
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    if (exchange) {
      conditions.push('exchange = ?');
      params.push(exchange);
    }

    if (symbol) {
      conditions.push('symbol = ?');
      params.push(symbol.toUpperCase());
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY symbol, exchange LIMIT ?';
    params.push(limit);

    const result = await env.DB.prepare(query).bind(...params).all();

    if (!result.success || !result.results) {
      throw new Error('Database query failed');
    }

    // Map results
    const markets = result.results.map((row: any) => ({
      symbol: row.symbol,
      exchange: row.exchange,
      original_symbol: row.original_symbol,
      mark_price: row.mark_price || 0,
      index_price: row.index_price || 0,
      open_interest_usd: row.open_interest_usd || 0,
      volume_24h: row.volume_24h || 0,
      funding_rate: row.funding_rate || 0,
      funding_rate_annual: row.funding_rate_annual || 0,
      next_funding_time: row.next_funding_time || null,
      price_change_24h: row.price_change_24h || 0,
      price_low_24h: row.price_low_24h || 0,
      price_high_24h: row.price_high_24h || 0,
      timestamp: row.timestamp,
    }));

    return Response.json(
      {
        success: true,
        data: markets,
        meta: {
          count: markets.length,
          filters: {
            exchange: exchange || 'all',
            symbol: symbol || 'all',
          },
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in getAllMarkets:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get markets',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get historical funding rate data
async function getFundingRateHistory(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Required parameters
    const symbol = url.searchParams.get('symbol')?.toUpperCase();

    if (!symbol) {
      return Response.json(
        {
          success: false,
          error: 'Missing required parameter: symbol',
        } as ApiResponse,
        { status: 400, headers: corsHeaders }
      );
    }

    // Optional parameters
    const exchange = url.searchParams.get('exchange');
    const from = url.searchParams.get('from'); // Timestamp in milliseconds
    const to = url.searchParams.get('to'); // Timestamp in milliseconds
    const interval = url.searchParams.get('interval') || '1h'; // 1h, 4h, 1d
    const limit = parseInt(url.searchParams.get('limit') || '1000');

    // Build query for funding_rate_history (imported historical data)
    let query1 = `
      SELECT
        exchange,
        symbol,
        trading_pair,
        funding_rate,
        funding_rate_percent,
        annualized_rate,
        collected_at,
        datetime(collected_at/1000, 'unixepoch') as timestamp
      FROM funding_rate_history
      WHERE symbol = ?
    `;

    const params1: any[] = [symbol];

    if (exchange) {
      query1 += ' AND exchange = ?';
      params1.push(exchange);
    }

    if (from) {
      query1 += ' AND collected_at >= ?';
      params1.push(parseInt(from));
    }

    if (to) {
      query1 += ' AND collected_at <= ?';
      params1.push(parseInt(to));
    }

    query1 += ' ORDER BY collected_at ASC LIMIT ?';
    params1.push(Math.min(limit, 10000)); // Max 10k records

    // Build query for market_history (aggregated data from market_stats)
    let query2 = `
      SELECT
        exchange,
        normalized_symbol as symbol,
        normalized_symbol as trading_pair,
        avg_funding_rate as funding_rate,
        avg_funding_rate * 100 as funding_rate_percent,
        avg_funding_rate_annual as annualized_rate,
        hour_timestamp * 1000 as collected_at,
        datetime(hour_timestamp, 'unixepoch') as timestamp
      FROM market_history
      WHERE normalized_symbol = ?
    `;

    const params2: any[] = [symbol];

    if (exchange) {
      query2 += ' AND exchange = ?';
      params2.push(exchange);
    }

    if (from) {
      // Convert milliseconds to seconds for market_history
      query2 += ' AND hour_timestamp >= ?';
      params2.push(Math.floor(parseInt(from) / 1000));
    }

    if (to) {
      query2 += ' AND hour_timestamp <= ?';
      params2.push(Math.floor(parseInt(to) / 1000));
    }

    query2 += ' ORDER BY hour_timestamp ASC LIMIT ?';
    params2.push(Math.min(limit, 10000));

    // Execute both queries in parallel
    const [result1, result2] = await Promise.all([
      env.DB.prepare(query1).bind(...params1).all(),
      env.DB.prepare(query2).bind(...params2).all()
    ]);

    if (!result1.success || !result2.success) {
      throw new Error('Database query failed');
    }

    // Combine and deduplicate results from both sources
    const allResults = [
      ...(result1.results || []),
      ...(result2.results || [])
    ];

    // Sort by collected_at and remove duplicates (prefer funding_rate_history over market_history)
    const seenTimestamps = new Set<string>();
    const history = allResults
      .sort((a: any, b: any) => a.collected_at - b.collected_at)
      .filter((row: any) => {
        const key = `${row.exchange}-${row.symbol}-${row.collected_at}`;
        if (seenTimestamps.has(key)) {
          return false;
        }
        seenTimestamps.add(key);
        return true;
      })
      .slice(0, Math.min(limit, 10000))
      .map((row: any) => ({
        exchange: row.exchange,
        symbol: row.symbol,
        trading_pair: row.trading_pair,
        funding_rate: row.funding_rate,
        funding_rate_percent: row.funding_rate_percent,
        annualized_rate: row.annualized_rate,
        collected_at: row.collected_at,
        timestamp: row.timestamp,
      }));

    // Calculate statistics
    const stats = {
      count: history.length,
      avg_rate: history.length > 0
        ? history.reduce((sum, h) => sum + h.annualized_rate, 0) / history.length
        : 0,
      min_rate: history.length > 0
        ? Math.min(...history.map(h => h.annualized_rate))
        : 0,
      max_rate: history.length > 0
        ? Math.max(...history.map(h => h.annualized_rate))
        : 0,
      time_range: history.length > 0 ? {
        from: history[0].timestamp,
        to: history[history.length - 1].timestamp,
      } : null,
    };

    return Response.json(
      {
        success: true,
        data: history,
        stats,
        meta: {
          symbol,
          exchange: exchange || 'all',
          interval,
          limit,
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in getFundingRateHistory:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get funding rate history',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get historical market data (aggregated hourly data older than 7 days)
async function getMarketHistory(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const symbol = url.searchParams.get('symbol')?.toUpperCase();
    const exchange = url.searchParams.get('exchange');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = parseInt(url.searchParams.get('limit') || '1000');
    const metric = url.searchParams.get('metric') || 'all'; // all, price, volume, oi, funding

    // Build query
    let query = `
      SELECT
        exchange, symbol, normalized_symbol,
        avg_mark_price, avg_index_price, min_price, max_price, price_volatility,
        volume_base, volume_quote,
        avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
        avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
        hour_timestamp, sample_count,
        datetime(hour_timestamp, 'unixepoch') as timestamp
      FROM market_history
      WHERE 1=1
    `;

    const params: any[] = [];

    if (symbol) {
      query += ' AND normalized_symbol = ?';
      params.push(symbol);
    }

    if (exchange) {
      query += ' AND exchange = ?';
      params.push(exchange);
    }

    if (from) {
      query += ' AND hour_timestamp >= ?';
      params.push(parseInt(from));
    }

    if (to) {
      query += ' AND hour_timestamp <= ?';
      params.push(parseInt(to));
    }

    query += ' ORDER BY hour_timestamp DESC LIMIT ?';
    params.push(Math.min(limit, 10000));

    const result = await env.DB.prepare(query).bind(...params).all();

    if (!result.success || !result.results) {
      throw new Error('Database query failed');
    }

    const history = result.results as any[];

    // Calculate statistics
    let stats: any = {
      count: history.length,
    };

    if (history.length > 0) {
      // Price statistics
      if (metric === 'all' || metric === 'price') {
        const prices = history.map(h => h.avg_mark_price).filter(p => p > 0);
        if (prices.length > 0) {
          stats.price = {
            avg: prices.reduce((a, b) => a + b, 0) / prices.length,
            min: Math.min(...prices),
            max: Math.max(...prices),
            avg_volatility: history.map(h => h.price_volatility || 0).reduce((a, b) => a + b, 0) / history.length,
          };
        }
      }

      // Volume statistics
      if (metric === 'all' || metric === 'volume') {
        const volumes = history.map(h => h.volume_quote || 0);
        if (volumes.length > 0) {
          stats.volume = {
            total_usd: volumes.reduce((a, b) => a + b, 0),
            avg_hourly_usd: volumes.reduce((a, b) => a + b, 0) / volumes.length,
            max_hourly_usd: Math.max(...volumes),
          };
        }
      }

      // Open Interest statistics
      if (metric === 'all' || metric === 'oi') {
        const ois = history.map(h => h.avg_open_interest_usd || 0).filter(oi => oi > 0);
        if (ois.length > 0) {
          stats.open_interest = {
            avg_usd: ois.reduce((a, b) => a + b, 0) / ois.length,
            min_usd: Math.min(...ois),
            max_usd: Math.max(...ois),
          };
        }
      }

      // Funding Rate statistics
      if (metric === 'all' || metric === 'funding') {
        const rates = history.map(h => h.avg_funding_rate_annual || 0);
        if (rates.length > 0) {
          stats.funding_rate = {
            avg_apr: rates.reduce((a, b) => a + b, 0) / rates.length,
            min_apr: Math.min(...rates),
            max_apr: Math.max(...rates),
          };
        }
      }

      stats.time_range = {
        from: history[history.length - 1].timestamp,
        to: history[0].timestamp,
      };
    }

    return Response.json(
      {
        success: true,
        data: history,
        stats,
        meta: {
          symbol: symbol || 'all',
          exchange: exchange || 'all',
          metric,
          limit: Math.min(limit, 10000),
          interval: '1h',
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in getMarketHistory:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get market history',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get real-time volatility from market_stats (last 7 days)
async function getVolatility(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const symbol = url.searchParams.get('symbol');
    const exchange = url.searchParams.get('exchange');
    const interval = url.searchParams.get('interval') || '1h'; // 1h, 4h, 1d
    const limit = parseInt(url.searchParams.get('limit') || '24');

    // Calculate interval in seconds
    const intervalSeconds: { [key: string]: number } = {
      '15m': 15 * 60,
      '1h': 60 * 60,
      '4h': 4 * 60 * 60,
      '1d': 24 * 60 * 60,
    };

    const intervalSec = intervalSeconds[interval] || 3600;
    const now = Math.floor(Date.now() / 1000);

    // Build query to get data grouped by time intervals
    let query = `
      WITH time_buckets AS (
        SELECT
          exchange,
          symbol,
          (created_at / ?) * ? as bucket_time,
          MIN(CAST(mark_price AS REAL)) as min_price,
          MAX(CAST(mark_price AS REAL)) as max_price,
          AVG(CAST(mark_price AS REAL)) as avg_price,
          COUNT(*) as sample_count
        FROM market_stats
        WHERE created_at > ?
    `;

    const params: any[] = [intervalSec, intervalSec, now - (7 * 24 * 60 * 60)];

    if (symbol) {
      query += ' AND symbol = ?';
      params.push(symbol);
    }

    if (exchange) {
      query += ' AND exchange = ?';
      params.push(exchange);
    }

    query += `
        GROUP BY exchange, symbol, bucket_time
        ORDER BY bucket_time DESC
        LIMIT ?
      )
      SELECT
        exchange,
        symbol,
        bucket_time,
        min_price,
        max_price,
        avg_price,
        sample_count,
        CASE
          WHEN avg_price > 0
          THEN ((max_price - min_price) / avg_price * 100)
          ELSE 0
        END as volatility,
        datetime(bucket_time, 'unixepoch') as timestamp
      FROM time_buckets
      ORDER BY bucket_time DESC
    `;

    params.push(Math.min(limit, 1000));

    const result = await env.DB.prepare(query).bind(...params).all();

    if (!result.success || !result.results) {
      throw new Error('Database query failed');
    }

    const volatilityData = result.results as any[];

    // Calculate statistics
    const stats: any = {
      count: volatilityData.length,
    };

    if (volatilityData.length > 0) {
      const volatilities = volatilityData.map(d => d.volatility);

      stats.volatility = {
        avg: volatilities.reduce((a, b) => a + b, 0) / volatilities.length,
        min: Math.min(...volatilities),
        max: Math.max(...volatilities),
        current: volatilities[0], // Most recent
      };

      stats.price = {
        current: volatilityData[0].avg_price,
        min: Math.min(...volatilityData.map(d => d.min_price)),
        max: Math.max(...volatilityData.map(d => d.max_price)),
      };

      stats.time_range = {
        from: volatilityData[volatilityData.length - 1].timestamp,
        to: volatilityData[0].timestamp,
      };
    }

    return Response.json(
      {
        success: true,
        data: volatilityData,
        stats,
        meta: {
          symbol: symbol || 'all',
          exchange: exchange || 'all',
          interval,
          limit: Math.min(limit, 1000),
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in getVolatility:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get volatility',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get normalized data with flexible time range and aggregation
async function getNormalizedData(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const symbol = url.searchParams.get('symbol')?.toUpperCase();
    const exchange = url.searchParams.get('exchange');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '168'), 10000); // Default: 168 hours = 7 days
    const interval = url.searchParams.get('interval') || '1h'; // Default: hourly aggregation

    if (!symbol) {
      return Response.json(
        {
          success: false,
          error: 'Missing required parameter: symbol',
        } as ApiResponse,
        { status: 400, headers: corsHeaders }
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = nowSeconds - (7 * 24 * 60 * 60);

    let fromTimestamp: number;
    let toTimestamp: number;

    // Parse timestamps (accept both seconds and milliseconds)
    if (from) {
      fromTimestamp = from.length > 10 ? Math.floor(parseInt(from) / 1000) : parseInt(from);
    } else {
      fromTimestamp = sevenDaysAgo;
    }

    if (to) {
      toTimestamp = to.length > 10 ? Math.floor(parseInt(to) / 1000) : parseInt(to);
    } else {
      toTimestamp = nowSeconds;
    }

    // Determine data source based on time range
    const needsHistoricalData = fromTimestamp < sevenDaysAgo;
    const needsRecentData = toTimestamp > sevenDaysAgo;

    let allData: any[] = [];

    // Query 1: Historical aggregated data (market_history) for data >= 7 days old
    if (needsHistoricalData) {
      let historyQuery = `
        SELECT
          exchange,
          symbol as original_symbol,
          normalized_symbol,
          avg_mark_price as mark_price,
          avg_index_price as index_price,
          min_price,
          max_price,
          price_volatility as volatility,
          volume_base,
          volume_quote,
          avg_open_interest as open_interest,
          avg_open_interest_usd as open_interest_usd,
          max_open_interest_usd,
          avg_funding_rate as funding_rate,
          avg_funding_rate_annual as funding_rate_annual,
          min_funding_rate,
          max_funding_rate,
          hour_timestamp as timestamp,
          sample_count,
          datetime(hour_timestamp, 'unixepoch') as timestamp_iso
        FROM market_history
        WHERE normalized_symbol = ?
      `;

      const historyParams: any[] = [symbol];

      if (exchange) {
        historyQuery += ` AND exchange = ?`;
        historyParams.push(exchange);
      }

      historyQuery += ` AND hour_timestamp >= ? AND hour_timestamp <= ?`;
      historyParams.push(fromTimestamp, Math.min(toTimestamp, sevenDaysAgo));

      historyQuery += ` ORDER BY hour_timestamp DESC LIMIT ?`;
      historyParams.push(limit);

      const historyResult = await env.DB.prepare(historyQuery).bind(...historyParams).all();

      if (historyResult.success && historyResult.results) {
        allData = allData.concat(
          historyResult.results.map((row: any) => ({
            ...row,
            data_source: 'aggregated',
            interval: '1h',
          }))
        );
      }
    }

    // Query 2: Recent raw data (market_stats) for data < 7 days old
    if (needsRecentData && interval === 'raw') {
      let statsQuery = `
        SELECT
          exchange,
          symbol as original_symbol,
          UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol, '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')) as normalized_symbol,
          CAST(mark_price AS REAL) as mark_price,
          CAST(index_price AS REAL) as index_price,
          CAST(mark_price AS REAL) as min_price,
          CAST(mark_price AS REAL) as max_price,
          0 as volatility,
          daily_base_token_volume as volume_base,
          daily_quote_token_volume as volume_quote,
          CAST(open_interest AS REAL) as open_interest,
          CAST(open_interest AS REAL) * CAST(mark_price AS REAL) as open_interest_usd,
          CAST(funding_rate AS REAL) as funding_rate,
          CAST(funding_rate AS REAL) * 100 * 3 * 365 as funding_rate_annual,
          created_at as timestamp,
          1 as sample_count,
          datetime(created_at, 'unixepoch') as timestamp_iso
        FROM market_stats
        WHERE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol, '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')) = ?
      `;

      const statsParams: any[] = [symbol];

      if (exchange) {
        statsQuery += ` AND exchange = ?`;
        statsParams.push(exchange);
      }

      statsQuery += ` AND created_at >= ? AND created_at <= ?`;
      statsParams.push(Math.max(fromTimestamp, sevenDaysAgo), toTimestamp);

      statsQuery += ` ORDER BY created_at DESC LIMIT ?`;
      statsParams.push(limit);

      const statsResult = await env.DB.prepare(statsQuery).bind(...statsParams).all();

      if (statsResult.success && statsResult.results) {
        allData = allData.concat(
          statsResult.results.map((row: any) => ({
            ...row,
            data_source: 'raw',
            interval: '15s',
          }))
        );
      }
    }

    // Query 3: Recent aggregated data (calculated from market_stats) for intervals
    if (needsRecentData && interval !== 'raw' && interval !== 'auto') {
      const intervalSeconds: { [key: string]: number } = {
        '15m': 15 * 60,
        '1h': 60 * 60,
        '4h': 4 * 60 * 60,
        '1d': 24 * 60 * 60,
      };

      const bucketSize = intervalSeconds[interval];
      if (!bucketSize) {
        return Response.json(
          {
            success: false,
            error: 'Invalid interval. Use: raw, 15m, 1h, 4h, 1d',
          } as ApiResponse,
          { status: 400, headers: corsHeaders }
        );
      }

      let aggregatedQuery = `
        WITH time_buckets AS (
          SELECT
            exchange,
            symbol as original_symbol,
            UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol, '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')) as normalized_symbol,
            (created_at / ?) * ? as bucket_time,
            MIN(CAST(mark_price AS REAL)) as min_price,
            MAX(CAST(mark_price AS REAL)) as max_price,
            AVG(CAST(mark_price AS REAL)) as mark_price,
            AVG(CAST(index_price AS REAL)) as index_price,
            SUM(daily_base_token_volume) as volume_base,
            SUM(daily_quote_token_volume) as volume_quote,
            AVG(CAST(open_interest AS REAL)) as open_interest,
            AVG(CAST(open_interest AS REAL) * CAST(mark_price AS REAL)) as open_interest_usd,
            MAX(CAST(open_interest AS REAL) * CAST(mark_price AS REAL)) as max_open_interest_usd,
            AVG(CAST(funding_rate AS REAL)) as funding_rate,
            AVG(CAST(funding_rate AS REAL) * 100 * 3 * 365) as funding_rate_annual,
            MIN(CAST(funding_rate AS REAL)) as min_funding_rate,
            MAX(CAST(funding_rate AS REAL)) as max_funding_rate,
            COUNT(*) as sample_count
          FROM market_stats
          WHERE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol, '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')) = ?
      `;

      const aggregatedParams: any[] = [bucketSize, bucketSize, symbol];

      if (exchange) {
        aggregatedQuery += ` AND exchange = ?`;
        aggregatedParams.push(exchange);
      }

      aggregatedQuery += ` AND created_at >= ? AND created_at <= ?`;
      aggregatedParams.push(Math.max(fromTimestamp, sevenDaysAgo), toTimestamp);

      aggregatedQuery += `
          GROUP BY exchange, original_symbol, normalized_symbol, bucket_time
        )
        SELECT *,
          CASE
            WHEN mark_price > 0
            THEN ((max_price - min_price) / mark_price * 100)
            ELSE 0
          END as volatility,
          bucket_time as timestamp,
          datetime(bucket_time, 'unixepoch') as timestamp_iso
        FROM time_buckets
        ORDER BY bucket_time DESC
        LIMIT ?
      `;

      aggregatedParams.push(limit);

      const aggregatedResult = await env.DB.prepare(aggregatedQuery).bind(...aggregatedParams).all();

      if (aggregatedResult.success && aggregatedResult.results) {
        allData = allData.concat(
          aggregatedResult.results.map((row: any) => ({
            ...row,
            data_source: 'calculated',
            interval: interval,
          }))
        );
      }
    }

    // Auto mode: choose best data source
    if (interval === 'auto') {
      const timeRangeDays = (toTimestamp - fromTimestamp) / (24 * 60 * 60);

      if (timeRangeDays <= 1) {
        // For 1 day or less, use raw data
        return await getNormalizedData(env, new URL(url.toString().replace('interval=auto', 'interval=raw')), corsHeaders);
      } else if (timeRangeDays <= 7) {
        // For 1-7 days, use 1h aggregation
        return await getNormalizedData(env, new URL(url.toString().replace('interval=auto', 'interval=1h')), corsHeaders);
      } else {
        // For > 7 days, combine historical (1h) and recent (1h)
        return await getNormalizedData(env, new URL(url.toString().replace('interval=auto', 'interval=1h')), corsHeaders);
      }
    }

    // Sort all data by timestamp (descending)
    allData.sort((a, b) => b.timestamp - a.timestamp);

    // Limit results
    if (allData.length > limit) {
      allData = allData.slice(0, limit);
    }

    if (allData.length === 0) {
      return Response.json(
        {
          success: false,
          error: `No data found for symbol "${symbol}" in the specified time range`,
        } as ApiResponse,
        { status: 404, headers: corsHeaders }
      );
    }

    // Calculate statistics
    const prices = allData.map(d => d.mark_price).filter(p => p > 0);
    const volatilities = allData.map(d => d.volatility).filter(v => v !== null && v !== undefined);
    const fundingRates = allData.map(d => d.funding_rate_annual).filter(r => r !== null && r !== undefined);
    const openInterests = allData.map(d => d.open_interest_usd).filter(oi => oi > 0);

    const stats = {
      count: allData.length,
      price: {
        current: prices[0] || 0,
        avg: prices.reduce((sum, p) => sum + p, 0) / prices.length || 0,
        min: Math.min(...prices) || 0,
        max: Math.max(...prices) || 0,
      },
      volatility: volatilities.length > 0 ? {
        current: volatilities[0] || 0,
        avg: volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length || 0,
        min: Math.min(...volatilities) || 0,
        max: Math.max(...volatilities) || 0,
      } : null,
      funding_rate: fundingRates.length > 0 ? {
        current_apr: fundingRates[0] || 0,
        avg_apr: fundingRates.reduce((sum, r) => sum + r, 0) / fundingRates.length || 0,
        min_apr: Math.min(...fundingRates) || 0,
        max_apr: Math.max(...fundingRates) || 0,
      } : null,
      open_interest: openInterests.length > 0 ? {
        current_usd: openInterests[0] || 0,
        avg_usd: openInterests.reduce((sum, oi) => sum + oi, 0) / openInterests.length || 0,
        min_usd: Math.min(...openInterests) || 0,
        max_usd: Math.max(...openInterests) || 0,
      } : null,
      time_range: {
        from: allData[allData.length - 1]?.timestamp_iso || null,
        to: allData[0]?.timestamp_iso || null,
        from_timestamp: allData[allData.length - 1]?.timestamp || null,
        to_timestamp: allData[0]?.timestamp || null,
      },
    };

    return Response.json(
      {
        success: true,
        data: allData,
        stats,
        meta: {
          symbol,
          exchange: exchange || 'all',
          interval: interval,
          limit,
          data_sources: [...new Set(allData.map(d => d.data_source))],
        },
      } as ApiResponse,
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in getNormalizedData:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get normalized data',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Compare a token across all exchanges
async function compareTokenAcrossExchanges(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const token = url.searchParams.get('token')?.toUpperCase();

    if (!token) {
      return Response.json(
        {
          success: false,
          error: 'Missing required parameter: token',
        } as ApiResponse,
        { status: 400, headers: corsHeaders }
      );
    }

    // Query from optimized normalized_tokens table
    const query = `
      SELECT
        symbol,
        exchange,
        original_symbol,
        mark_price,
        index_price,
        open_interest_usd,
        volume_24h,
        funding_rate,
        funding_rate_annual,
        next_funding_time,
        price_change_24h,
        price_low_24h,
        price_high_24h,
        datetime(updated_at, 'unixepoch') as timestamp
      FROM normalized_tokens
      WHERE symbol = ?
      ORDER BY exchange
    `;

    const result = await env.DB.prepare(query).bind(token).all();

    if (!result.success || !result.results) {
      throw new Error('Database query failed');
    }

    // Map results directly (already normalized)
    const matchingData: any[] = [];
    for (const row of result.results as any[]) {
      matchingData.push({
        exchange: row.exchange,
        original_symbol: row.original_symbol,
        normalized_symbol: row.symbol,
        mark_price: row.mark_price || 0,
        index_price: row.index_price || 0,
        open_interest: 0, // Not stored in normalized_tokens
        open_interest_usd: row.open_interest_usd || 0,
        funding_rate: row.funding_rate || 0,
        funding_rate_annual: row.funding_rate_annual || 0,
        next_funding_time: row.next_funding_time || null,
        volume_24h: row.volume_24h || 0,
        price_low_24h: row.price_low_24h || 0,
        price_high_24h: row.price_high_24h || 0,
        price_change_24h: row.price_change_24h || 0,
        timestamp: row.timestamp,
      });
    }

    if (matchingData.length === 0) {
      return Response.json(
        {
          success: false,
          error: `Token "${token}" not found on any exchange`,
        } as ApiResponse,
        { status: 404, headers: corsHeaders }
      );
    }

    // Calculate aggregated statistics
    const totalOI = matchingData.reduce((sum, d) => sum + d.open_interest_usd, 0);
    const avgFundingRate = matchingData.reduce((sum, d) => sum + d.funding_rate, 0) / matchingData.length;
    const prices = matchingData.map(d => d.mark_price).filter(p => p > 0);
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    return Response.json(
      {
        success: true,
        data: {
          token,
          exchanges_count: matchingData.length,
          exchanges: matchingData,
          aggregated: {
            total_open_interest_usd: totalOI,
            avg_price: avgPrice,
            min_price: minPrice,
            max_price: maxPrice,
            price_spread_pct: ((maxPrice - minPrice) / avgPrice) * 100,
            avg_funding_rate: avgFundingRate,
            avg_funding_rate_annual_pct: avgFundingRate * 3 * 365 * 100,
          },
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in compareTokenAcrossExchanges:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to compare token',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get market statistics with filters
async function getMarketStats(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const exchange = url.searchParams.get('exchange') || 'lighter';
    const symbol = url.searchParams.get('symbol');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = parseInt(url.searchParams.get('limit') || '100');

    let query = 'SELECT * FROM market_stats WHERE exchange = ?';
    const params: any[] = [exchange];

    if (symbol) {
      query += ' AND symbol = ?';
      params.push(symbol);
    }

    if (from) {
      query += ' AND recorded_at >= ?';
      params.push(parseInt(from));
    }

    if (to) {
      query += ' AND recorded_at <= ?';
      params.push(parseInt(to));
    }

    query += ' ORDER BY recorded_at DESC LIMIT ?';
    params.push(limit);

    const result = await env.DB.prepare(query).bind(...params).all<MarketStatsRecord>();

    return Response.json(
      {
        success: true,
        data: result.results,
        meta: {
          count: result.results?.length || 0,
          query: { exchange, symbol, from, to, limit },
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch stats',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get latest statistics for each symbol
async function getLatestStats(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const exchange = url.searchParams.get('exchange') || 'lighter';
    const symbol = url.searchParams.get('symbol');

    let query = `
      SELECT *
      FROM market_stats
      WHERE exchange = ?
      ${symbol ? 'AND symbol = ?' : ''}
      AND id IN (
        SELECT MAX(id)
        FROM market_stats
        WHERE exchange = ?
        ${symbol ? 'AND symbol = ?' : ''}
        GROUP BY symbol
      )
      ORDER BY symbol
    `;

    const params = symbol
      ? [exchange, symbol, exchange, symbol]
      : [exchange, exchange];

    const result = await env.DB.prepare(query).bind(...params).all<MarketStatsRecord>();

    return Response.json(
      {
        success: true,
        data: result.results,
        meta: {
          count: result.results?.length || 0,
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch latest stats',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get tracker status from database
async function getTrackerStatus(
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM tracker_status ORDER BY exchange'
    ).all();

    return Response.json(
      {
        success: true,
        data: result.results,
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch tracker status',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get live status from all trackers
async function getAllTrackersStatus(
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const trackers = [
      { name: 'lighter', namespace: env.LIGHTER_TRACKER, id: 'lighter-main' },
      { name: 'paradex', namespace: env.PARADEX_TRACKER, id: 'paradex-main' },
      { name: 'hyperliquid', namespace: env.HYPERLIQUID_TRACKER, id: 'hyperliquid-main' },
      { name: 'edgex', namespace: env.EDGEX_TRACKER, id: 'edgex-main' },
      { name: 'aster', namespace: env.ASTER_TRACKER, id: 'aster-main' },
      { name: 'pacifica', namespace: env.PACIFICA_TRACKER, id: 'pacifica-main' },
      { name: 'extended', namespace: env.EXTENDED_TRACKER, id: 'extended-main' },
    ];

    const statusPromises = trackers.map(async (tracker) => {
      try {
        const id = tracker.namespace.idFromName(tracker.id);
        const stub = tracker.namespace.get(id);
        const response = await stub.fetch('https://internal/status');
        const data = await response.json() as any;

        return {
          exchange: tracker.name,
          ...data.data,
          success: data.success,
        };
      } catch (error) {
        return {
          exchange: tracker.name,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch status',
        };
      }
    });

    const results = await Promise.all(statusPromises);

    return Response.json(
      {
        success: true,
        data: results,
        timestamp: new Date().toISOString(),
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch trackers status',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Root endpoint with API documentation
function handleRoot(corsHeaders: Record<string, string>): Response {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>DeFi API - Crypto Exchange Tracker</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    h1 { color: #333; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
    .endpoint { margin: 20px 0; padding: 15px; border-left: 3px solid #0066cc; background: #f9f9f9; }
    .method { display: inline-block; padding: 3px 8px; border-radius: 3px; font-weight: bold; margin-right: 10px; }
    .get { background: #61affe; color: white; }
    .post { background: #49cc90; color: white; }
  </style>
</head>
<body>
  <h1>🚀 DeFi API - Crypto Exchange Tracker</h1>
  <p>Echtzeit-Tracker für Crypto-Börsen mit Cloudflare Workers & Durable Objects</p>
  <p><strong>Unterstützte Börsen:</strong> Lighter (WebSocket), Paradex (WebSocket), Hyperliquid (API Polling), EdgeX (WebSocket), Aster (API Polling), Pacifica (WebSocket)</p>

  <h2>📊 Tracker Control</h2>
  <h3>Lighter Exchange</h3>
  <div class="endpoint">
    <span class="method post">POST</span><code>/tracker/lighter/start</code>
    <p>Startet die WebSocket-Verbindung zum Lighter Exchange</p>
  </div>
  <div class="endpoint">
    <span class="method post">POST</span><code>/tracker/lighter/stop</code>
    <p>Stoppt die WebSocket-Verbindung zu Lighter</p>
  </div>
  <div class="endpoint">
    <span class="method get">GET</span><code>/tracker/lighter/status</code>
    <p>Zeigt den aktuellen Status der Lighter WebSocket-Verbindung</p>
  </div>

  <h3>Paradex Exchange</h3>
  <div class="endpoint">
    <span class="method post">POST</span><code>/tracker/paradex/start</code>
    <p>Startet die WebSocket-Verbindung zum Paradex Exchange</p>
  </div>
  <div class="endpoint">
    <span class="method post">POST</span><code>/tracker/paradex/stop</code>
    <p>Stoppt die WebSocket-Verbindung zu Paradex</p>
  </div>
  <div class="endpoint">
    <span class="method get">GET</span><code>/tracker/paradex/status</code>
    <p>Zeigt den aktuellen Status der Paradex WebSocket-Verbindung</p>
  </div>

  <h3>Hyperliquid Exchange</h3>
  <div class="endpoint">
    <span class="method post">POST</span><code>/tracker/hyperliquid/start</code>
    <p>Startet das API-Polling für Hyperliquid (alle 15 Sekunden)</p>
  </div>
  <div class="endpoint">
    <span class="method post">POST</span><code>/tracker/hyperliquid/stop</code>
    <p>Stoppt das API-Polling für Hyperliquid</p>
  </div>
  <div class="endpoint">
    <span class="method get">GET</span><code>/tracker/hyperliquid/status</code>
    <p>Zeigt den aktuellen Status des Hyperliquid API-Pollings</p>
  </div>

  <h3>EdgeX Exchange</h3>
  <div class="endpoint">
    <span class="method post">POST</span><code>/tracker/edgex/start</code>
    <p>Startet die WebSocket-Verbindung zum EdgeX Exchange</p>
  </div>
  <div class="endpoint">
    <span class="method post">POST</span><code>/tracker/edgex/stop</code>
    <p>Stoppt die WebSocket-Verbindung zu EdgeX</p>
  </div>
  <div class="endpoint">
    <span class="method get">GET</span><code>/tracker/edgex/status</code>
    <p>Zeigt den aktuellen Status der EdgeX WebSocket-Verbindung</p>
  </div>

  <h2>📈 API Endpoints</h2>
  <div class="endpoint">
    <span class="method get">GET</span><code>/api/latest</code>
    <p>Neueste Market Stats für alle Symbole</p>
    <p><strong>Query-Parameter:</strong></p>
    <ul>
      <li><code>exchange</code> - Exchange-Name (default: lighter)</li>
      <li><code>symbol</code> - Symbol filtern (optional)</li>
    </ul>
  </div>
  <div class="endpoint">
    <span class="method get">GET</span><code>/api/stats</code>
    <p>Market Stats mit Filter-Optionen</p>
    <p><strong>Query-Parameter:</strong></p>
    <ul>
      <li><code>exchange</code> - Exchange-Name (default: lighter)</li>
      <li><code>symbol</code> - Symbol filtern (optional)</li>
      <li><code>from</code> - Start-Timestamp in ms (optional)</li>
      <li><code>to</code> - End-Timestamp in ms (optional)</li>
      <li><code>limit</code> - Max. Anzahl Ergebnisse (default: 100)</li>
    </ul>
  </div>
  <div class="endpoint">
    <span class="method get">GET</span><code>/api/status</code>
    <p>Tracker-Status aus der Datenbank</p>
  </div>

  <h2>💡 Beispiele</h2>
  <pre>
# Lighter Tracker starten
curl -X POST https://your-worker.workers.dev/tracker/lighter/start

# Paradex Tracker starten
curl -X POST https://your-worker.workers.dev/tracker/paradex/start

# Hyperliquid Tracker starten
curl -X POST https://your-worker.workers.dev/tracker/hyperliquid/start

# EdgeX Tracker starten
curl -X POST https://your-worker.workers.dev/tracker/edgex/start

# Neueste Stats von Lighter abrufen
curl https://your-worker.workers.dev/api/latest?exchange=lighter

# Neueste Stats von Paradex abrufen
curl https://your-worker.workers.dev/api/latest?exchange=paradex

# Neueste Stats von Hyperliquid abrufen
curl https://your-worker.workers.dev/api/latest?exchange=hyperliquid

# Neueste Stats von EdgeX abrufen
curl https://your-worker.workers.dev/api/latest?exchange=edgex

# Stats für bestimmtes Symbol abrufen
curl https://your-worker.workers.dev/api/stats?exchange=paradex&symbol=BTC-USD-PERP&limit=50

# Stats in Zeitraum abrufen
curl "https://your-worker.workers.dev/api/stats?exchange=lighter&from=1700000000000&to=1700100000000"
  </pre>

  <h2>🔧 Architektur</h2>
  <ul>
    <li><strong>Cloudflare Workers</strong> - API-Layer</li>
    <li><strong>Durable Objects</strong> - WebSocket-Verbindung & Daten-Buffering</li>
    <li><strong>D1 Database</strong> - Persistente Speicherung</li>
    <li><strong>15-Sekunden-Snapshots</strong> - Memory-effiziente Verarbeitung</li>
  </ul>
</body>
</html>
  `;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html',
      ...corsHeaders,
    },
  });
}
