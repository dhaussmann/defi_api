import {
  Env,
  ParadexMarket,
  ParadexMarketData,
  ParadexSubscribeMessage,
  ParadexWebSocketMessage,
  MarketStatsRecord,
} from './types';

/**
 * ParadexTracker - Durable Object für Paradex Exchange WebSocket-Verbindung
 *
 * Vereinfachte Implementierung mit stabilem WebSocket-Handling:
 * - WebSocket-Verbindung zu markets_summary Channel
 * - Regelmäßige Snapshots (alle 15 Sekunden) in die Datenbank
 * - Automatisches Reconnect bei Verbindungsabbruch
 * - Kein komplexes Ping/Pong-Handling - einfaches Reconnect alle 45 Sekunden
 */
export class ParadexTracker implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  // WebSocket und Timer
  private ws: WebSocket | null = null;
  private snapshotInterval: number | null = null;
  private reconnectInterval: number | null = null;
  private statusCheckInterval: number | null = null;

  // Daten-Buffer
  private dataBuffer: Map<string, ParadexMarketData> = new Map();
  private cachedMarkets: ParadexMarket[] = [];
  private lastMarketsFetch: number = 0;

  // Status
  private isConnected = false;
  private messageCount = 0;
  private messageIdCounter = 1;

  // Konfiguration
  private readonly MARKETS_CACHE_MS = 3600000; // 60 Minuten
  private readonly RECONNECT_INTERVAL_MS = 45000; // 45 Sekunden (vor 60s Paradex timeout)
  private readonly API_BASE = 'https://api.prod.paradex.trade/v1';
  private readonly WS_URL = 'wss://ws.api.prod.paradex.trade/v1';

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auto-Start
    if (path !== '/stop' && !this.isConnected) {
      console.log('[ParadexTracker] Auto-starting tracker');
      await this.start().catch((error) => {
        console.error('[ParadexTracker] Auto-start failed:', error);
      });
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
      await this.start();
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
    this.stop();
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
        messageCount: this.messageCount,
        bufferSize: this.dataBuffer.size,
        bufferedSymbols: Array.from(this.dataBuffer.keys()).slice(0, 10),
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
          bufferedSymbols: Array.from(this.dataBuffer.keys()).slice(0, 10),
          wsReadyState: this.ws?.readyState,
          availableMarketsCount: markets.length,
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

  /**
   * Startet den Tracker
   */
  private async start(): Promise<void> {
    console.log('[ParadexTracker] Starting tracker');

    // WebSocket verbinden
    await this.connect();

    // Snapshot Timer starten (alle 15 Sekunden)
    this.startSnapshotTimer();

    // Status Check Timer
    this.startStatusCheck();

    // Reconnect Timer (alle 45 Sekunden präventiv reconnecten)
    this.startReconnectTimer();

    await this.updateTrackerStatus('running', null);
  }

  /**
   * Stoppt den Tracker
   */
  private stop(): void {
    console.log('[ParadexTracker] Stopping tracker');
    this.isConnected = false;

    // WebSocket schließen
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Alle Timer stoppen
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }

    this.dataBuffer.clear();
    this.updateTrackerStatus('stopped', null);
  }

  /**
   * Baut WebSocket-Verbindung auf
   */
  private async connect(): Promise<void> {
    try {
      console.log('[ParadexTracker] Connecting to WebSocket...');

      // Markets laden
      const markets = await this.fetchAvailableMarkets();
      console.log(`[ParadexTracker] Found ${markets.length} PERP markets`);

      // Alte Verbindung schließen
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Neue WebSocket-Verbindung
      this.ws = new WebSocket(this.WS_URL);

      // Event: Verbindung aufgebaut
      this.ws.addEventListener('open', () => {
        console.log('[ParadexTracker] WebSocket connected');
        this.isConnected = true;

        // Subscribe to markets_summary
        const subscribeMsg: ParadexSubscribeMessage = {
          jsonrpc: '2.0',
          method: 'subscribe',
          params: {
            channel: 'markets_summary',
          },
          id: this.messageIdCounter++,
        };

        this.ws?.send(JSON.stringify(subscribeMsg));
        console.log('[ParadexTracker] Subscribed to markets_summary');

        this.updateTrackerStatus('connected', null);
      });

      // Event: Nachricht empfangen
      this.ws.addEventListener('message', async (event) => {
        this.messageCount++;
        if (this.messageCount % 50 === 0) {
          console.log(`[ParadexTracker] Received ${this.messageCount} messages`);
        }
        await this.handleMessage(event.data);
      });

      // Event: Verbindung geschlossen
      this.ws.addEventListener('close', (event) => {
        console.log(`[ParadexTracker] WebSocket closed - Code: ${event.code}`);
        this.isConnected = false;
        // Kein explizites Reconnect hier - der reconnectInterval macht das
      });

      // Event: Fehler
      this.ws.addEventListener('error', (event) => {
        console.error('[ParadexTracker] WebSocket error:', event);
        this.isConnected = false;
      });

    } catch (error) {
      console.error('[ParadexTracker] Connect failed:', error);
      throw error;
    }
  }

  /**
   * Verarbeitet WebSocket-Nachrichten
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message: ParadexWebSocketMessage = JSON.parse(data);

      // Subscription Confirmation
      if (message.result && message.id) {
        console.log('[ParadexTracker] Subscription confirmed');
        return;
      }

      // Market Data Updates
      if (message.params && message.params.channel === 'markets_summary' && message.params.data) {
        const marketData = message.params.data as ParadexMarketData;

        // Nur PERP Markets
        if (!marketData.symbol || !marketData.symbol.includes('PERP')) {
          return;
        }

        // In Buffer speichern
        this.dataBuffer.set(marketData.symbol, marketData);
      }
    } catch (error) {
      console.error('[ParadexTracker] Failed to parse message:', error);
    }
  }

  /**
   * Holt verfügbare Markets von der API
   */
  private async fetchAvailableMarkets(): Promise<ParadexMarket[]> {
    const now = Date.now();

    // Cache prüfen
    if (this.cachedMarkets.length > 0 && now - this.lastMarketsFetch < this.MARKETS_CACHE_MS) {
      return this.cachedMarkets;
    }

    console.log('[ParadexTracker] Fetching markets from API...');
    const response = await fetch(`${this.API_BASE}/markets`);
    const data = await response.json() as any;

    if (!data.results || !Array.isArray(data.results)) {
      throw new Error('Invalid markets response');
    }

    // Nur PERP Markets
    const perpMarkets = data.results.filter((m: any) => m.asset_kind === 'PERP') as ParadexMarket[];

    console.log(`[ParadexTracker] Fetched ${perpMarkets.length} PERP markets`);

    this.cachedMarkets = perpMarkets;
    this.lastMarketsFetch = now;

    return perpMarkets;
  }

  /**
   * Startet Snapshot Timer
   */
  private startSnapshotTimer(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
    }

    const intervalMs = parseInt(this.env.SNAPSHOT_INTERVAL_MS || '15000');
    console.log(`[ParadexTracker] Starting snapshot timer (${intervalMs}ms)`);

    this.snapshotInterval = setInterval(async () => {
      console.log('[ParadexTracker] Snapshot timer triggered');
      await this.saveSnapshot();
    }, intervalMs) as any;
  }

  /**
   * Startet Status Check Timer
   */
  private startStatusCheck(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    this.statusCheckInterval = setInterval(() => {
      console.log(`[ParadexTracker] Status - Connected: ${this.isConnected}, Buffer: ${this.dataBuffer.size}, Messages: ${this.messageCount}`);
    }, 30000) as any;
  }

  /**
   * Startet Reconnect Timer (präventiv alle 45s)
   */
  private startReconnectTimer(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }

    console.log(`[ParadexTracker] Starting reconnect timer (${this.RECONNECT_INTERVAL_MS}ms)`);

    this.reconnectInterval = setInterval(async () => {
      console.log('[ParadexTracker] Preventive reconnect triggered');

      // Snapshot speichern vor Reconnect
      await this.saveSnapshot();

      // Reconnect
      await this.connect();

      console.log('[ParadexTracker] Preventive reconnect completed');
    }, this.RECONNECT_INTERVAL_MS) as any;
  }

  /**
   * Speichert Snapshot in Datenbank
   */
  private async saveSnapshot(): Promise<void> {
    console.log(`[ParadexTracker] saveSnapshot called, buffer size: ${this.dataBuffer.size}`);

    if (this.dataBuffer.size === 0) {
      console.log('[ParadexTracker] No data to save');
      return;
    }

    let records: MarketStatsRecord[] = [];

    try {
      const recordedAt = Date.now();
      console.log('[ParadexTracker] Processing buffer for snapshot');

      // Helper für sichere Werte
      const getValue = (val: any, defaultVal: string = '0'): string => {
        if (val === null || val === undefined || val === '') return defaultVal;
        return String(val);
      };

      // Buffer zu Records konvertieren
      for (const [symbol, data] of this.dataBuffer.entries()) {
        if (!data.symbol) {
          continue;
        }

        // Market ID generieren
        const marketId = this.getMarketIdForSymbol(symbol);

        // Open Interest USD berechnen
        const markPrice = parseFloat(getValue(data.mark_price, '0'));
        const openInterest = parseFloat(getValue(data.open_interest, '0'));
        const openInterestUsd = (markPrice * openInterest).toString();

        records.push({
          exchange: 'paradex',
          symbol: data.symbol,
          market_id: marketId,
          index_price: getValue(data.underlying_price, '0'),
          mark_price: getValue(data.mark_price, '0'),
          open_interest: getValue(data.open_interest, '0'),
          open_interest_usd: openInterestUsd,
          open_interest_limit: '0',
          funding_clamp_small: '0',
          funding_clamp_big: '0',
          last_trade_price: getValue(data.last_traded_price, '0'),
          current_funding_rate: getValue(data.funding_rate, '0'),
          funding_rate: getValue(data.future_funding_rate, getValue(data.funding_rate, '0')),
          funding_timestamp: parseFloat(getValue(data.created_at, String(recordedAt))),
          daily_base_token_volume: parseFloat(getValue(data.volume_24h, '0')),
          daily_quote_token_volume: parseFloat(getValue(data.total_volume, '0')),
          daily_price_low: 0,
          daily_price_high: 0,
          daily_price_change: parseFloat(getValue(data.price_change_rate_24h, '0')),
          recorded_at: recordedAt,
        });
      }

      if (records.length === 0) {
        console.log('[ParadexTracker] No valid records to save');
        return;
      }

      // Batch Insert
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

      console.log(`[ParadexTracker] ✅ Saved ${records.length} records to database`);

      // Buffer leeren
      this.dataBuffer.clear();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ParadexTracker] ❌ Failed to save snapshot:', errorMessage);
      if (records.length > 0) {
        console.error('[ParadexTracker] Sample record:', JSON.stringify(records[0]));
      }
      await this.updateTrackerStatus('error', `Snapshot save failed: ${errorMessage}`);
    }
  }

  /**
   * Generiert Market ID aus Symbol
   */
  private getMarketIdForSymbol(symbol: string): number {
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
      const char = symbol.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Aktualisiert Tracker-Status in Datenbank
   */
  private async updateTrackerStatus(status: string, error: string | null): Promise<void> {
    try {
      await this.env.DB.prepare(
        `UPDATE tracker_status SET status = ?, error_message = ?, updated_at = ? WHERE exchange = ?`
      )
        .bind(status, error, Math.floor(Date.now() / 1000), 'paradex')
        .run();
    } catch (err) {
      console.error('[ParadexTracker] Failed to update tracker status:', err);
    }
  }
}
