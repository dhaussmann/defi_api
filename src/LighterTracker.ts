import {
  Env,
  LighterMarket,
  LighterMarketStats,
  LighterSubscribeMessage,
  LighterWebSocketMessage,
  MarketStatsRecord,
} from './types';

export class LighterTracker implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private ws: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private snapshotInterval: number | null = null;
  private statusCheckInterval: number | null = null;
  private pingInterval: number | null = null;
  private dataBuffer: Map<string, LighterMarketStats> = new Map();
  private isConnected = false;
  private reconnectAttempts = 0;
  private messageCount = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly RECONNECT_DELAY = 5000;
  private readonly PING_INTERVAL = 30000; // 30 seconds

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auto-start tracker if not already running (except for stop command)
    if (path !== '/stop' && !this.isConnected) {
      console.log('[LighterTracker] Auto-starting tracker');
      await this.connect().catch((error) => {
        console.error('[LighterTracker] Auto-start failed:', error);
      });
      this.startSnapshotTimer();
      this.startStatusCheck();
    }

    // Handle different commands
    switch (path) {
      case '/start':
        return this.handleStart();
      case '/stop':
        return this.handleStop();
      case '/status':
        return this.handleStatus();
      case '/debug':
        return this.handleDebug();
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  private async handleStart(): Promise<Response> {
    if (this.isConnected) {
      return Response.json({
        success: true,
        message: 'Already connected',
        status: 'running',
      });
    }

    try {
      await this.connect();
      this.startSnapshotTimer();
      this.startStatusCheck();

      return Response.json({
        success: true,
        message: 'WebSocket connection started',
        status: 'running',
      });
    } catch (error) {
      return Response.json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start',
      }, { status: 500 });
    }
  }

  private async handleStop(): Promise<Response> {
    this.disconnect();

    return Response.json({
      success: true,
      message: 'WebSocket connection stopped',
      status: 'stopped',
    });
  }

  private async handleStatus(): Promise<Response> {
    return Response.json({
      success: true,
      data: {
        connected: this.isConnected,
        reconnectAttempts: this.reconnectAttempts,
        bufferSize: this.dataBuffer.size,
        bufferedSymbols: Array.from(this.dataBuffer.keys()),
      },
    });
  }

  private async handleDebug(): Promise<Response> {
    try {
      const markets = await this.fetchAvailableMarkets();

      return Response.json({
        success: true,
        debug: {
          connected: this.isConnected,
          messageCount: this.messageCount,
          bufferSize: this.dataBuffer.size,
          wsReadyState: this.ws?.readyState,
          marketsCount: markets.length,
          sampleMarkets: markets.slice(0, 5),
        },
      });
    } catch (error) {
      return Response.json({
        success: false,
        error: error instanceof Error ? error.message : 'Debug failed',
      }, { status: 500 });
    }
  }

  private async connect(): Promise<void> {
    try {
      // Close existing connection if any
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Fetch available markets from Lighter API
      console.log('[LighterTracker] Fetching available markets...');
      const markets = await this.fetchAvailableMarkets();
      console.log(`[LighterTracker] Found ${markets.length} markets to track`);

      // Create WebSocket connection
      this.ws = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream');

      // Set up event handlers
      this.ws.addEventListener('open', async () => {
        console.log('[LighterTracker] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Subscribe to each market individually with delay to avoid overwhelming the connection
        console.log(`[LighterTracker] Starting to subscribe to ${markets.length} markets...`);

        for (let i = 0; i < markets.length; i++) {
          const market = markets[i];
          const subscribeMsg: LighterSubscribeMessage = {
            type: 'subscribe',
            channel: `market_stats/${market.market_index}`,
          };

          this.ws?.send(JSON.stringify(subscribeMsg));

          // Add small delay every 10 subscriptions to avoid rate limiting
          if ((i + 1) % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
            console.log(`[LighterTracker] Subscribed to ${i + 1}/${markets.length} markets`);
          }
        }

        console.log(`[LighterTracker] Completed subscription to ${markets.length} markets`);

        // Start ping interval to keep connection alive
        this.startPingInterval();

        // Update tracker status in D1
        this.updateTrackerStatus('connected', null);
      });

      this.ws.addEventListener('message', async (event) => {
        this.messageCount++;
        if (this.messageCount % 20 === 0) {
          console.log(`[LighterTracker] Received ${this.messageCount} messages total`);
        }
        await this.handleMessage(event.data);
      });

      this.ws.addEventListener('close', (event) => {
        console.log(`[LighterTracker] WebSocket closed - Code: ${event.code}, Reason: ${event.reason}`);
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.ws.addEventListener('error', (event) => {
        console.error('[LighterTracker] WebSocket error:', event);
        this.updateTrackerStatus('error', 'WebSocket error occurred');
      });

    } catch (error) {
      console.error('[LighterTracker] Connection failed:', error);
      this.isConnected = false;
      throw error;
    }
  }

  private disconnect(): void {
    this.isConnected = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }

    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.updateTrackerStatus('disconnected', null);
  }

  private async fetchAvailableMarkets(): Promise<LighterMarket[]> {
    // Try to fetch from API first
    try {
      const response = await fetch('https://explorer.elliot.ai/api/markets', {
        headers: {
          'accept': 'application/json',
        },
      });

      if (response.ok) {
        const markets: LighterMarket[] = await response.json();
        console.log(`[LighterTracker] Fetched ${markets.length} markets from API`);
        return markets;
      }
    } catch (error) {
      console.warn('[LighterTracker] API fetch failed, using hardcoded markets');
    }

    // Fallback to hardcoded market list
    // This list should be updated periodically when new markets are added
    return this.getHardcodedMarkets();
  }

  private getHardcodedMarkets(): LighterMarket[] {
    // Hardcoded markets list - last updated: 2025-12-18
    // To update: curl https://explorer.elliot.ai/api/markets
    return [
      { symbol: 'ETH', market_index: 0 },
      { symbol: 'BTC', market_index: 1 },
      { symbol: 'SOL', market_index: 2 },
      { symbol: 'DOGE', market_index: 3 },
      { symbol: '1000PEPE', market_index: 4 },
      { symbol: 'WIF', market_index: 5 },
      { symbol: 'SUI', market_index: 6 },
      { symbol: 'LINK', market_index: 7 },
      { symbol: 'ONDO', market_index: 8 },
      { symbol: 'AVAX', market_index: 9 },
      { symbol: 'VIRTUAL', market_index: 10 },
      { symbol: 'DOT', market_index: 11 },
      { symbol: 'TRUMP', market_index: 12 },
      { symbol: 'OM', market_index: 13 },
      { symbol: 'PNUT', market_index: 14 },
      { symbol: 'NEAR', market_index: 15 },
      { symbol: 'PENGU', market_index: 16 },
      { symbol: '1000SHIB', market_index: 17 },
      { symbol: '1000BONK', market_index: 18 },
      { symbol: '1000FLOKI', market_index: 19 },
      { symbol: 'BERA', market_index: 20 },
      { symbol: 'FARTCOIN', market_index: 21 },
      { symbol: 'AI16Z', market_index: 22 },
      { symbol: 'MOVE', market_index: 23 },
      { symbol: 'HYPE', market_index: 24 },
      { symbol: 'BNB', market_index: 25 },
      { symbol: 'JUP', market_index: 26 },
      { symbol: 'AAVE', market_index: 27 },
      { symbol: 'XRP', market_index: 28 },
      { symbol: 'ENA', market_index: 29 },
      { symbol: 'UNI', market_index: 30 },
      { symbol: 'APT', market_index: 31 },
      { symbol: 'LTC', market_index: 32 },
      { symbol: 'USDC', market_index: 33 },
      { symbol: 'IP', market_index: 34 },
      { symbol: 'POL', market_index: 35 },
      { symbol: 'CRV', market_index: 36 },
      { symbol: 'RENDER', market_index: 37 },
      { symbol: 'TIA', market_index: 38 },
      { symbol: 'ADA', market_index: 39 },
      { symbol: 'OP', market_index: 40 },
      { symbol: 'MKR', market_index: 41 },
      { symbol: 'SUSHI', market_index: 42 },
      { symbol: 'TAO', market_index: 43 },
      { symbol: 'STX', market_index: 44 },
      { symbol: 'USDT', market_index: 45 },
      { symbol: 'USDE', market_index: 46 },
      { symbol: 'USDY', market_index: 47 },
      { symbol: 'PYUSD', market_index: 48 },
      { symbol: 'EIGEN', market_index: 49 },
      { symbol: 'ARB', market_index: 50 },
      { symbol: 'MOODENG', market_index: 51 },
      { symbol: 'GRASS', market_index: 52 },
      { symbol: 'ME', market_index: 53 },
      { symbol: 'RAY', market_index: 54 },
      { symbol: 'ORDI', market_index: 55 },
      { symbol: 'SEI', market_index: 56 },
      { symbol: 'WLD', market_index: 57 },
      { symbol: 'BCH', market_index: 58 },
      { symbol: 'HBAR', market_index: 59 },
      { symbol: 'FTM', market_index: 60 },
      { symbol: 'GMX', market_index: 61 },
      { symbol: 'DYDX', market_index: 62 },
      { symbol: 'INJ', market_index: 63 },
      { symbol: 'ETHFI', market_index: 64 },
      { symbol: 'AERO', market_index: 65 },
      { symbol: 'TOSHI', market_index: 66 },
      { symbol: 'POPCAT', market_index: 67 },
      { symbol: 'MELANIA', market_index: 68 },
      { symbol: 'MSTR', market_index: 69 },
      { symbol: 'TSLA', market_index: 70 },
      { symbol: 'NVDA', market_index: 71 },
      { symbol: 'NFLX', market_index: 72 },
      { symbol: 'CRO', market_index: 73 },
      { symbol: 'MOTHER', market_index: 74 },
      { symbol: 'DOLO', market_index: 75 },
      { symbol: 'XLM', market_index: 76 },
      { symbol: 'LAYER', market_index: 77 },
      { symbol: 'KHEOWZOO', market_index: 78 },
      { symbol: 'GOAT', market_index: 79 },
      { symbol: 'RIFAMPICIN', market_index: 80 },
      { symbol: 'ASTER', market_index: 83 },
      { symbol: '0G', market_index: 84 },
      { symbol: 'SWELL', market_index: 85 },
      { symbol: 'APEX', market_index: 86 },
      { symbol: 'FF', market_index: 87 },
      { symbol: '2Z', market_index: 88 },
      { symbol: 'EDEN', market_index: 89 },
      { symbol: 'MW', market_index: 90 },
      { symbol: 'PEAQ', market_index: 91 },
      { symbol: 'EURUSD', market_index: 96 },
      { symbol: 'GBPUSD', market_index: 97 },
      { symbol: 'USDJPY', market_index: 98 },
      { symbol: 'USDCHF', market_index: 99 },
      { symbol: 'USDCAD', market_index: 100 },
      { symbol: 'CC', market_index: 101 },
      { symbol: 'ICP', market_index: 102 },
      { symbol: 'FIL', market_index: 103 },
      { symbol: 'NZDUSD', market_index: 104 },
      { symbol: 'AUDUSD', market_index: 106 },
      { symbol: 'HOOD', market_index: 108 },
      { symbol: 'COIN', market_index: 109 },
      { symbol: 'AAPL', market_index: 113 },
      { symbol: 'AMZN', market_index: 114 },
      { symbol: 'GOOGL', market_index: 116 },
      { symbol: 'RKLB', market_index: 117 },
      { symbol: 'META', market_index: 118 },
      { symbol: 'PLTR', market_index: 119 }
    ];
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('[LighterTracker] Max reconnect attempts reached');
      this.updateTrackerStatus('failed', 'Max reconnect attempts reached');
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    console.log(`[LighterTracker] Scheduling reconnect attempt ${this.reconnectAttempts}`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[LighterTracker] Reconnect failed:', error);
      });
    }, this.RECONNECT_DELAY) as any;
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const message: LighterWebSocketMessage = JSON.parse(data);

      // Handle pong responses
      if (message.type === 'pong') {
        console.log('[LighterTracker] Received pong');
        return;
      }

      // Handle both initial subscription and ongoing updates
      if ((message.type === 'subscribed/market_stats' || message.type === 'update/market_stats')
          && message.market_stats) {
        const stats = message.market_stats;

        // Validate that required fields are present
        if (stats.symbol && stats.market_id !== undefined) {
          this.dataBuffer.set(stats.symbol, stats);

          // Log every 50th update to avoid spam
          if (this.messageCount % 50 === 0) {
            console.log(`[LighterTracker] Buffer size: ${this.dataBuffer.size} markets`);
          }
        } else {
          console.warn('[LighterTracker] Received invalid market stats:', stats);
        }

        // Update last message timestamp
        await this.updateTrackerStatus('running', null);
      }
    } catch (error) {
      console.error('[LighterTracker] Failed to handle message:', error);
    }
  }

  private startSnapshotTimer(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
    }

    const intervalMs = parseInt(this.env.SNAPSHOT_INTERVAL_MS || '15000');

    this.snapshotInterval = setInterval(async () => {
      await this.saveSnapshot();
    }, intervalMs) as any;
  }

  private startStatusCheck(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    // Check status every 30 seconds
    this.statusCheckInterval = setInterval(() => {
      console.log(`[LighterTracker] Status Check - Connected: ${this.isConnected}, Buffer: ${this.dataBuffer.size}, Messages: ${this.messageCount}`);

      if (this.ws) {
        console.log(`[LighterTracker] WebSocket ready state: ${this.ws.readyState} (1=OPEN)`);
      }
    }, 30000) as any;
  }

  private startPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Send ping every 30 seconds to keep connection alive
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log('[LighterTracker] Sending ping to keep connection alive');
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.PING_INTERVAL) as any;
  }

  private async saveSnapshot(): Promise<void> {
    console.log(`[LighterTracker] saveSnapshot called, buffer size: ${this.dataBuffer.size}`);

    if (this.dataBuffer.size === 0) {
      console.log('[LighterTracker] No data to save in snapshot');
      return;
    }

    try {
      const recordedAt = Date.now();
      const records: MarketStatsRecord[] = [];
      console.log('[LighterTracker] Starting to process buffer for snapshot');

      // Convert buffer to records with validation
      for (const [symbol, stats] of this.dataBuffer.entries()) {
        // Validate required fields
        if (!stats.symbol || stats.market_id === undefined) {
          console.warn(`[LighterTracker] Skipping invalid record for ${symbol}`);
          continue;
        }

        // Helper function to provide default values for missing data
        const getValue = (value: any, defaultValue: any) => value !== undefined ? value : defaultValue;

        records.push({
          exchange: 'lighter',
          symbol: stats.symbol,
          market_id: stats.market_id,
          index_price: getValue(stats.index_price, '0'),
          mark_price: getValue(stats.mark_price, '0'),
          open_interest: getValue(stats.open_interest, '0'),
          open_interest_limit: getValue(stats.open_interest_limit, '0'),
          funding_clamp_small: getValue(stats.funding_clamp_small, '0'),
          funding_clamp_big: getValue(stats.funding_clamp_big, '0'),
          last_trade_price: getValue(stats.last_trade_price, '0'),
          current_funding_rate: getValue(stats.current_funding_rate, '0'),
          funding_rate: getValue(stats.funding_rate, '0'),
          funding_timestamp: getValue(stats.funding_timestamp, recordedAt),
          daily_base_token_volume: getValue(stats.daily_base_token_volume, 0),
          daily_quote_token_volume: getValue(stats.daily_quote_token_volume, 0),
          daily_price_low: getValue(stats.daily_price_low, 0),
          daily_price_high: getValue(stats.daily_price_high, 0),
          daily_price_change: getValue(stats.daily_price_change, 0),
          recorded_at: recordedAt,
        });
      }

      if (records.length === 0) {
        console.log('[LighterTracker] No valid records to save');
        return;
      }

      // Batch insert into D1
      const stmt = this.env.DB.prepare(`
        INSERT INTO market_stats (
          exchange, symbol, market_id, index_price, mark_price,
          open_interest, open_interest_limit, funding_clamp_small,
          funding_clamp_big, last_trade_price, current_funding_rate,
          funding_rate, funding_timestamp, daily_base_token_volume,
          daily_quote_token_volume, daily_price_low, daily_price_high,
          daily_price_change, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const batch = records.map((record) =>
        stmt.bind(
          record.exchange,
          record.symbol,
          record.market_id,
          record.index_price,
          record.mark_price,
          record.open_interest,
          record.open_interest_limit,
          record.funding_clamp_small,
          record.funding_clamp_big,
          record.last_trade_price,
          record.current_funding_rate,
          record.funding_rate,
          record.funding_timestamp,
          record.daily_base_token_volume,
          record.daily_quote_token_volume,
          record.daily_price_low,
          record.daily_price_high,
          record.daily_price_change,
          record.recorded_at
        )
      );

      await this.env.DB.batch(batch);

      console.log(`[LighterTracker] Saved snapshot with ${records.length} records`);

      // Clear buffer to free memory
      this.dataBuffer.clear();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[LighterTracker] Failed to save snapshot:', errorMessage);
      console.error('[LighterTracker] Snapshot details - Records count:', records.length);

      // Log first record for debugging
      if (records.length > 0) {
        console.error('[LighterTracker] Sample record:', JSON.stringify(records[0]));
      }

      await this.updateTrackerStatus('error', `Snapshot save failed: ${errorMessage}`);
    }
  }

  private async updateTrackerStatus(status: string, errorMessage: string | null): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);

      await this.env.DB.prepare(`
        UPDATE tracker_status
        SET status = ?,
            last_message_at = ?,
            error_message = ?,
            reconnect_count = ?,
            updated_at = ?
        WHERE exchange = ?
      `).bind(
        status,
        now,
        errorMessage,
        this.reconnectAttempts,
        now,
        'lighter'
      ).run();
    } catch (error) {
      console.error('[LighterTracker] Failed to update tracker status:', error);
    }
  }
}
