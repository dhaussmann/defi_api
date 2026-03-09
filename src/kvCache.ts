/**
 * KV Cache Layer for API Responses
 * Caches expensive DB queries in Cloudflare KV with configurable TTL
 * 
 * Cache keys are derived from the request path + query params
 * TTL per endpoint:
 *   /api/v3/funding/rates/bulk  → 60s
 *   /api/v3/funding/ma/bulk     → 300s (5min)
 *   /api/v3/symbols             → 3600s (1h)
 *   /api/v3/arbitrage           → 300s (5min)
 *   /api/v3/funding/summary     → 60s
 *   /api/v3/funding/rates       → 30s
 *   /api/v3/funding/apr         → 60s
 *   /api/v3/funding/ma          → 300s
 *   /api/v3/funding/ma/latest   → 300s
 */

import { Env } from './types';

interface CacheConfig {
  ttl: number;
  prefix: string;
}

const CACHE_CONFIGS: Record<string, CacheConfig> = {
  '/api/v3/funding/rates/latest': { ttl: 60, prefix: 'latest' },
  '/api/v3/funding/rates/bulk': { ttl: 60, prefix: 'bulk-rates' },
  '/api/v3/funding/ma/bulk': { ttl: 3600, prefix: 'bulk-ma' },   // MA changes hourly
  '/api/v3/symbols': { ttl: 3600, prefix: 'symbols' },
  '/api/v3/arbitrage': { ttl: 3600, prefix: 'arb' },             // Arbitrage recalculated hourly
  '/api/v3/funding/summary': { ttl: 60, prefix: 'summary' },
  '/api/v3/funding/rates': { ttl: 60, prefix: 'rates' },
  '/api/v3/funding/apr': { ttl: 60, prefix: 'apr' },
  '/api/v3/funding/ma': { ttl: 3600, prefix: 'ma' },             // MA changes hourly
  '/api/v3/funding/ma/latest': { ttl: 3600, prefix: 'ma-latest' },
  '/api/v3/funding/ma/latest/all': { ttl: 3600, prefix: 'ma-latest-all' },
  // V4 endpoints
  '/api/v4/markets': { ttl: 300, prefix: 'v4-markets' },
  '/api/v4/markets/latest': { ttl: 300, prefix: 'v4-latest' },
  '/api/v4/ma/latest': { ttl: 300, prefix: 'v4-ma-latest' },
  '/api/v4/arbitrage': { ttl: 300, prefix: 'v4-arb' },
};

/**
 * Generate a deterministic cache key from path + sorted query params
 */
function buildCacheKey(path: string, searchParams: URLSearchParams): string | null {
  const config = CACHE_CONFIGS[path];
  if (!config) return null;

  const sortedParams = Array.from(searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  return `${config.prefix}:${sortedParams || '_all'}`;
}

/**
 * Try to get a cached response from KV
 * Returns null on cache miss
 */
export async function getCachedResponse(
  env: Env,
  path: string,
  searchParams: URLSearchParams
): Promise<Response | null> {
  if (!env.CACHE) return null;

  const key = buildCacheKey(path, searchParams);
  if (!key) return null;

  try {
    const cached = await env.CACHE.get(key, 'text');
    if (!cached) return null;

    return new Response(cached, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Cache': 'HIT',
        'X-Cache-Key': key,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Store a response in KV cache
 */
export async function setCachedResponse(
  env: Env,
  path: string,
  searchParams: URLSearchParams,
  responseBody: string
): Promise<void> {
  if (!env.CACHE) return;

  const config = CACHE_CONFIGS[path];
  if (!config) return;

  const key = buildCacheKey(path, searchParams);
  if (!key) return;

  try {
    await env.CACHE.put(key, responseBody, {
      expirationTtl: config.ttl,
    });
  } catch (error) {
    console.error(`[KV Cache] PUT FAILED key=${key}:`, error);
  }
}

/**
 * Wrap an API handler with KV caching
 * Returns cached response if available, otherwise calls handler and caches result
 */
export async function withCache(
  env: Env,
  path: string,
  searchParams: URLSearchParams,
  handler: () => Promise<Response>
): Promise<Response> {
  // Try cache first
  const cached = await getCachedResponse(env, path, searchParams);
  if (cached) return cached;

  // Call original handler
  const response = await handler();

  // Only cache successful responses under 25MB (KV limit)
  if (response.ok) {
    const body = await response.text();

    if (body.length < 25_000_000) {
      await setCachedResponse(env, path, searchParams, body);
    }

    // Return new response with cache MISS header
    return new Response(body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers.entries()),
        'X-Cache': 'MISS',
      },
    });
  }

  return response;
}

/**
 * Warm up KV cache for the most expensive/frequent endpoints
 * Called from cron job to ensure users never hit cold DB queries
 */
export async function warmupCache(env: Env, baseUrl: string): Promise<void> {
  if (!env.CACHE) return;

  const warmupUrls = [
    // Funding rates latest (most-visited)
    '/api/v3/funding/rates/latest?sort=apr&order=desc',
    '/api/v3/funding/rates/latest?sort=symbol&order=asc',
    '/api/v3/symbols',
    // Arbitrage - all periods
    '/api/v3/arbitrage?period=live',
    '/api/v3/arbitrage?period=24h',
    '/api/v3/arbitrage?period=3d',
    '/api/v3/arbitrage?period=7d',
    '/api/v3/arbitrage?period=14d',
    '/api/v3/arbitrage?period=30d',
    '/api/v3/arbitrage?stable=true',
    // MA latest/all - cross-exchange and per-exchange
    '/api/v3/funding/ma/latest/all',
    '/api/v3/funding/ma/latest/all?exchange=*',
    '/api/v3/funding/ma/latest/all?exchange=hyperliquid',
    '/api/v3/funding/ma/latest/all?exchange=extended',
    '/api/v3/funding/ma/latest/all?exchange=aster',
    '/api/v3/funding/ma/latest/all?exchange=paradex',
    '/api/v3/funding/ma/latest/all?exchange=lighter',
    '/api/v3/funding/ma/latest/all?exchange=edgex',
  ];

  // Run all warmup requests in parallel for speed
  const results = await Promise.allSettled(
    warmupUrls.map(async (urlPath) => {
      const response = await fetch(`${baseUrl}${urlPath}`);
      await response.text(); // consume body to avoid connection leak
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    })
  );

  const warmed = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    failed.forEach((f, i) => {
      if (f.status === 'rejected') {
        console.error(`[KV Cache] Warmup failed for ${warmupUrls[i]}: ${f.reason}`);
      }
    });
  }
  console.log(`[KV Cache] Warmed ${warmed}/${warmupUrls.length} endpoints`);
}

/**
 * Invalidate all cache entries with a given prefix
 * Note: KV doesn't support prefix deletion natively,
 * so we rely on TTL expiration for most cases.
 * This function is for manual cache busting if needed.
 */
export async function invalidateCache(env: Env, prefix: string): Promise<void> {
  if (!env.CACHE) return;

  try {
    const list = await env.CACHE.list({ prefix: `${prefix}:` });
    const deletes = list.keys.map(key => env.CACHE.delete(key.name));
    await Promise.all(deletes);
    console.log(`[KV Cache] Invalidated ${list.keys.length} keys with prefix: ${prefix}`);
  } catch (error) {
    console.error(`[KV Cache] Failed to invalidate prefix ${prefix}:`, error);
  }
}
