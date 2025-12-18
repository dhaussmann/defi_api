import { LighterTracker } from './LighterTracker';
import { ParadexTracker } from './ParadexTracker';
import { Env, ApiResponse, MarketStatsQuery, MarketStatsRecord } from './types';

export { LighterTracker, ParadexTracker };

export default {
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
    default:
      return new Response('API endpoint not found', {
        status: 404,
        headers: corsHeaders,
      });
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

// Get tracker status
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
  <p>WebSocket-basierter Tracker für Crypto-Börsen mit Cloudflare Workers & Durable Objects</p>
  <p><strong>Unterstützte Börsen:</strong> Lighter, Paradex</p>

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

# Neueste Stats von Lighter abrufen
curl https://your-worker.workers.dev/api/latest?exchange=lighter

# Neueste Stats von Paradex abrufen
curl https://your-worker.workers.dev/api/latest?exchange=paradex

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
