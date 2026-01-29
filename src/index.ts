import { LighterTracker } from './LighterTracker';
import { ParadexTracker } from './ParadexTracker';
import { HyperliquidTracker } from './HyperliquidTracker';
import { EdgeXTracker } from './EdgeXTracker';
import { AsterTracker } from './AsterTracker';
import { PacificaTracker } from './PacificaTracker';
import { ExtendedTracker } from './ExtendedTracker';
import { HyENATracker } from './HyENATracker';
import { XYZTracker } from './XYZTracker';
import { FLXTracker } from './FLXTracker';
import { VNTLTracker } from './VNTLTracker';
import { KMTracker } from './KMTracker';
import { VariationalTracker } from './VariationalTracker';
import { Env, ApiResponse, MarketStatsQuery, MarketStatsRecord } from './types';
import { calculateAllVolatilityMetrics } from './volatility';
import { calculateAndCacheFundingMAs, getCachedFundingMAs } from './maCache';

export { LighterTracker, ParadexTracker, HyperliquidTracker, EdgeXTracker, AsterTracker, PacificaTracker, ExtendedTracker, HyENATracker, XYZTracker, FLXTracker, VNTLTracker, KMTracker, VariationalTracker };

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const cronType = event.cron || '*/5 * * * *'; // Default to 5-minute cron
    console.log(`[Cron] Scheduled event triggered: ${cronType} at ${new Date().toISOString()}`);

    // Every 5 minutes: Health check + normalized_tokens update + 1-minute aggregation + MA cache
    if (cronType === '*/5 * * * *') {
      try {
        console.log('[Cron] Running WebSocket health check');
        await checkTrackerHealth(env);

        console.log('[Cron] Updating normalized_tokens table');
        await updateNormalizedTokens(env);

        console.log('[Cron] Running 15s → 1m aggregation');
        await aggregateTo1Minute(env);

        console.log('[Cron] Calculating and caching moving averages');
        await calculateAndCacheFundingMAs(env);

        console.log('[Cron] 5-minute tasks completed successfully');
      } catch (error) {
        console.error('[Cron] Error in 5-minute tasks:', error);
      }
    }

    // Every hour: Aggregate 1m data to hourly and clean up
    if (cronType === '0 * * * *') {
      try {
        console.log('[Cron] Running 1m → 1h aggregation and cleanup');
        await aggregateTo1Hour(env);
        console.log('[Cron] Hourly aggregation completed successfully');

        // Calculate volatility metrics every hour
        console.log('[Cron] Calculating volatility metrics for all markets');
        await calculateAllVolatilityMetrics(env);
        console.log('[Cron] Volatility metrics calculation completed');
      } catch (error) {
        console.error('[Cron] Error in hourly aggregation:', error);
      }
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
      // Trackers auto-start themselves via their fetch() methods
      // No need to ping them on every request - removed ensureTrackersStarted()

      // Route requests
      if (path.startsWith('/tracker/')) {
        return await handleTrackerRoute(request, env, path, corsHeaders);
      } else if (path.startsWith('/api/')) {
        return await handleApiRoute(request, env, path, corsHeaders);
      } else if (path === '/debug/update-normalized-tokens') {
        // Debug endpoint to manually trigger normalized_tokens update
        console.log('[Debug] Manually triggering normalized_tokens update');
        await updateNormalizedTokens(env);
        return Response.json({ success: true, message: 'normalized_tokens update triggered' }, { headers: corsHeaders });
      } else if (path === '/debug/aggregate-1m') {
        // Debug endpoint to manually trigger 1-minute aggregation
        console.log('[Debug] Manually triggering 1-minute aggregation');
        await aggregateTo1Minute(env);
        return Response.json({ success: true, message: '1-minute aggregation triggered' }, { headers: corsHeaders });
      } else if (path === '/debug/aggregate-1h') {
        // Debug endpoint to manually trigger hourly aggregation
        console.log('[Debug] Manually triggering hourly aggregation');
        await aggregateTo1Hour(env);
        return Response.json({ success: true, message: 'Hourly aggregation triggered' }, { headers: corsHeaders });
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

// OPTIMIZATION: Removed ensureTrackersStarted() function
// Trackers auto-start themselves when their Durable Objects receive their first request
// This eliminates 7 unnecessary Durable Object calls on every API request
// Previous load: 7 DO calls × N requests/min = significant overhead
// New load: 0 DO calls for tracker initialization

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
  } else if (path.startsWith('/tracker/hyena/')) {
    exchange = 'hyena';
    doPath = path.replace('/tracker/hyena', '');
    const id = env.HYENA_TRACKER.idFromName('hyena-main');
    stub = env.HYENA_TRACKER.get(id);
  } else if (path.startsWith('/tracker/xyz/')) {
    exchange = 'xyz';
    doPath = path.replace('/tracker/xyz', '');
    const id = env.XYZ_TRACKER.idFromName('xyz-main');
    stub = env.XYZ_TRACKER.get(id);
  } else if (path.startsWith('/tracker/flx/')) {
    exchange = 'flx';
    doPath = path.replace('/tracker/flx', '');
    const id = env.FLX_TRACKER.idFromName('flx-main');
    stub = env.FLX_TRACKER.get(id);
  } else if (path.startsWith('/tracker/vntl/')) {
    exchange = 'vntl';
    doPath = path.replace('/tracker/vntl', '');
    const id = env.VNTL_TRACKER.idFromName('vntl-main');
    stub = env.VNTL_TRACKER.get(id);
  } else if (path.startsWith('/tracker/km/')) {
    exchange = 'km';
    doPath = path.replace('/tracker/km', '');
    const id = env.KM_TRACKER.idFromName('km-main');
    stub = env.KM_TRACKER.get(id);
  } else if (path.startsWith('/tracker/variational/')) {
    exchange = 'variational';
    doPath = path.replace('/tracker/variational', '');
    const id = env.VARIATIONAL_TRACKER.idFromName('variational-main');
    stub = env.VARIATIONAL_TRACKER.get(id);
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
    case '/api/funding/ma':
      return await getFundingMovingAverages(env, url, corsHeaders);
    case '/api/funding/ma/bulk':
      return await getBulkFundingMovingAverages(env, url, corsHeaders);
    case '/api/admin/cache-ma':
      // Temporary endpoint to manually trigger MA cache calculation
      // Query param: all=true to calculate all timeframes at once
      try {
        const calculateAll = url.searchParams.get('all') === 'true';
        if (calculateAll) {
          // Calculate all timeframes sequentially
          const { calculateAllTimeframes } = await import('./maCache');
          await calculateAllTimeframes(env);
          return Response.json({ success: true, message: 'All timeframes calculated' }, { headers: corsHeaders });
        } else {
          await calculateAndCacheFundingMAs(env);
          return Response.json({ success: true, message: 'MA cache calculation triggered' }, { headers: corsHeaders });
        }
      } catch (error) {
        return Response.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500, headers: corsHeaders });
      }
    case '/api/data/24h':
      return await getData24h(env, url, corsHeaders);
    case '/api/data/7d':
      return await getData7d(env, url, corsHeaders);
    case '/api/data/30d':
      return await getData30d(env, url, corsHeaders);
    case '/api/admin/aggregate-1m':
      // Manual 1-minute aggregation trigger (temporary for testing)
      try {
        await aggregateTo1Minute(env);
        return Response.json(
          { success: true, message: '15s → 1m aggregation completed' },
          { headers: corsHeaders }
        );
      } catch (error) {
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : 'Aggregation failed' },
          { status: 500, headers: corsHeaders }
        );
      }
    case '/api/admin/aggregate-1h':
      // Manual 1-hour aggregation trigger (temporary for testing)
      try {
        await aggregateTo1Hour(env);
        return Response.json(
          { success: true, message: '1m → 1h aggregation completed' },
          { headers: corsHeaders }
        );
      } catch (error) {
        return Response.json(
          { success: false, error: error instanceof Error ? error.message : 'Aggregation failed' },
          { status: 500, headers: corsHeaders }
        );
      }
    case '/api/admin/calculate-volatility':
      // Manual volatility calculation trigger
      try {
        console.log('[API] Starting volatility calculation');
        await calculateAllVolatilityMetrics(env);
        console.log('[API] Volatility calculation completed');
        return Response.json(
          { success: true, message: 'Volatility metrics calculated for all markets' },
          { headers: corsHeaders }
        );
      } catch (error) {
        console.error('[API] Volatility calculation error:', error);
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Volatility calculation failed',
            stack: error instanceof Error ? error.stack : undefined
          },
          { status: 500, headers: corsHeaders }
        );
      }
    case '/api/admin/calculate-volatility-for':
      // Calculate volatility for specific market
      try {
        const targetExchange = url.searchParams.get('exchange');
        const targetSymbol = url.searchParams.get('symbol');

        if (!targetExchange || !targetSymbol) {
          return Response.json(
            { success: false, error: 'Missing exchange or symbol parameter' },
            { status: 400, headers: corsHeaders }
          );
        }

        console.log(`[API] Calculating volatility for ${targetExchange}/${targetSymbol}`);
        const { calculateVolatilityMetrics } = await import('./volatility');

        // Get original_symbol from normalized_tokens
        const tokenResult = await env.DB.prepare(`
          SELECT original_symbol FROM normalized_tokens
          WHERE exchange = ? AND symbol = ?
        `).bind(targetExchange, targetSymbol).first();

        if (!tokenResult) {
          return Response.json(
            { success: false, error: 'Market not found' },
            { status: 404, headers: corsHeaders }
          );
        }

        const originalSymbol = (tokenResult as any).original_symbol;
        const metrics = await calculateVolatilityMetrics(env, targetExchange, originalSymbol);

        if (!metrics) {
          return Response.json(
            { success: false, error: 'Failed to calculate metrics (insufficient data)' },
            { status: 500, headers: corsHeaders }
          );
        }

        // Update normalized_tokens
        await env.DB.prepare(`
          UPDATE normalized_tokens
          SET volatility_24h = ?, volatility_7d = ?, atr_14 = ?, bb_width = ?
          WHERE exchange = ? AND symbol = ?
        `).bind(
          metrics.volatility_24h,
          metrics.volatility_7d,
          metrics.atr_14,
          metrics.bb_width,
          targetExchange,
          targetSymbol
        ).run();

        // Insert/update volatility_stats
        await env.DB.prepare(`
          INSERT INTO volatility_stats (
            exchange, symbol, period, volatility, atr, bb_width, std_dev,
            high, low, avg_price, calculated_at
          ) VALUES (?, ?, '24h', ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(exchange, symbol, period)
          DO UPDATE SET
            volatility = excluded.volatility,
            atr = excluded.atr,
            bb_width = excluded.bb_width,
            std_dev = excluded.std_dev,
            high = excluded.high,
            low = excluded.low,
            avg_price = excluded.avg_price,
            calculated_at = excluded.calculated_at
        `).bind(
          targetExchange,
          originalSymbol,
          metrics.volatility_24h,
          metrics.atr_14,
          metrics.bb_width,
          metrics.price_std_dev,
          metrics.high_24h,
          metrics.low_24h,
          metrics.avg_price_24h,
          Math.floor(Date.now() / 1000)
        ).run();

        console.log(`[API] Volatility calculated for ${targetExchange}/${targetSymbol}`);
        return Response.json(
          { success: true, data: metrics },
          { headers: corsHeaders }
        );
      } catch (error) {
        console.error('[API] Volatility calculation error:', error);
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : 'Volatility calculation failed',
            stack: error instanceof Error ? error.stack : undefined
          },
          { status: 500, headers: corsHeaders }
        );
      }
    default:
      // Handle dynamic routes like /api/tokens/{symbol}/history
      if (path.startsWith('/api/tokens/') && path.endsWith('/history')) {
        const pathParts = path.split('/');
        const symbol = pathParts[3]; // /api/tokens/{symbol}/history
        
        if (symbol) {
          // Create a new URL with symbol as query parameter
          const modifiedUrl = new URL(url.toString());
          modifiedUrl.searchParams.set('symbol', symbol.toUpperCase());
          
          // Forward to getNormalizedData which supports both from and to parameters
          return await getNormalizedData(env, modifiedUrl, corsHeaders);
        }
      }
      
      return new Response('API endpoint not found', {
        status: 404,
        headers: corsHeaders,
      });
  }
}

// Normalize symbol names to a common format (base asset)
function normalizeSymbol(symbol: string): string {
  // Remove exchange-specific prefixes first
  let normalized = symbol
    .replace(/^hyna:/i, '')       // HyENA: hyna:BTC -> BTC
    .replace(/^xyz:/i, '')        // XYZ: xyz:BTC -> BTC
    .replace(/^flx:/i, '')        // FLX: flx:BTC -> BTC
    .replace(/^vntl:/i, '')       // VNTL: vntl:BTC -> BTC
    .replace(/^km:/i, '')         // KM: km:BTC -> BTC
    .replace(/^hyperliquid:/i, '') // Hyperliquid: hyperliquid:BTC -> BTC
    .replace(/^edgex:/i, '')      // EdgeX: edgex:BTC -> BTC
    .replace(/^lighter:/i, '')    // Lighter: lighter:BTC -> BTC
    .replace(/^paradex:/i, '')    // Paradex: paradex:BTC -> BTC
    .replace(/^aster:/i, '')      // Aster: aster:BTC -> BTC
    .replace(/^pacifica:/i, '')   // Pacifica: pacifica:BTC -> BTC
    .replace(/^extended:/i, '');  // Extended: extended:BTC -> BTC

  // Remove common suffixes
  normalized = normalized
    .replace(/-USD-PERP$/i, '')  // Paradex: BTC-USD-PERP -> BTC
    .replace(/-USD$/i, '')        // Extended: BTC-USD -> BTC
    .replace(/USDT$/i, '')        // Aster: BTCUSDT -> BTC
    .replace(/USD$/i, '')         // EdgeX: BTCUSD -> BTC
    .replace(/^1000/i, '')        // Remove 1000 prefix: 1000PEPE -> PEPE
    .replace(/^k/i, '')           // Remove k prefix: kBONK -> BONK
    .toUpperCase();

  return normalized;
}

/**
 * Calculate annualized funding rate based on exchange-specific payment frequencies
 *
 * @param exchange - The exchange name
 * @param intervalHours - Optional interval hours for exchanges with variable intervals
 * @returns Object with hourly normalized rate and annual rate as percentage
 */
function calculateFundingRates(fundingRate: number, exchange: string, intervalHours?: number): { hourly: number; annual: number } {
  let hours: number;
  let isAlreadyPercent = false;

  switch (exchange.toLowerCase()) {
    case 'hyperliquid':
    case 'hyena':
    case 'xyz':
    case 'flx':
    case 'vntl':
    case 'km':
    case 'variational':
    case 'paradex':
      // 8-hour intervals
      hours = 8;
      break;

    case 'edgex':
      // 4-hour intervals
      hours = 4;
      break;

    case 'lighter':
      // 1-hour intervals, rate already in %
      hours = 1;
      isAlreadyPercent = true;
      break;

    case 'aster':
      // Variable intervals per token (1h, 4h, or 8h)
      hours = intervalHours || 8; // Fallback to 8h if not provided
      break;

    case 'extended':
    case 'pacifica':
      // 1-hour intervals
      hours = 1;
      break;

    default:
      // Fallback: assume 8-hour intervals
      hours = 8;
      break;
  }

  // Normalize to hourly rate
  const hourlyRate = fundingRate / hours;

  // Calculate annual rate from hourly rate
  // hourly × 24 hours/day × 365 days × 100 (to percentage)
  // Exception: Lighter already provides rate in %, so no × 100
  const annualRate = isAlreadyPercent 
    ? hourlyRate * 24 * 365 
    : hourlyRate * 24 * 365 * 100;

  return {
    hourly: hourlyRate,
    annual: annualRate
  };
}

/**
 * Health Check for WebSocket Trackers
 *
 * Checks if WebSocket-based trackers are connected and receiving data.
 * If a tracker is disconnected or hasn't received messages recently, it triggers a reconnect.
 *
 * Runs every 5 minutes via cron job.
 *
 * WebSocket trackers: Lighter, Paradex, Pacifica, EdgeX
 * Polling trackers (skipped): Hyperliquid, Aster, Extended
 */
async function checkTrackerHealth(env: Env): Promise<void> {
  try {
    console.log('[Health Check] Starting tracker health check (WebSocket + Polling trackers)');

    const trackers = [
      { name: 'lighter', binding: env.LIGHTER_TRACKER },
      { name: 'paradex', binding: env.PARADEX_TRACKER },
      { name: 'pacifica', binding: env.PACIFICA_TRACKER },
      { name: 'edgex', binding: env.EDGEX_TRACKER },
      { name: 'hyperliquid', binding: env.HYPERLIQUID_TRACKER },
      { name: 'aster', binding: env.ASTER_TRACKER },
      { name: 'extended', binding: env.EXTENDED_TRACKER },
      { name: 'hyena', binding: env.HYENA_TRACKER },
      { name: 'xyz', binding: env.XYZ_TRACKER },
      { name: 'flx', binding: env.FLX_TRACKER },
      { name: 'vntl', binding: env.VNTL_TRACKER },
      { name: 'km', binding: env.KM_TRACKER },
      { name: 'variational', binding: env.VARIATIONAL_TRACKER },
    ];

    const results: Array<{ name: string; status: string; action: string }> = [];

    for (const tracker of trackers) {
      try {
        // Get Durable Object stub
        const id = tracker.binding.idFromName(`${tracker.name}-main`);
        const stub = tracker.binding.get(id);

        // Check tracker status
        const statusResponse = await stub.fetch(new Request('https://dummy/status'));
        const statusData = await statusResponse.json() as any;

        const connected = statusData.data?.connected;
        const bufferSize = statusData.data?.bufferSize || 0;
        const isRunning = statusData.data?.isRunning;

        // For WebSocket trackers (lighter, paradex, pacifica, edgex): check connected and bufferSize
        // For polling trackers (hyperliquid, aster, extended): check isRunning
        const isPollingTracker = ['hyperliquid', 'aster', 'extended'].includes(tracker.name);
        const isHealthy = isPollingTracker
          ? (isRunning !== false)  // For polling trackers, just check if running
          : (connected && bufferSize > 0);  // For WebSocket trackers, check connected AND has data

        console.log(`[Health Check] ${tracker.name}: ${isPollingTracker ? 'isRunning=' + isRunning : 'connected=' + connected + ', bufferSize=' + bufferSize}`);

        // If unhealthy, trigger restart
        if (!isHealthy) {
          console.warn(`[Health Check] ${tracker.name} is unhealthy - triggering ${isPollingTracker ? 'restart' : 'reconnect'}`);

          // Trigger restart
          const startResponse = await stub.fetch(new Request('https://dummy/start'));
          const startData = await startResponse.json() as any;

          results.push({
            name: tracker.name,
            status: isHealthy ? 'healthy' : (isPollingTracker ? 'not_running' : (connected ? 'connected_no_data' : 'disconnected')),
            action: startData.success ? 'restarted' : 'restart_failed'
          });

          console.log(`[Health Check] ${tracker.name} restart result:`, startData.success ? 'SUCCESS' : 'FAILED');
        } else {
          results.push({
            name: tracker.name,
            status: 'healthy',
            action: 'none'
          });
        }
      } catch (error) {
        console.error(`[Health Check] Failed to check ${tracker.name}:`, error);
        results.push({
          name: tracker.name,
          status: 'error',
          action: 'check_failed'
        });
      }
    }

    // Log summary
    const unhealthy = results.filter(r => r.action !== 'none');
    if (unhealthy.length > 0) {
      console.warn(`[Health Check] Found ${unhealthy.length} unhealthy tracker(s):`, unhealthy);
    } else {
      console.log('[Health Check] All trackers are healthy');
    }

    // Update database with health check timestamp
    await env.DB.prepare(
      `UPDATE tracker_status
       SET updated_at = ?
       WHERE exchange IN ('lighter', 'paradex', 'pacifica', 'edgex')`
    )
      .bind(Math.floor(Date.now() / 1000))
      .run();

    console.log('[Health Check] Completed successfully');
  } catch (error) {
    console.error('[Health Check] Failed:', error);
  }
}

// Update normalized_tokens table with latest data from all exchanges
async function updateNormalizedTokens(env: Env): Promise<void> {
  const startTime = Date.now();
  console.log('[UpdateNormalizedTokens] ========== STARTING UPDATE ==========');

  try {
    const now = Math.floor(Date.now() / 1000);
    const tenMinutesAgo = now - 600;  // Use 10 minutes instead of 5 for better coverage

    console.log(`[UpdateNormalizedTokens] Current time: ${now} (${new Date(now * 1000).toISOString()})`);
    console.log(`[UpdateNormalizedTokens] Looking for data newer than: ${tenMinutesAgo} (${new Date(tenMinutesAgo * 1000).toISOString()})`);

    // Step 1: Query latest data from market_stats (simple, direct query)
    const statsQuery = `
      SELECT
        exchange,
        symbol,
        mark_price,
        index_price,
        open_interest_usd,
        funding_rate,
        next_funding_time,
        funding_interval_hours,
        daily_base_token_volume,
        daily_price_change,
        daily_price_low,
        daily_price_high,
        created_at,
        MAX(created_at) as latest_time
      FROM market_stats
      WHERE created_at > ?
      GROUP BY exchange, symbol
    `;

    console.log('[UpdateNormalizedTokens] Step 1: Querying market_stats...');
    const statsResult = await env.DB.prepare(statsQuery).bind(tenMinutesAgo).all();

    if (!statsResult.success) {
      throw new Error(`market_stats query failed: ${JSON.stringify(statsResult)}`);
    }

    console.log(`[UpdateNormalizedTokens] Found ${statsResult.results?.length || 0} records from market_stats`);

    // Log breakdown by exchange
    const exchangeCounts = new Map<string, number>();
    for (const row of (statsResult.results || []) as any[]) {
      exchangeCounts.set(row.exchange, (exchangeCounts.get(row.exchange) || 0) + 1);
    }
    console.log('[UpdateNormalizedTokens] Breakdown by exchange:', Object.fromEntries(exchangeCounts));

    // Step 2: Process and upsert each record
    const upserts: D1PreparedStatement[] = [];
    let processedCount = 0;
    let errorCount = 0;

    for (const row of (statsResult.results || []) as any[]) {
      try {
        const normalizedSymbol = normalizeSymbol(row.symbol);
        const fundingRate = parseFloat(row.funding_rate || '0');
        const intervalHours = row.funding_interval_hours ? parseInt(row.funding_interval_hours) : undefined;
        const fundingRates = calculateFundingRates(fundingRate, row.exchange, intervalHours);

        // Log first few entries for debugging
        if (processedCount < 3) {
          console.log(`[UpdateNormalizedTokens] Sample ${processedCount + 1}:`, {
            exchange: row.exchange,
            symbol: row.symbol,
            normalizedSymbol,
            fundingRate,
            intervalHours,
            fundingRateHourly: fundingRates.hourly,
            fundingRateAnnual: fundingRates.annual,
            markPrice: row.mark_price,
          });
        }

        upserts.push(
          env.DB.prepare(
            `INSERT INTO normalized_tokens (
              symbol, exchange, mark_price, index_price, open_interest_usd,
              volume_24h, funding_rate, funding_rate_hourly, funding_rate_annual, next_funding_time,
              price_change_24h, price_low_24h, price_high_24h, original_symbol, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(symbol, exchange) DO UPDATE SET
              mark_price = excluded.mark_price,
              index_price = excluded.index_price,
              open_interest_usd = excluded.open_interest_usd,
              volume_24h = excluded.volume_24h,
              funding_rate = excluded.funding_rate,
              funding_rate_hourly = excluded.funding_rate_hourly,
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
            parseFloat(row.daily_base_token_volume || '0'),
            fundingRate,
            fundingRates.hourly,
            fundingRates.annual,
            row.next_funding_time ? parseInt(row.next_funding_time) : null,
            parseFloat(row.daily_price_change || '0'),
            parseFloat(row.daily_price_low || '0'),
            parseFloat(row.daily_price_high || '0'),
            row.symbol,
            now
          )
        );

        processedCount++;
      } catch (rowError) {
        errorCount++;
        console.error(`[UpdateNormalizedTokens] Error processing row:`, row, rowError);
      }
    }

    console.log(`[UpdateNormalizedTokens] Processed ${processedCount} records, ${errorCount} errors`);
    console.log(`[UpdateNormalizedTokens] Prepared ${upserts.length} UPSERT statements`);

    // Step 3: Execute batch upsert
    if (upserts.length > 0) {
      console.log('[UpdateNormalizedTokens] Step 3: Executing batch upsert...');
      const batchResult = await env.DB.batch(upserts);

      console.log('[UpdateNormalizedTokens] Batch execution completed');
      console.log('[UpdateNormalizedTokens] Batch result summary:', {
        totalStatements: upserts.length,
        results: batchResult.length,
        firstResult: batchResult[0]
      });

      console.log(`[UpdateNormalizedTokens] ✅ Successfully updated ${upserts.length} entries`);
    } else {
      console.log('[UpdateNormalizedTokens] ⚠️ No records to update');
    }

    const duration = Date.now() - startTime;
    console.log(`[UpdateNormalizedTokens] ========== COMPLETED in ${duration}ms ==========`);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[UpdateNormalizedTokens] ❌ FAILED after ${duration}ms:`, error);
    if (error instanceof Error) {
      console.error('[UpdateNormalizedTokens] Error details:', {
        message: error.message,
        stack: error.stack
      });
    }
  }
}

// Aggregate old market_stats data (>7 days) into market_history table
// Aggregate 15-second snapshots to 1-minute aggregates
// Runs every 5 minutes, aggregates data older than 5 minutes
async function aggregateTo1Minute(env: Env): Promise<void> {
  try {
    console.log('[Cron] Starting 15s → 1m aggregation for data older than 5 minutes');

    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - (5 * 60);
    const now = Math.floor(Date.now() / 1000);

    // Get oldest timestamp from raw data
    const oldestResult = await env.DB.prepare(
      'SELECT MIN(created_at) as oldest FROM market_stats WHERE created_at < ?'
    ).bind(fiveMinutesAgo).first<{ oldest: number | null }>();

    if (!oldestResult?.oldest) {
      console.log('[Cron] No data to aggregate');
      return;
    }

    // Use the oldest available raw data timestamp (ignore gaps)
    const oldestTimestamp = oldestResult.oldest;
    console.log(`[Cron] Starting aggregation from ${new Date(oldestTimestamp * 1000).toISOString()} (ignoring any gaps)`);
    console.log(`[Cron] Found data from ${new Date(oldestTimestamp * 1000).toISOString()} to aggregate`);

    // Process in 1-hour batches to avoid memory issues
    const batchSize = 60 * 60; // 1 hour in seconds
    let batchStart = oldestTimestamp;
    let totalAggregated = 0;
    let totalDeleted = 0;
    let batchCount = 0;
    const maxBatches = 50; // Limit to 50 hours of data per run (increased to clear backlog)

    while (batchStart < fiveMinutesAgo && batchCount < maxBatches) {
      const batchEnd = Math.min(batchStart + batchSize, fiveMinutesAgo);

      console.log(`[Cron] Processing batch ${batchCount + 1}: ${new Date(batchStart * 1000).toISOString()} to ${new Date(batchEnd * 1000).toISOString()}`);

      // Aggregate this specific batch
      const aggregationQuery = `
        INSERT OR REPLACE INTO market_stats_1m (
          exchange, symbol, normalized_symbol,
          avg_mark_price, avg_index_price, min_price, max_price, price_volatility,
          volume_base, volume_quote,
          avg_open_interest, avg_open_interest_usd, max_open_interest_usd,
          avg_funding_rate, avg_funding_rate_annual, min_funding_rate, max_funding_rate,
          minute_timestamp, sample_count, created_at
        )
        SELECT
          exchange,
          symbol,
          REPLACE(REPLACE(REPLACE(REPLACE(
            UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
              symbol,
              'xyz:', ''), 'hyna:', ''), 'flx:', ''), 'vntl:', ''), 'km:', ''),
              'edgex:', ''), 'aster:', '')),
            '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', '')
          as normalized_symbol,
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
            WHEN exchange = 'hyperliquid' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
            WHEN exchange = 'paradex' THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
            WHEN exchange = 'edgex' THEN AVG(CAST(funding_rate AS REAL)) * 6 * 365 * 100
            WHEN exchange = 'lighter' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365
            WHEN exchange = 'aster' THEN
              CASE
                WHEN AVG(funding_interval_hours) = 1 THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
                WHEN AVG(funding_interval_hours) = 4 THEN AVG(CAST(funding_rate AS REAL)) * 6 * 365 * 100
                WHEN AVG(funding_interval_hours) = 8 THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
                ELSE AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
              END
            WHEN exchange = 'extended' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
            WHEN exchange = 'pacifica' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
            WHEN exchange IN ('hyena', 'xyz', 'flx', 'vntl', 'km') THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
            ELSE AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
          END as avg_funding_rate_annual,
          MIN(CAST(funding_rate AS REAL)) as min_funding_rate,
          MAX(CAST(funding_rate AS REAL)) as max_funding_rate,
          -- Timestamp rounded to minute
          (created_at / 60) * 60 as minute_timestamp,
          COUNT(*) as sample_count,
          ? as created_at
        FROM market_stats
        WHERE created_at >= ? AND created_at < ?
        GROUP BY exchange, symbol, minute_timestamp
      `;

      const result = await env.DB.prepare(aggregationQuery)
        .bind(now, batchStart, batchEnd)
        .run();

      totalAggregated += result.meta.changes || 0;
      console.log(`[Cron] Batch ${batchCount + 1}: Aggregated ${result.meta.changes} 1-minute records`);

      // Delete the 15-second snapshots that were aggregated in this batch
      const deleteResult = await env.DB.prepare(
        'DELETE FROM market_stats WHERE created_at >= ? AND created_at < ?'
      ).bind(batchStart, batchEnd).run();

      totalDeleted += deleteResult.meta.changes || 0;
      console.log(`[Cron] Batch ${batchCount + 1}: Deleted ${deleteResult.meta.changes} old 15s snapshots`);

      batchStart = batchEnd;
      batchCount++;
    }

    console.log(`[Cron] 1-minute aggregation completed: ${batchCount} batches processed, ${totalAggregated} records aggregated, ${totalDeleted} snapshots deleted`);

    if (batchStart < fiveMinutesAgo) {
      console.log(`[Cron] More data remaining to aggregate (from ${new Date(batchStart * 1000).toISOString()}), will continue in next run`);
    }

  } catch (error) {
    console.error('[Cron] Failed to aggregate to 1-minute:', error);
  }
}

// Aggregate 1-minute data to hourly aggregates
// Runs every hour, aggregates data older than 1 hour
async function aggregateTo1Hour(env: Env): Promise<void> {
  try {
    console.log('[Cron] Starting 1m → 1h aggregation for data older than 1 hour');

    const oneHourAgo = Math.floor(Date.now() / 1000) - (60 * 60);
    const now = Math.floor(Date.now() / 1000);

    // Check if there's data to aggregate
    const oldestQuery = await env.DB.prepare(
      'SELECT MIN(created_at) as oldest FROM market_stats_1m WHERE created_at < ?'
    ).bind(oneHourAgo).first<{ oldest: number }>();

    if (!oldestQuery || !oldestQuery.oldest) {
      console.log('[Cron] No 1m data to aggregate to 1h');
      return;
    }

    console.log(`[Cron] Aggregating 1m data from ${new Date(oldestQuery.oldest * 1000).toISOString()}`);

    // Aggregate to hourly intervals
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
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            symbol,
            'hyna:', ''), 'xyz:', ''), 'flx:', ''), 'vntl:', ''), 'km:', ''),
            'HYNA:', ''), 'XYZ:', ''), 'FLX:', ''), 'VNTL:', ''), 'KM:', ''),
            'edgex:', ''), 'EDGEX:', ''),
            'aster:', ''), 'ASTER:', ''),
            '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')
        ) as normalized_symbol,
        -- Prices (weighted average)
        SUM(avg_mark_price * sample_count) / SUM(sample_count) as avg_mark_price,
        SUM(avg_index_price * sample_count) / SUM(sample_count) as avg_index_price,
        MIN(min_price) as min_price,
        MAX(max_price) as max_price,
        -- Recalculate volatility from min/max
        CASE
          WHEN SUM(avg_mark_price * sample_count) / SUM(sample_count) > 0
          THEN ((MAX(max_price) - MIN(min_price)) / (SUM(avg_mark_price * sample_count) / SUM(sample_count)) * 100)
          ELSE 0
        END as price_volatility,
        -- Volume (sum)
        SUM(volume_base) as volume_base,
        SUM(volume_quote) as volume_quote,
        -- Open Interest (weighted average)
        SUM(avg_open_interest * sample_count) / SUM(sample_count) as avg_open_interest,
        SUM(avg_open_interest_usd * sample_count) / SUM(sample_count) as avg_open_interest_usd,
        MAX(max_open_interest_usd) as max_open_interest_usd,
        -- Funding Rate (weighted average)
        SUM(avg_funding_rate * sample_count) / SUM(sample_count) as avg_funding_rate,
        SUM(avg_funding_rate_annual * sample_count) / SUM(sample_count) as avg_funding_rate_annual,
        MIN(min_funding_rate) as min_funding_rate,
        MAX(max_funding_rate) as max_funding_rate,
        -- Timestamp rounded to hour
        (minute_timestamp / 3600) * 3600 as hour_timestamp,
        SUM(sample_count) as sample_count,
        ? as aggregated_at
      FROM market_stats_1m
      WHERE created_at < ?
      GROUP BY exchange, symbol, hour_timestamp
    `;

    const result = await env.DB.prepare(aggregationQuery)
      .bind(now, oneHourAgo)
      .run();

    console.log(`[Cron] Aggregated ${result.meta.changes} hourly records`);

    // Delete the 1-minute data that was aggregated
    const deleteResult = await env.DB.prepare(
      'DELETE FROM market_stats_1m WHERE created_at < ?'
    ).bind(oneHourAgo).run();

    console.log(`[Cron] Deleted ${deleteResult.meta.changes} old 1m aggregates`);
    console.log('[Cron] Hourly aggregation completed successfully');

  } catch (error) {
    console.error('[Cron] Failed to aggregate to 1-hour:', error);
  }
}

// DEPRECATED: Old aggregation function (7-day retention)
// Kept for backwards compatibility, will be removed in next version
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
          WHEN exchange = 'hyperliquid' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
          WHEN exchange = 'paradex' THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
          WHEN exchange = 'edgex' THEN AVG(CAST(funding_rate AS REAL)) * 6 * 365 * 100
          WHEN exchange = 'lighter' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365
          WHEN exchange = 'aster' THEN
            CASE
              WHEN AVG(funding_interval_hours) = 1 THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
              WHEN AVG(funding_interval_hours) = 4 THEN AVG(CAST(funding_rate AS REAL)) * 6 * 365 * 100
              WHEN AVG(funding_interval_hours) = 8 THEN AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
              ELSE AVG(CAST(funding_rate AS REAL)) * 3 * 365 * 100
            END
          WHEN exchange = 'extended' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
          WHEN exchange = 'pacifica' THEN AVG(CAST(funding_rate AS REAL)) * 24 * 365 * 100
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

// In-memory cache for markets endpoint to prevent DB overload
let marketsCache: { data: any; timestamp: number; key: string } | null = null;
const MARKETS_CACHE_TTL = 30000; // 30 seconds - increased due to ~1500 total markets

// Get all markets from normalized_tokens table
async function getAllMarkets(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  // Optional filters - declared outside try for error logging
  const exchange = url.searchParams.get('exchange');
  const symbol = url.searchParams.get('symbol');
  const limit = parseInt(url.searchParams.get('limit') || '100'); // Default 100 to prevent DB overload
  
  // Create cache key based on filters
  const cacheKey = `${exchange || 'all'}_${symbol || 'all'}_${limit}`;
  
  // Check cache first
  const now = Date.now();
  if (marketsCache && marketsCache.key === cacheKey && (now - marketsCache.timestamp) < MARKETS_CACHE_TTL) {
    console.log('[API] Returning cached markets data');
    return Response.json(marketsCache.data, { headers: corsHeaders });
  }
  
  try {

    // Build query with optional filters (including volatility metrics)
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
        funding_rate_hourly,
        funding_rate_annual,
        next_funding_time,
        price_change_24h,
        price_low_24h,
        price_high_24h,
        volatility_24h,
        volatility_7d,
        atr_14,
        bb_width,
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

    // Map results (including volatility metrics)
    const markets = result.results.map((row: any) => ({
      symbol: row.symbol,
      exchange: row.exchange,
      original_symbol: row.original_symbol,
      mark_price: row.mark_price || 0,
      index_price: row.index_price || 0,
      open_interest_usd: row.open_interest_usd || 0,
      volume_24h: row.volume_24h || 0,
      funding_rate: row.funding_rate || 0,
      funding_rate_hourly: row.funding_rate_hourly || 0,
      funding_rate_annual: row.funding_rate_annual || 0,
      next_funding_time: row.next_funding_time || null,
      price_change_24h: row.price_change_24h || 0,
      price_low_24h: row.price_low_24h || 0,
      price_high_24h: row.price_high_24h || 0,
      volatility_24h: row.volatility_24h || null,
      volatility_7d: row.volatility_7d || null,
      atr_14: row.atr_14 || null,
      bb_width: row.bb_width || null,
      timestamp: row.timestamp,
    }));

    const responseData = {
      success: true,
      data: markets,
      meta: {
        count: markets.length,
        filters: {
          exchange: exchange || 'all',
          symbol: symbol || 'all',
        },
      },
    } as ApiResponse;
    
    // Update cache
    marketsCache = {
      data: responseData,
      timestamp: Date.now(),
      key: cacheKey
    };
    
    return Response.json(responseData, { headers: corsHeaders });
  } catch (error) {
    console.error('[API] Error in getAllMarkets:', error);
    console.error('[API] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      exchange,
      symbol,
      limit
    });
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
    const limit = parseInt(url.searchParams.get('limit') || '500'); // Reduced from 1000 to 500

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
    params1.push(Math.min(limit, 5000)); // Reduced max from 10k to 5k to prevent timeouts

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
    params2.push(Math.min(limit, 5000)); // Reduced max from 10k to 5k to prevent timeouts

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
      .slice(0, Math.min(limit, 5000))
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

// Get bulk funding rate moving averages for all tokens and exchanges
async function getBulkFundingMovingAverages(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Optional: filter by specific exchanges
    const exchangesParam = url.searchParams.get('exchanges');
    const exchanges = exchangesParam ? exchangesParam.split(',').map(e => e.trim().toLowerCase()) : undefined;
    
    // Optional: filter by specific symbols
    const symbolsParam = url.searchParams.get('symbols');
    const symbols = symbolsParam ? symbolsParam.split(',').map(s => s.trim().toUpperCase()) : undefined;
    
    // Optional: specify timeframes (default: all)
    const timeframesParam = url.searchParams.get('timeframes');
    const requestedTimeframes = timeframesParam ? timeframesParam.split(',').map(t => t.trim()) : undefined;
    
    // Fetch pre-calculated data from cache
    const cachedData = await getCachedFundingMAs(env, exchanges, symbols, requestedTimeframes);
    
    // Transform cached data into the expected format
    const results: Map<string, any> = new Map();
    
    for (const row of cachedData) {
      const key = `${row.normalized_symbol}:${row.exchange}`;
      
      if (!results.has(key)) {
        results.set(key, {
          symbol: row.normalized_symbol,
          exchange: row.exchange,
          timeframes: {},
        });
      }
      
      const maData = results.get(key)!;
      maData.timeframes[row.timeframe] = {
        avg_funding_rate: parseFloat((row.avg_funding_rate as number).toFixed(8)),
        avg_funding_rate_annual: parseFloat((row.avg_funding_rate_annual as number).toFixed(4)),
        sample_count: row.sample_count,
      };
    }
    
    // Convert Map to Array
    const resultsArray: any[] = Array.from(results.values());
    
    // Get list of timeframes from the data
    const timeframesSet = new Set<string>();
    for (const row of cachedData) {
      timeframesSet.add(row.timeframe);
    }
    const timeframes = Array.from(timeframesSet).sort();
    
    // Calculate arbitrage opportunities (funding rate differences between exchanges for same token)
    const arbitrageOpportunities: any[] = [];
    
    // Group results by symbol
    const bySymbol = new Map<string, any[]>();
    for (const result of resultsArray) {
      if (!bySymbol.has(result.symbol)) {
        bySymbol.set(result.symbol, []);
      }
      bySymbol.get(result.symbol)!.push(result);
    }
    
    // Calculate arbitrage for each symbol across exchanges
    for (const [symbol, exchangeData] of bySymbol.entries()) {
      if (exchangeData.length < 2) continue; // Need at least 2 exchanges for arbitrage
      
      // For each timeframe, find the best arbitrage opportunity
      for (const timeframe of timeframes) {
        const validExchanges = exchangeData.filter(e => e.timeframes[timeframe] !== null && e.timeframes[timeframe] !== undefined);
        
        if (validExchanges.length < 2) continue;
        
        // Find highest and lowest funding rates
        let highest = validExchanges[0];
        let lowest = validExchanges[0];
        
        for (const ex of validExchanges) {
          const rate = ex.timeframes[timeframe].avg_funding_rate_annual;
          if (rate > highest.timeframes[timeframe].avg_funding_rate_annual) {
            highest = ex;
          }
          if (rate < lowest.timeframes[timeframe].avg_funding_rate_annual) {
            lowest = ex;
          }
        }
        
        const spread = highest.timeframes[timeframe].avg_funding_rate_annual - 
                      lowest.timeframes[timeframe].avg_funding_rate_annual;
        
        // Only include significant arbitrage opportunities (> 0.1% APR difference)
        if (Math.abs(spread) > 0.1) {
          arbitrageOpportunities.push({
            symbol,
            timeframe,
            long_exchange: lowest.exchange,  // Go long (receive funding) on lower rate
            short_exchange: highest.exchange, // Go short (pay funding) on higher rate
            long_rate: lowest.timeframes[timeframe].avg_funding_rate_annual,
            short_rate: highest.timeframes[timeframe].avg_funding_rate_annual,
            spread_apr: parseFloat(spread.toFixed(4)),
            profit_potential: spread > 0 ? 'positive' : 'negative',
          });
        }
      }
    }
    
    // Sort arbitrage opportunities by spread (highest first)
    arbitrageOpportunities.sort((a, b) => Math.abs(b.spread_apr) - Math.abs(a.spread_apr));
    
    return Response.json(
      {
        success: true,
        data: resultsArray,
        arbitrage: arbitrageOpportunities,
        meta: {
          total_combinations: resultsArray.length,
          timeframes: timeframes,
          exchanges_filter: exchanges || 'all',
          symbols_filter: symbols || 'all',
          arbitrage_opportunities: arbitrageOpportunities.length,
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in getBulkFundingMovingAverages:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to calculate bulk moving averages',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}

// Get funding rate moving averages for different time periods
async function getFundingMovingAverages(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const symbol = url.searchParams.get('symbol')?.toUpperCase();
    const exchange = url.searchParams.get('exchange');

    if (!symbol) {
      return Response.json(
        {
          success: false,
          error: 'Missing required parameter: symbol',
        } as ApiResponse,
        { status: 400, headers: corsHeaders }
      );
    }

    if (!exchange) {
      return Response.json(
        {
          success: false,
          error: 'Missing required parameter: exchange',
        } as ApiResponse,
        { status: 400, headers: corsHeaders }
      );
    }

    // Smart symbol resolution: try multiple variations to find the token
    const symbolVariations = [
      symbol,
      `1000${symbol}`,
      `k${symbol}`,
      `K${symbol}`,
    ];

    const findExistingSymbol = async (symbolToCheck: string): Promise<boolean> => {
      const checkQuery = `
        SELECT 1 FROM market_stats_1m 
        WHERE normalized_symbol = ? AND exchange = ?
        LIMIT 1
      `;
      const result = await env.DB.prepare(checkQuery).bind(symbolToCheck, exchange).first();
      return result !== null;
    };

    let resolvedSymbol = symbol;
    for (const variation of symbolVariations) {
      if (await findExistingSymbol(variation)) {
        resolvedSymbol = variation;
        break;
      }
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    
    // Define time periods in seconds
    const periods = {
      '24h': 24 * 60 * 60,
      '3d': 3 * 24 * 60 * 60,
      '7d': 7 * 24 * 60 * 60,
      '14d': 14 * 24 * 60 * 60,
      '30d': 30 * 24 * 60 * 60,
    };

    const result: any = {
      symbol: resolvedSymbol,
      exchange,
    };

    // Calculate moving average for each period
    for (const [periodName, periodSeconds] of Object.entries(periods)) {
      const fromTimestamp = nowSeconds - periodSeconds;

      // Query market_stats_1m for the period
      const query = `
        SELECT AVG(avg_funding_rate) as avg_funding_rate
        FROM market_stats_1m
        WHERE normalized_symbol = ?
          AND exchange = ?
          AND minute_timestamp >= ?
          AND minute_timestamp <= ?
          AND avg_funding_rate IS NOT NULL
      `;

      const queryResult = await env.DB.prepare(query)
        .bind(resolvedSymbol, exchange, fromTimestamp, nowSeconds)
        .first();

      if (queryResult && queryResult.avg_funding_rate !== null) {
        result[`ma${periodName}`] = parseFloat((queryResult.avg_funding_rate as number).toFixed(6));
      } else {
        result[`ma${periodName}`] = null;
      }
    }

    return Response.json(
      {
        success: true,
        data: result,
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in getFundingMovingAverages:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to calculate moving averages',
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

    // Smart symbol resolution: find ALL matching variations to support tokens like PEPE
    // that exist as both "1000PEPE" and "kPEPE" across different exchanges
    const symbolVariations = [
      symbol,                    // Original (e.g., "BTC" or "PEPE")
      `1000${symbol}`,          // With 1000 prefix (e.g., "1000PEPE")
      `k${symbol}`,             // With k prefix lowercase (e.g., "kPEPE")
      `K${symbol}`,             // With K prefix uppercase (e.g., "KPEPE")
    ];

    // Find ALL symbol variations that exist in a single query (optimized to prevent DB overload)
    const symbolCheckQuery = `
      SELECT DISTINCT normalized_symbol 
      FROM market_stats_1m 
      WHERE normalized_symbol IN (?, ?, ?, ?)
      LIMIT 4
    `;
    const symbolCheckResult = await env.DB.prepare(symbolCheckQuery)
      .bind(...symbolVariations)
      .all();
    
    const resolvedSymbols: string[] = symbolCheckResult.success && symbolCheckResult.results
      ? symbolCheckResult.results.map((row: any) => row.normalized_symbol)
      : [];

    // If no variations found, return error
    if (resolvedSymbols.length === 0) {
      return Response.json(
        {
          success: false,
          error: `No data found for symbol "${symbol}" in the specified time range`,
        } as ApiResponse,
        { status: 404, headers: corsHeaders }
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = nowSeconds - (7 * 24 * 60 * 60);
    
    // Early validation: reject requests for very large time ranges to prevent DB overload
    const maxTimeRange = 30 * 24 * 60 * 60; // 30 days
    if (from && to) {
      const requestedRange = Math.abs(parseInt(to) - parseInt(from));
      if (requestedRange > maxTimeRange) {
        return Response.json(
          {
            success: false,
            error: `Time range too large. Maximum allowed: 30 days. Requested: ${Math.floor(requestedRange / 86400)} days`,
          } as ApiResponse,
          { status: 400, headers: corsHeaders }
        );
      }
    }

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

    // Determine data source based on time range and interval
    // For 1h interval, ALWAYS use market_history (aggregated data) since market_stats only keeps 5 minutes
    // For other intervals, distinguish between historical (>7d) and recent (<7d) data
    const needsHistoricalData = interval === '1h' || fromTimestamp < sevenDaysAgo;
    const needsRecentData = interval !== '1h' && toTimestamp > sevenDaysAgo;

    let allData: any[] = [];

    // Build IN clause for all resolved symbols
    const symbolPlaceholders = resolvedSymbols.map(() => '?').join(', ');

    // Query 1: Hourly aggregated data from market_history
    // This is used for: (a) all 1h interval requests, or (b) data >= 7 days old for other intervals
    if (interval === '1h' || needsHistoricalData) {
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
        WHERE normalized_symbol IN (${symbolPlaceholders})
      `;

      const historyParams: any[] = [...resolvedSymbols];

      if (exchange) {
        historyQuery += ` AND exchange = ?`;
        historyParams.push(exchange);
      }

      historyQuery += ` AND hour_timestamp >= ? AND hour_timestamp <= ?`;
      // For 1h interval, use full time range; otherwise limit to data older than 7 days
      historyParams.push(fromTimestamp, interval === '1h' ? toTimestamp : Math.min(toTimestamp, sevenDaysAgo));

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

      // Query 1c: For 1h interval requests, supplement with recent non-aggregated hourly data from market_stats_1m
      // This fills the gap between the last aggregated hour in market_history and the current time
      if (interval === '1h') {
        // Get the latest hour_timestamp from market_history for this symbol/exchange
        let latestHourQuery = `
          SELECT MAX(hour_timestamp) as latest_hour
          FROM market_history
          WHERE normalized_symbol IN (${symbolPlaceholders})
        `;

        const latestHourParams: any[] = [...resolvedSymbols];

        if (exchange) {
          latestHourQuery += ` AND exchange = ?`;
          latestHourParams.push(exchange);
        }

        const latestHourResult = await env.DB.prepare(latestHourQuery).bind(...latestHourParams).first();
        const latestAggregatedHour = (latestHourResult?.latest_hour as number) || 0;

        // Only query market_stats_1m if there's a significant gap (>1 hour) to avoid unnecessary queries
        if (latestAggregatedHour > 0 && latestAggregatedHour < toTimestamp - 3600) {
          // Query market_stats_1m for the hours after the latest aggregated hour
          // Aggregate 1-minute data into hourly buckets
          // Optimized: Added LIMIT to reduce data processing
          let recentHourlyQuery = `
            WITH hourly_buckets AS (
              SELECT
                exchange,
                symbol as original_symbol,
                normalized_symbol,
                (minute_timestamp - (minute_timestamp % 3600)) as hour_timestamp,
                MIN(min_price) as min_price,
                MAX(max_price) as max_price,
                AVG(avg_mark_price) as mark_price,
                AVG(avg_index_price) as index_price,
                SUM(volume_base) as volume_base,
                SUM(volume_quote) as volume_quote,
                AVG(avg_open_interest) as open_interest,
                AVG(avg_open_interest_usd) as open_interest_usd,
                MAX(max_open_interest_usd) as max_open_interest_usd,
                AVG(avg_funding_rate) as funding_rate,
                AVG(avg_funding_rate_annual) as funding_rate_annual,
                MIN(min_funding_rate) as min_funding_rate,
                MAX(max_funding_rate) as max_funding_rate,
                SUM(sample_count) as sample_count
              FROM (
                SELECT * FROM market_stats_1m
                WHERE normalized_symbol IN (${symbolPlaceholders})
          `;

          const recentHourlyParams: any[] = [...resolvedSymbols];

          if (exchange) {
            recentHourlyQuery += ` AND exchange = ?`;
            recentHourlyParams.push(exchange);
          }

          // Only get data after the latest aggregated hour
          recentHourlyQuery += ` AND minute_timestamp > ?`;
          recentHourlyParams.push(latestAggregatedHour);

          // And before or at the requested toTimestamp
          recentHourlyQuery += ` AND minute_timestamp <= ?`;
          recentHourlyParams.push(toTimestamp);

          // Limit raw data to prevent excessive processing
          recentHourlyQuery += ` ORDER BY minute_timestamp DESC LIMIT ?`;
          recentHourlyParams.push(limit * 60); // limit hours × 60 minutes

          recentHourlyQuery += `
              ) sub
              GROUP BY exchange, original_symbol, normalized_symbol, hour_timestamp
            )
            SELECT *,
              CASE
                WHEN mark_price > 0
                THEN ((max_price - min_price) / mark_price * 100)
                ELSE 0
              END as volatility,
              datetime(hour_timestamp, 'unixepoch') as timestamp_iso
            FROM hourly_buckets
            ORDER BY hour_timestamp DESC
            LIMIT ?
          `;
          recentHourlyParams.push(limit);

          const recentHourlyResult = await env.DB.prepare(recentHourlyQuery).bind(...recentHourlyParams).all();

          if (recentHourlyResult.success && recentHourlyResult.results && recentHourlyResult.results.length > 0) {
            console.log(`[API] Supplementing with ${recentHourlyResult.results.length} recent hourly buckets from market_stats_1m`);

            allData = allData.concat(
              recentHourlyResult.results.map((row: any) => ({
                ...row,
                timestamp: row.hour_timestamp,
                data_source: 'recent_aggregated',
                interval: '1h',
              }))
            );
          }
        }
      }

      // Skip funding_rate_history query - table is typically empty and causes unnecessary DB load
      // If needed in future, can be re-enabled with proper data population
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
        WHERE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol, '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')) IN (${symbolPlaceholders})
      `;

      const statsParams: any[] = [...resolvedSymbols];

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
        '7d': 7 * 24 * 60 * 60,
        '30d': 30 * 24 * 60 * 60,
      };

      const bucketSize = intervalSeconds[interval];
      if (!bucketSize) {
        return Response.json(
          {
            success: false,
            error: 'Invalid interval. Use: raw, 15m, 1h, 4h, 1d, 7d, 30d',
          } as ApiResponse,
          { status: 400, headers: corsHeaders }
        );
      }

      // If exchange is specified, group by exchange; otherwise aggregate all exchanges together
      let aggregatedQuery = `
        WITH time_buckets AS (
          SELECT
            ${exchange ? 'exchange,' : "'all' as exchange,"}
            ${exchange ? 'symbol as original_symbol,' : 'MAX(symbol) as original_symbol,'}
            UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol, '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')) as normalized_symbol,
            (created_at - (created_at % ?)) as bucket_time,
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
          WHERE UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(symbol, '-USD-PERP', ''), '-USD', ''), 'USDT', ''), 'USD', ''), '1000', ''), 'k', '')) IN (${symbolPlaceholders})
      `;

      const aggregatedParams: any[] = [bucketSize, ...resolvedSymbols];

      if (exchange) {
        aggregatedQuery += ` AND exchange = ?`;
        aggregatedParams.push(exchange);
      }

      aggregatedQuery += ` AND created_at >= ? AND created_at <= ?`;
      aggregatedParams.push(Math.max(fromTimestamp, sevenDaysAgo), toTimestamp);

      aggregatedQuery += `
          GROUP BY ${exchange ? 'exchange, original_symbol,' : ''} normalized_symbol, bucket_time
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

    // Deduplicate data: Prefer 'aggregated' over 'imported' for same timestamp+exchange
    // This prevents duplicate entries when both market_history and funding_rate_history have data
    const deduplicatedData = new Map<string, any>();

    for (const row of allData) {
      const key = `${row.exchange}_${row.timestamp}`;
      const existing = deduplicatedData.get(key);

      // Priority: aggregated > calculated > imported > raw
      const priority: Record<string, number> = { aggregated: 3, calculated: 2, imported: 1, raw: 0 };
      const existingPriority = existing ? (priority[existing.data_source as string] || 0) : -1;
      const newPriority = priority[row.data_source as string] || 0;

      if (!existing || newPriority > existingPriority) {
        deduplicatedData.set(key, row);
      } else if (newPriority === existingPriority && row.data_source === 'imported') {
        // If both are 'imported', merge the data (fill in missing fields)
        deduplicatedData.set(key, {
          ...existing,
          ...Object.fromEntries(
            Object.entries(row).filter(([_, v]) => v !== null && v !== undefined)
          )
        });
      }
    }

    allData = Array.from(deduplicatedData.values());

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

// Helper function for time-based data endpoints
async function getDataForTimeRange(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>,
  hours: number
): Promise<Response> {
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

  // Create new URL with time range parameters
  const newUrl = new URL(url.toString());
  newUrl.searchParams.set('interval', '1h');
  newUrl.searchParams.set('limit', hours.toString());

  // Set time range to last N hours from now
  const now = Math.floor(Date.now() / 1000);
  const fromTime = now - (hours * 60 * 60);
  newUrl.searchParams.set('from', fromTime.toString());
  newUrl.searchParams.set('to', now.toString());

  return await getNormalizedData(env, newUrl, corsHeaders);
}

// Get data for last 24 hours (with caching)
async function getData24h(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const symbol = url.searchParams.get('symbol')?.toUpperCase();
  const exchange = url.searchParams.get('exchange') || 'all';

  if (!symbol) {
    return Response.json(
      { success: false, error: 'Missing required parameter: symbol' } as ApiResponse,
      { status: 400, headers: corsHeaders }
    );
  }

  // OPTIMIZATION: Cache responses for 2 minutes to reduce DB load
  const cacheKey = new Request(`https://cache/data/24h/${symbol}/${exchange}`, { method: 'GET' });
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (response) {
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
    newHeaders.set('X-Cache', 'HIT');
    return new Response(response.body, { status: response.status, headers: newHeaders });
  }

  // Cache miss - fetch fresh data
  response = await getDataForTimeRange(env, url, corsHeaders, 24);

  // Cache successful responses for 2 minutes (120 seconds)
  if (response.ok) {
    const cacheResponse = response.clone();
    const newHeaders = new Headers(cacheResponse.headers);
    newHeaders.set('Cache-Control', 'public, max-age=120');
    const cachedResponse = new Response(cacheResponse.body, {
      status: cacheResponse.status,
      headers: newHeaders
    });
    await cache.put(cacheKey, cachedResponse);
  }

  return response;
}

// Get data for last 7 days (with caching)
async function getData7d(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const symbol = url.searchParams.get('symbol')?.toUpperCase();
  const exchange = url.searchParams.get('exchange') || 'all';

  if (!symbol) {
    return Response.json(
      { success: false, error: 'Missing required parameter: symbol' } as ApiResponse,
      { status: 400, headers: corsHeaders }
    );
  }

  // OPTIMIZATION: Cache responses for 5 minutes to reduce DB load
  const cacheKey = new Request(`https://cache/data/7d/${symbol}/${exchange}`, { method: 'GET' });
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (response) {
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
    newHeaders.set('X-Cache', 'HIT');
    return new Response(response.body, { status: response.status, headers: newHeaders });
  }

  // Cache miss - fetch fresh data
  response = await getDataForTimeRange(env, url, corsHeaders, 168);

  // Cache successful responses for 5 minutes (300 seconds)
  if (response.ok) {
    const cacheResponse = response.clone();
    const newHeaders = new Headers(cacheResponse.headers);
    newHeaders.set('Cache-Control', 'public, max-age=300');
    const cachedResponse = new Response(cacheResponse.body, {
      status: cacheResponse.status,
      headers: newHeaders
    });
    await cache.put(cacheKey, cachedResponse);
  }

  return response;
}

// Get data for last 30 days (with caching)
async function getData30d(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const symbol = url.searchParams.get('symbol')?.toUpperCase();
  const exchange = url.searchParams.get('exchange') || 'all';

  if (!symbol) {
    return Response.json(
      { success: false, error: 'Missing required parameter: symbol' } as ApiResponse,
      { status: 400, headers: corsHeaders }
    );
  }

  // OPTIMIZATION: Cache responses for 10 minutes to reduce DB load
  const cacheKey = new Request(`https://cache/data/30d/${symbol}/${exchange}`, { method: 'GET' });
  const cache = caches.default;

  let response = await cache.match(cacheKey);
  if (response) {
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => newHeaders.set(key, value));
    newHeaders.set('X-Cache', 'HIT');
    return new Response(response.body, { status: response.status, headers: newHeaders });
  }

  // Cache miss - fetch fresh data
  response = await getDataForTimeRange(env, url, corsHeaders, 720);

  // Cache successful responses for 10 minutes (600 seconds)
  if (response.ok) {
    const cacheResponse = response.clone();
    const newHeaders = new Headers(cacheResponse.headers);
    newHeaders.set('Cache-Control', 'public, max-age=600');
    const cachedResponse = new Response(cacheResponse.body, {
      status: cacheResponse.status,
      headers: newHeaders
    });
    await cache.put(cacheKey, cachedResponse);
  }

  return response;
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

    let result = await env.DB.prepare(query).bind(...params).all<MarketStatsRecord>();

    // Fallback 1: If no data in market_stats, try market_stats_1m (1-minute aggregates, last ~1 hour)
    if (!result.results || result.results.length === 0) {
      const query1m = `
        SELECT
          exchange,
          symbol,
          normalized_symbol,
          avg_mark_price as mark_price,
          avg_index_price as index_price,
          min_price,
          max_price,
          price_volatility,
          volume_base as daily_base_token_volume,
          volume_quote as daily_quote_token_volume,
          avg_open_interest as open_interest,
          avg_open_interest_usd as open_interest_usd,
          max_open_interest_usd,
          avg_funding_rate as funding_rate,
          avg_funding_rate_annual,
          min_funding_rate,
          max_funding_rate,
          minute_timestamp as created_at,
          sample_count,
          created_at as recorded_at
        FROM market_stats_1m
        WHERE exchange = ?
        ${symbol ? 'AND symbol = ?' : ''}
        AND id IN (
          SELECT MAX(id)
          FROM market_stats_1m
          WHERE exchange = ?
          ${symbol ? 'AND symbol = ?' : ''}
          GROUP BY symbol
        )
        ORDER BY symbol
      `;

      result = await env.DB.prepare(query1m).bind(...params).all<MarketStatsRecord>();
    }

    // Fallback 2: If still no data, try market_history (hourly aggregates, permanent storage)
    if (!result.results || result.results.length === 0) {
      const queryHistory = `
        SELECT
          exchange,
          symbol,
          normalized_symbol,
          avg_mark_price as mark_price,
          avg_index_price as index_price,
          min_price,
          max_price,
          price_volatility,
          volume_base as daily_base_token_volume,
          volume_quote as daily_quote_token_volume,
          avg_open_interest as open_interest,
          avg_open_interest_usd as open_interest_usd,
          max_open_interest_usd,
          avg_funding_rate as funding_rate,
          avg_funding_rate_annual,
          min_funding_rate,
          max_funding_rate,
          hour_timestamp as created_at,
          sample_count,
          aggregated_at as recorded_at
        FROM market_history
        WHERE exchange = ?
        ${symbol ? 'AND symbol = ?' : ''}
        AND id IN (
          SELECT MAX(id)
          FROM market_history
          WHERE exchange = ?
          ${symbol ? 'AND symbol = ?' : ''}
          GROUP BY symbol
        )
        ORDER BY symbol
      `;

      result = await env.DB.prepare(queryHistory).bind(...params).all<MarketStatsRecord>();
    }

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
