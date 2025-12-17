import {
  Env,
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
  private dataBuffer: Map<string, LighterMarketStats> = new Map();
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly RECONNECT_DELAY = 5000;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle different commands
    switch (path) {
      case '/start':
        return this.handleStart();
      case '/stop':
        return this.handleStop();
      case '/status':
        return this.handleStatus();
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

  private async connect(): Promise<void> {
    try {
      // Close existing connection if any
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Create WebSocket connection
      this.ws = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream');

      // Set up event handlers
      this.ws.addEventListener('open', () => {
        console.log('[LighterTracker] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Subscribe to market stats for market 0 (ETH)
        const subscribeMsg: LighterSubscribeMessage = {
          type: 'subscribe',
          channel: 'market_stats/0',
        };

        this.ws?.send(JSON.stringify(subscribeMsg));

        // Update tracker status in D1
        this.updateTrackerStatus('connected', null);
      });

      this.ws.addEventListener('message', async (event) => {
        await this.handleMessage(event.data);
      });

      this.ws.addEventListener('close', () => {
        console.log('[LighterTracker] WebSocket closed');
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

    this.updateTrackerStatus('disconnected', null);
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

      if (message.type === 'subscribed/market_stats' && message.market_stats) {
        // Store in buffer with symbol as key
        const stats = message.market_stats;
        this.dataBuffer.set(stats.symbol, stats);

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

  private async saveSnapshot(): Promise<void> {
    if (this.dataBuffer.size === 0) {
      console.log('[LighterTracker] No data to save in snapshot');
      return;
    }

    try {
      const recordedAt = Date.now();
      const records: MarketStatsRecord[] = [];

      // Convert buffer to records
      for (const [symbol, stats] of this.dataBuffer.entries()) {
        records.push({
          exchange: 'lighter',
          symbol: stats.symbol,
          market_id: stats.market_id,
          index_price: stats.index_price,
          mark_price: stats.mark_price,
          open_interest: stats.open_interest,
          open_interest_limit: stats.open_interest_limit,
          funding_clamp_small: stats.funding_clamp_small,
          funding_clamp_big: stats.funding_clamp_big,
          last_trade_price: stats.last_trade_price,
          current_funding_rate: stats.current_funding_rate,
          funding_rate: stats.funding_rate,
          funding_timestamp: stats.funding_timestamp,
          daily_base_token_volume: stats.daily_base_token_volume,
          daily_quote_token_volume: stats.daily_quote_token_volume,
          daily_price_low: stats.daily_price_low,
          daily_price_high: stats.daily_price_high,
          daily_price_change: stats.daily_price_change,
          recorded_at: recordedAt,
        });
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
      console.error('[LighterTracker] Failed to save snapshot:', error);
      await this.updateTrackerStatus('error', `Snapshot save failed: ${error}`);
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
