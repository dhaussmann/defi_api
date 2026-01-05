import {
  Env,
  EdgeXContract,
  EdgeXTickerData,
  EdgeXSubscribeMessage,
  EdgeXWebSocketMessage,
  MarketStatsRecord,
} from './types';

/**
 * EdgeXTracker - Durable Object für persistente WebSocket-Verbindung
 *
 * Dieser Tracker verwaltet eine dauerhafte WebSocket-Verbindung zum EdgeX Exchange
 * und speichert Market-Statistiken in regelmäßigen Snapshots in die D1 Datenbank.
 *
 * Hauptfunktionen:
 * - WebSocket-Verbindung mit automatischer Reconnect-Logik
 * - Buffering von Market-Daten im Speicher
 * - Regelmäßige Snapshots (alle 15 Sekunden) in die Datenbank
 * - Caching der verfügbaren Contracts (60 Minuten)
 * - Subscription für jeden Contract einzeln (ticker.{contractId})
 */
export class EdgeXTracker implements DurableObject {
  // Durable Object State und Environment
  private state: DurableObjectState;
  private env: Env;

  // WebSocket-Verbindung und Timer
  private ws: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private snapshotInterval: number | null = null;
  private statusCheckInterval: number | null = null;
  private contractsFetchInterval: number | null = null;
  private pingInterval: number | null = null;

  // Daten-Buffer und Caches
  private dataBuffer: Map<string, EdgeXTickerData> = new Map();
  private cachedContracts: EdgeXContract[] = [];
  private lastContractsFetch: number = 0;

  // Status-Variablen
  private isConnected = false;
  private reconnectAttempts = 0;
  private messageCount = 0;

  // Konfigurationskonstanten
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly RECONNECT_DELAY = 5000;
  private readonly CONTRACTS_REFRESH_INTERVAL = 3600000; // 60 Minuten
  private readonly PING_INTERVAL = 30000; // 30 Sekunden
  private readonly WS_URL = 'wss://quote.edgex.exchange/api/v1/public/ws';
  private readonly METADATA_URL = 'https://pro.edgex.exchange/api/v1/public/meta/getMetaData';

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Haupt-Handler für eingehende Requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auto-Start
    if (path !== '/stop' && !this.isConnected) {
      console.log('[EdgeXTracker] Auto-starting tracker');
      await this.connect().catch((error) => {
        console.error('[EdgeXTracker] Auto-start failed:', error);
      });
      this.startSnapshotTimer();
      this.startStatusCheck();
      this.startPingInterval();
    }

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
      this.startPingInterval();

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
      const contracts = await this.fetchAvailableContracts();

      return Response.json({
        success: true,
        debug: {
          connected: this.isConnected,
          messageCount: this.messageCount,
          bufferSize: this.dataBuffer.size,
          bufferedSymbols: Array.from(this.dataBuffer.keys()).slice(0, 10),
          wsReadyState: this.ws?.readyState,
          availableContractsCount: contracts.length,
          sampleContracts: contracts.slice(0, 5),
        },
      });
    } catch (error) {
      return Response.json({
        success: false,
        error: error instanceof Error ? error.message : 'Debug failed',
        debug: {
          connected: this.isConnected,
          messageCount: this.messageCount,
          bufferSize: this.dataBuffer.size,
          bufferedSymbols: Array.from(this.dataBuffer.keys()).slice(0, 10),
          wsReadyState: this.ws?.readyState,
        },
      });
    }
  }

  /**
   * Stellt WebSocket-Verbindung her und subscribt zu allen Contracts
   */
  private async connect(): Promise<void> {
    try {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Contracts von API holen
      console.log('[EdgeXTracker] Fetching available contracts...');
      const contracts = await this.fetchAvailableContracts();
      console.log(`[EdgeXTracker] Found ${contracts.length} contracts to track`);

      // WebSocket-Verbindung erstellen
      console.log(`[EdgeXTracker] Connecting to WebSocket: ${this.WS_URL}`);
      this.ws = new WebSocket(this.WS_URL);

      this.ws.addEventListener('open', async () => {
        console.log('[EdgeXTracker] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Zu jedem Contract subscriben
        console.log(`[EdgeXTracker] Starting to subscribe to ${contracts.length} contracts...`);

        for (let i = 0; i < contracts.length; i++) {
          const contract = contracts[i];
          const subscribeMsg: EdgeXSubscribeMessage = {
            type: 'subscribe',
            channel: `ticker.${contract.contractId}`,
          };

          this.ws?.send(JSON.stringify(subscribeMsg));

          // 50ms Delay zwischen Subscriptions
          if (i < contracts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          if ((i + 1) % 20 === 0) {
            console.log(`[EdgeXTracker] Subscribed to ${i + 1}/${contracts.length} contracts`);
          }
        }

        console.log(`[EdgeXTracker] Completed subscription to ${contracts.length} contracts`);
        this.updateTrackerStatus('connected', null);
      });

      this.ws.addEventListener('message', async (event) => {
        this.messageCount++;
        if (this.messageCount % 20 === 0) {
          console.log(`[EdgeXTracker] Received ${this.messageCount} messages total`);
        }
        await this.handleMessage(event.data);
      });

      this.ws.addEventListener('close', (event) => {
        console.log(`[EdgeXTracker] WebSocket closed - Code: ${event.code}, Reason: ${event.reason}`);
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.ws.addEventListener('error', (event) => {
        console.error('[EdgeXTracker] WebSocket error:', event);
        this.updateTrackerStatus('error', 'WebSocket error occurred');
      });

    } catch (error) {
      console.error('[EdgeXTracker] Connection failed:', error);
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

    if (this.contractsFetchInterval) {
      clearInterval(this.contractsFetchInterval);
      this.contractsFetchInterval = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.updateTrackerStatus('disconnected', null);
  }

  /**
   * Holt verfügbare Contracts von der EdgeX API mit Caching
   */
  private async fetchAvailableContracts(): Promise<EdgeXContract[]> {
    const now = Date.now();

    if (this.cachedContracts.length > 0 && (now - this.lastContractsFetch) < this.CONTRACTS_REFRESH_INTERVAL) {
      console.log(`[EdgeXTracker] Using cached contracts (${this.cachedContracts.length} contracts, cached ${Math.round((now - this.lastContractsFetch) / 60000)} minutes ago)`);
      return this.cachedContracts;
    }

    try {
      console.log('[EdgeXTracker] Fetching fresh contracts from API...');
      const response = await fetch(this.METADATA_URL, {
        headers: {
          'accept': 'application/json',
          'user-agent': 'Mozilla/5.0 (compatible; EdgeXTracker/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch contracts: ${response.status}`);
      }

      const data = await response.json();
      const allContracts: EdgeXContract[] = data.data?.contractList || [];

      // Nur aktive Contracts
      const activeContracts = allContracts.filter(c => c.enableTrade && c.enableDisplay);

      console.log(`[EdgeXTracker] Fetched ${allContracts.length} contracts from API, filtered to ${activeContracts.length} active contracts`);

      this.cachedContracts = activeContracts;
      this.lastContractsFetch = now;

      return activeContracts;
    } catch (error) {
      console.error('[EdgeXTracker] Failed to fetch contracts:', error);

      if (this.cachedContracts.length > 0) {
        console.log(`[EdgeXTracker] Using expired cache as fallback (${this.cachedContracts.length} contracts)`);
        return this.cachedContracts;
      }

      throw error;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('[EdgeXTracker] Max reconnect attempts reached');
      this.updateTrackerStatus('failed', 'Max reconnect attempts reached');
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    console.log(`[EdgeXTracker] Scheduling reconnect attempt ${this.reconnectAttempts}`);

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
        if (!this.pingInterval) {
          this.startPingInterval();
        }
        console.log('[EdgeXTracker] Reconnect successful, timers preserved');
      } catch (error) {
        console.error('[EdgeXTracker] Reconnect failed:', error);
      }
    }, this.RECONNECT_DELAY) as any;
  }

  /**
   * Verarbeitet eingehende WebSocket-Nachrichten
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message: EdgeXWebSocketMessage = JSON.parse(data);

      // Ping vom Server - mit Pong antworten
      if (message.type === 'ping') {
        console.log('[EdgeXTracker] Received ping from server, sending pong');
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'pong' }));
        }
        return;
      }

      // Pong-Antwort auf unseren Ping
      if (message.type === 'pong') {
        console.log('[EdgeXTracker] Received pong');
        return;
      }

      // Quote-Event mit Ticker-Daten
      if (message.type === 'quote-event' && message.content?.data) {
        for (const tickerData of message.content.data) {
          if (tickerData.contractName) {
            this.dataBuffer.set(tickerData.contractName, tickerData);

            if (this.messageCount % 50 === 0) {
              console.log(`[EdgeXTracker] Buffer size: ${this.dataBuffer.size} contracts`);
            }
          }
        }

        await this.updateTrackerStatus('running', null);
      }
    } catch (error) {
      console.error('[EdgeXTracker] Failed to handle message:', error);
    }
  }

  private startSnapshotTimer(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
    }

    const intervalMs = parseInt(this.env.SNAPSHOT_INTERVAL_MS || '15000');
    console.log(`[EdgeXTracker] Starting snapshot timer with interval: ${intervalMs}ms`);

    this.snapshotInterval = setInterval(async () => {
      await this.saveSnapshot();
    }, intervalMs) as any;
  }

  private startStatusCheck(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    this.statusCheckInterval = setInterval(() => {
      console.log(`[EdgeXTracker] Status Check - Connected: ${this.isConnected}, Buffer: ${this.dataBuffer.size}, Messages: ${this.messageCount}`);

      if (this.ws) {
        console.log(`[EdgeXTracker] WebSocket ready state: ${this.ws.readyState} (1=OPEN)`);
      }
    }, 30000) as any;
  }

  private startPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Ping alle 30 Sekunden senden um Verbindung aufrecht zu erhalten
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log('[EdgeXTracker] Sending ping to keep connection alive');
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.PING_INTERVAL) as any;
  }

  /**
   * Speichert aktuellen Buffer-Inhalt als Snapshot in die D1 Datenbank
   */
  private async saveSnapshot(): Promise<void> {
    console.log(`[EdgeXTracker] saveSnapshot called, buffer size: ${this.dataBuffer.size}`);

    if (this.dataBuffer.size === 0) {
      console.log('[EdgeXTracker] No data to save in snapshot');
      return;
    }

    let records: MarketStatsRecord[] = [];

    try {
      const recordedAt = Date.now();
      console.log('[EdgeXTracker] Starting to process buffer for snapshot');

      for (const [symbol, ticker] of this.dataBuffer.entries()) {
        if (!ticker.contractName || !ticker.contractId) {
          console.warn(`[EdgeXTracker] Skipping invalid record for ${symbol}`);
          continue;
        }

        const getValue = (value: any, defaultValue: any) => value !== undefined && value !== null ? value : defaultValue;

        // Market ID aus contractId parsen
        const marketId = parseInt(ticker.contractId);

        // Daily price change berechnen
        const open = parseFloat(getValue(ticker.open, '0'));
        const close = parseFloat(getValue(ticker.close, '0'));
        const dailyPriceChange = open > 0 ? ((close - open) / open) : 0;

        // Open Interest USD berechnen: OI * mark_price
        const markPrice = parseFloat(getValue(ticker.lastPrice, '0'));
        const openInterest = parseFloat(getValue(ticker.openInterest, '0'));
        const openInterestUsd = (markPrice * openInterest).toString();

        records.push({
          exchange: 'edgex',
          symbol: ticker.contractName,
          market_id: marketId,
          index_price: getValue(ticker.indexPrice, '0'),
          mark_price: getValue(ticker.lastPrice, '0'),
          open_interest: getValue(ticker.openInterest, '0'),
          open_interest_usd: openInterestUsd,
          open_interest_limit: '0',
          funding_clamp_small: '0',
          funding_clamp_big: '0',
          last_trade_price: getValue(ticker.lastPrice, '0'),
          current_funding_rate: getValue(ticker.fundingRate, '0'),
          funding_rate: getValue(ticker.fundingRate, '0'),
          funding_timestamp: parseInt(getValue(ticker.fundingTime, '0')),
          daily_base_token_volume: parseFloat(getValue(ticker.size, '0')),
          daily_quote_token_volume: parseFloat(getValue(ticker.value, '0')),
          daily_price_low: parseFloat(getValue(ticker.low, '0')),
          daily_price_high: parseFloat(getValue(ticker.high, '0')),
          daily_price_change: dailyPriceChange,
          recorded_at: recordedAt,
        });
      }

      if (records.length === 0) {
        console.log('[EdgeXTracker] No valid records to save');
        return;
      }

      const createdAt = Math.floor(recordedAt / 1000);
      const stmt = this.env.DB.prepare(`
        INSERT INTO market_stats (
          exchange, symbol, market_id, index_price, mark_price,
          open_interest, open_interest_usd, open_interest_limit, funding_clamp_small,
          funding_clamp_big, last_trade_price, current_funding_rate,
          funding_rate, funding_timestamp, daily_base_token_volume,
          daily_quote_token_volume, daily_price_low, daily_price_high,
          daily_price_change, recorded_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const batch = records.map((record) =>
        stmt.bind(
          record.exchange,
          record.symbol,
          record.market_id,
          record.index_price,
          record.mark_price,
          record.open_interest,
          record.open_interest_usd,
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
          record.recorded_at,
          createdAt
        )
      );

      await this.env.DB.batch(batch);

      console.log(`[EdgeXTracker] Saved snapshot with ${records.length} records`);

      this.dataBuffer.clear();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[EdgeXTracker] Failed to save snapshot:', errorMessage);
      console.error('[EdgeXTracker] Snapshot details - Records count:', records.length);

      if (records.length > 0) {
        console.error('[EdgeXTracker] Sample record:', JSON.stringify(records[0]));
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
        'edgex'
      ).run();
    } catch (error) {
      console.error('[EdgeXTracker] Failed to update tracker status:', error);
    }
  }
}
