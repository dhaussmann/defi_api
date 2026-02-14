import {
  Env,
  PacificaPriceData,
  PacificaWebSocketMessage,
  MarketStatsRecord,
} from './types';

/**
 * PacificaTracker - Durable Object für Pacifica Exchange WebSocket
 *
 * Dieser Tracker verwaltet eine dauerhafte WebSocket-Verbindung zu Pacifica
 * und speichert Market-Statistiken in regelmäßigen Snapshots in die D1 Datenbank.
 *
 * Hauptfunktionen:
 * - WebSocket-Verbindung mit automatischer Reconnect-Logik
 * - Heartbeat alle 30 Sekunden (Connection timeout nach 60s Inaktivität)
 * - Buffering von Market-Daten im Speicher
 * - Regelmäßige Snapshots (alle 15 Sekunden) in die Datenbank
 */
export class PacificaTracker implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  // WebSocket-Verbindung und Timer
  private ws: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private snapshotInterval: number | null = null;
  private statusCheckInterval: number | null = null;
  private heartbeatInterval: number | null = null;

  // Daten-Buffer
  private dataBuffer: Map<string, PacificaPriceData> = new Map();

  // Status-Variablen
  private isConnected = false;
  private reconnectAttempts = 0;
  private messageCount = 0;

  // Konfigurationskonstanten
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly RECONNECT_DELAY = 5000;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 Sekunden (Connection timeout ist 60s)
  private readonly WS_URL = 'wss://ws.pacifica.fi/ws';

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auto-Start
    if (path !== '/stop' && !this.isConnected) {
      console.log('[PacificaTracker] Auto-starting tracker');
      await this.connect().catch((error) => {
        console.error('[PacificaTracker] Auto-start failed:', error);
      });
      this.startSnapshotTimer();
      this.startStatusCheck();
      this.startHeartbeat();
    }

    switch (path) {
      case '/start':
        return this.handleStart();
      case '/stop':
        return this.handleStop();
      case '/status':
        return this.handleStatus();
      case '/data':
        return this.handleData();
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
      this.startHeartbeat();

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

  private async handleData(): Promise<Response> {
    const data = Array.from(this.dataBuffer.values());
    return Response.json({
      success: true,
      data,
    });
  }

  /**
   * Stellt WebSocket-Verbindung her und subscribt zu Preisdaten
   */
  private async connect(): Promise<void> {
    try {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      console.log(`[PacificaTracker] Connecting to WebSocket: ${this.WS_URL}`);
      this.ws = new WebSocket(this.WS_URL);

      this.ws.addEventListener('open', () => {
        console.log('[PacificaTracker] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Subscribe zu Preisdaten
        const subscribeMsg: PacificaWebSocketMessage = {
          method: 'subscribe',
          params: {
            source: 'prices',
          },
        };

        this.ws?.send(JSON.stringify(subscribeMsg));
        console.log('[PacificaTracker] Subscribed to prices source');
        this.updateTrackerStatus('connected', null);
      });

      this.ws.addEventListener('message', async (event) => {
        this.messageCount++;
        if (this.messageCount % 50 === 0) {
          console.log(`[PacificaTracker] Received ${this.messageCount} messages total`);
        }
        await this.handleMessage(event.data);
      });

      this.ws.addEventListener('close', (event) => {
        console.log(`[PacificaTracker] WebSocket closed - Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.ws.addEventListener('error', (event) => {
        console.error('[PacificaTracker] WebSocket error:', event);
        this.updateTrackerStatus('error', 'WebSocket error occurred');
      });

    } catch (error) {
      console.error('[PacificaTracker] Connection failed:', error);
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

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.updateTrackerStatus('disconnected', null);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('[PacificaTracker] Max reconnect attempts reached');
      this.updateTrackerStatus('failed', 'Max reconnect attempts reached');
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    console.log(`[PacificaTracker] Scheduling reconnect attempt ${this.reconnectAttempts}`);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();
        // Nur Timer starten, wenn sie noch nicht laufen
        if (!this.snapshotInterval) {
          this.startSnapshotTimer();
        }
        if (!this.statusCheckInterval) {
          this.startStatusCheck();
        }
        if (!this.heartbeatInterval) {
          this.startHeartbeat();
        }
        console.log('[PacificaTracker] Reconnect successful, timers preserved');
      } catch (error) {
        console.error('[PacificaTracker] Reconnect failed:', error);
      }
    }, this.RECONNECT_DELAY) as any;
  }

  /**
   * Verarbeitet eingehende WebSocket-Nachrichten
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message: any = JSON.parse(data);

      // Prüfen ob es ein Fehler ist
      if (message.code && message.err) {
        console.error(`[PacificaTracker] Server error: ${message.err} (code: ${message.code})`);
        return;
      }

      // Die Daten kommen als { "channel": "prices", "data": [...] }
      if (message.channel === 'prices' && Array.isArray(message.data)) {
        console.log(`[PacificaTracker] Received price data with ${message.data.length} items`);

        for (const priceData of message.data) {
          if (priceData.symbol) {
            this.dataBuffer.set(priceData.symbol, priceData);
          }
        }

        if (this.messageCount % 10 === 0) {
          console.log(`[PacificaTracker] Buffer now contains ${this.dataBuffer.size} symbols`);
        }

        await this.updateTrackerStatus('running', null);
      } else {
        console.log(`[PacificaTracker] Received other message type:`, JSON.stringify(message).substring(0, 100));
      }
    } catch (error) {
      console.error('[PacificaTracker] Failed to handle message:', error);
      console.error('[PacificaTracker] Raw data that failed to parse:', data.substring(0, 500));
    }
  }

  private startSnapshotTimer(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
    }

    const intervalMs = parseInt(this.env.SNAPSHOT_INTERVAL_MS || '15000');
    console.log(`[PacificaTracker] Starting snapshot timer with interval: ${intervalMs}ms`);

    this.snapshotInterval = setInterval(async () => {
      await this.saveSnapshot();
    }, intervalMs) as any;
  }

  private startStatusCheck(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    this.statusCheckInterval = setInterval(() => {
      console.log(`[PacificaTracker] Status Check - Connected: ${this.isConnected}, Buffer: ${this.dataBuffer.size}, Messages: ${this.messageCount}`);

      if (this.ws) {
        console.log(`[PacificaTracker] WebSocket ready state: ${this.ws.readyState} (1=OPEN)`);
      }
    }, 30000) as any;
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Heartbeat alle 30 Sekunden senden (Connection timeout ist 60s)
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log('[PacificaTracker] Sending heartbeat ping');
        // Ping-Message senden
        this.ws.send(JSON.stringify({ method: 'ping' }));
      }
    }, this.HEARTBEAT_INTERVAL) as any;
  }

  /**
   * Speichert aktuellen Buffer-Inhalt als Snapshot in die D1 Datenbank
   */
  private async saveSnapshot(): Promise<void> {
    console.log(`[PacificaTracker] saveSnapshot called, buffer size: ${this.dataBuffer.size}`);

    if (this.dataBuffer.size === 0) {
      console.log('[PacificaTracker] No data to save in snapshot');
      return;
    }

    const records: any[] = [];
    const recordedAt = Date.now();
    const createdAt = Math.floor(recordedAt / 1000);

    console.log('[PacificaTracker] Starting to process buffer for database save');

    for (const [symbol, data] of this.dataBuffer.entries()) {
      if (!data.mark || !symbol) {
        console.warn(`[PacificaTracker] Skipping invalid record for ${symbol}`);
        continue;
      }

      // Open Interest in USD berechnen: OI * mark price
      const openInterestUsd = parseFloat(data.open_interest) * parseFloat(data.mark);

      const record = {
        exchange: 'pacifica',
        symbol: symbol,
        market_id: symbol,
        last_trade_price: data.mark,
        index_price: data.oracle,
        mark_price: data.mark,
        open_interest: data.open_interest,
        open_interest_usd: openInterestUsd.toString(),
        funding_rate: data.funding,
        volume_24h: data.volume_24h,
        created_at: createdAt,
      };

      records.push(record);
    }

    if (records.length === 0) {
      console.log('[PacificaTracker] No valid records to save');
      return;
    }

    try {
      const insertStatements = records.map((record) => {
        return this.env.DB_WRITE.prepare(
          `INSERT INTO market_stats (
            exchange, symbol, market_id, last_trade_price, index_price, mark_price,
            open_interest, open_interest_usd, funding_rate, created_at,
            open_interest_limit, funding_clamp_small, funding_clamp_big,
            current_funding_rate, funding_timestamp, daily_base_token_volume,
            daily_quote_token_volume, daily_price_low, daily_price_high, daily_price_change, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          record.exchange,
          record.symbol,
          0, // market_id as INTEGER
          record.last_trade_price || '0',
          record.index_price || '0',
          record.mark_price || '0',
          record.open_interest || '0',
          record.open_interest_usd || '0',
          record.funding_rate || '0',
          record.created_at,
          '0', // open_interest_limit
          '0', // funding_clamp_small
          '0', // funding_clamp_big
          record.funding_rate || '0', // current_funding_rate
          0, // funding_timestamp
          parseFloat(record.volume_24h || '0'), // daily_base_token_volume (24h volume in USD)
          0, // daily_quote_token_volume
          0, // daily_price_low
          0, // daily_price_high
          0, // daily_price_change
          record.created_at // recorded_at
        );
      });

      await this.env.DB_WRITE.batch(insertStatements);
      console.log(`[PacificaTracker] Saved ${records.length} records to database`);
    } catch (error) {
      console.error('[PacificaTracker] Failed to save snapshot to database:', error);
      throw error;
    }
  }

  private async updateTrackerStatus(status: string, error: string | null): Promise<void> {
    try {
      await this.env.DB_WRITE.prepare(
        `UPDATE tracker_status SET status = ?, error_message = ?, updated_at = ? WHERE exchange = ?`
      )
        .bind(status, error, Math.floor(Date.now() / 1000), 'pacifica')
        .run();
    } catch (err) {
      console.error('[PacificaTracker] Failed to update tracker status:', err);
    }
  }
}
