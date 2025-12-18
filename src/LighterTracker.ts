import {
  Env,
  LighterMarket,
  LighterMarketStats,
  LighterSubscribeMessage,
  LighterWebSocketMessage,
  MarketStatsRecord,
} from './types';

/**
 * LighterTracker - Durable Object für persistente WebSocket-Verbindung
 *
 * Dieser Tracker verwaltet eine dauerhafte WebSocket-Verbindung zum Lighter Exchange
 * und speichert Market-Statistiken in regelmäßigen Snapshots in die D1 Datenbank.
 *
 * Hauptfunktionen:
 * - WebSocket-Verbindung mit automatischer Reconnect-Logik
 * - Buffering von Market-Daten im Speicher
 * - Regelmäßige Snapshots (alle 15 Sekunden) in die Datenbank
 * - Caching der verfügbaren Markets (60 Minuten)
 * - Keep-Alive via Ping/Pong
 */
export class LighterTracker implements DurableObject {
  // Durable Object State und Environment
  private state: DurableObjectState;
  private env: Env;

  // WebSocket-Verbindung und Timer
  private ws: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private snapshotInterval: number | null = null;
  private statusCheckInterval: number | null = null;
  private pingInterval: number | null = null;
  private marketsFetchInterval: number | null = null;

  // Daten-Buffer und Caches
  private dataBuffer: Map<string, LighterMarketStats> = new Map(); // Zwischenspeicher für Market-Daten
  private cachedMarkets: LighterMarket[] = []; // Cache für verfügbare Markets
  private lastMarketsFetch: number = 0; // Timestamp des letzten Market-Fetch

  // Status-Variablen
  private isConnected = false;
  private reconnectAttempts = 0;
  private messageCount = 0;

  // Konfigurationskonstanten
  private readonly MAX_RECONNECT_ATTEMPTS = 10; // Maximale Anzahl an Reconnect-Versuchen
  private readonly RECONNECT_DELAY = 5000; // 5 Sekunden Wartezeit zwischen Reconnects
  private readonly PING_INTERVAL = 30000; // 30 Sekunden - Ping-Intervall für Keep-Alive
  private readonly MARKETS_REFRESH_INTERVAL = 3600000; // 60 Minuten - Markets-Cache Laufzeit

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Haupt-Handler für eingehende Requests
   * Implementiert Auto-Start-Mechanismus und Route-Handling
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auto-Start: Tracker automatisch starten, wenn nicht verbunden (außer bei /stop)
    // Dies stellt sicher, dass der Tracker bei jedem Request aktiv ist
    if (path !== '/stop' && !this.isConnected) {
      console.log('[LighterTracker] Auto-starting tracker');
      await this.connect().catch((error) => {
        console.error('[LighterTracker] Auto-start failed:', error);
      });
      this.startSnapshotTimer();
      this.startStatusCheck();
    }

    // Route-Handling für verschiedene Befehle
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

  /**
   * Handler für /start - Startet den Tracker manuell
   */
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

  /**
   * Handler für /stop - Stoppt den Tracker
   */
  private async handleStop(): Promise<Response> {
    this.disconnect();

    return Response.json({
      success: true,
      message: 'WebSocket connection stopped',
      status: 'stopped',
    });
  }

  /**
   * Handler für /status - Gibt aktuellen Status zurück
   */
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

  /**
   * Handler für /debug - Erweiterte Debug-Informationen
   * Zeigt zusätzlich verfügbare Markets und WebSocket ReadyState
   */
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
   * Stellt WebSocket-Verbindung zum Lighter Exchange her
   *
   * Ablauf:
   * 1. Alte Verbindung schließen (falls vorhanden)
   * 2. Markets von API abrufen (mit Caching)
   * 3. WebSocket-Verbindung aufbauen
   * 4. Event-Handler registrieren
   * 5. Nach Verbindungsaufbau: Alle Markets einzeln subscriben
   * 6. Ping-Interval starten für Keep-Alive
   */
  private async connect(): Promise<void> {
    try {
      // Alte Verbindung aufräumen
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Markets von API holen (verwendet Cache wenn verfügbar)
      console.log('[LighterTracker] Fetching available markets...');
      const markets = await this.fetchAvailableMarkets();
      console.log(`[LighterTracker] Found ${markets.length} markets to track`);

      // WebSocket-Verbindung zu Lighter erstellen
      this.ws = new WebSocket('wss://mainnet.zklighter.elliot.ai/stream');

      // Event Handler: Verbindung aufgebaut
      this.ws.addEventListener('open', async () => {
        console.log('[LighterTracker] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Zu jedem Market einzeln subscriben mit Delays um Server nicht zu überlasten
        console.log(`[LighterTracker] Starting to subscribe to ${markets.length} markets...`);

        for (let i = 0; i < markets.length; i++) {
          const market = markets[i];
          const subscribeMsg: LighterSubscribeMessage = {
            type: 'subscribe',
            channel: `market_stats/${market.market_index}`,
          };

          this.ws?.send(JSON.stringify(subscribeMsg));

          // 50ms Delay zwischen jeder Subscription um Rate-Limiting zu vermeiden
          if (i < markets.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          // Progress-Logging alle 20 Subscriptions
          if ((i + 1) % 20 === 0) {
            console.log(`[LighterTracker] Subscribed to ${i + 1}/${markets.length} markets`);
          }
        }

        console.log(`[LighterTracker] Completed subscription to ${markets.length} markets`);

        // Keep-Alive Ping-Mechanismus starten
        this.startPingInterval();

        // Status in Datenbank aktualisieren
        this.updateTrackerStatus('connected', null);
      });

      // Event Handler: Nachricht empfangen
      this.ws.addEventListener('message', async (event) => {
        this.messageCount++;
        // Logging alle 20 Nachrichten um Log-Spam zu vermeiden
        if (this.messageCount % 20 === 0) {
          console.log(`[LighterTracker] Received ${this.messageCount} messages total`);
        }
        await this.handleMessage(event.data);
      });

      // Event Handler: Verbindung geschlossen
      this.ws.addEventListener('close', (event) => {
        console.log(`[LighterTracker] WebSocket closed - Code: ${event.code}, Reason: ${event.reason}`);
        this.isConnected = false;
        // Automatisch Reconnect versuchen
        this.scheduleReconnect();
      });

      // Event Handler: Fehler
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

  /**
   * Trennt WebSocket-Verbindung und räumt alle Timer auf
   */
  private disconnect(): void {
    this.isConnected = false;

    // WebSocket schließen
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Alle Timer aufräumen
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

    if (this.marketsFetchInterval) {
      clearInterval(this.marketsFetchInterval);
      this.marketsFetchInterval = null;
    }

    this.updateTrackerStatus('disconnected', null);
  }

  /**
   * Holt verfügbare Markets von der Lighter API mit Caching
   *
   * Cache-Strategie:
   * - Cache ist 60 Minuten gültig
   * - Bei Fehler: Verwende alten Cache als Fallback
   * - Reduziert API-Calls und verbessert Performance
   */
  private async fetchAvailableMarkets(): Promise<LighterMarket[]> {
    const now = Date.now();

    // Cache verwenden wenn vorhanden und noch nicht abgelaufen
    if (this.cachedMarkets.length > 0 && (now - this.lastMarketsFetch) < this.MARKETS_REFRESH_INTERVAL) {
      console.log(`[LighterTracker] Using cached markets (${this.cachedMarkets.length} markets, cached ${Math.round((now - this.lastMarketsFetch) / 60000)} minutes ago)`);
      return this.cachedMarkets;
    }

    try {
      // Frische Markets von API holen
      console.log('[LighterTracker] Fetching fresh markets from API...');
      const response = await fetch('https://explorer.elliot.ai/api/markets', {
        headers: {
          'accept': 'application/json',
          'user-agent': 'Mozilla/5.0 (compatible; LighterTracker/1.0)', // User-Agent um 403 zu vermeiden
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch markets: ${response.status}`);
      }

      const markets: LighterMarket[] = await response.json();
      console.log(`[LighterTracker] Fetched ${markets.length} markets from API`);

      // Cache aktualisieren
      this.cachedMarkets = markets;
      this.lastMarketsFetch = now;

      return markets;
    } catch (error) {
      console.error('[LighterTracker] Failed to fetch markets:', error);

      // Fallback: Alten Cache verwenden auch wenn abgelaufen
      if (this.cachedMarkets.length > 0) {
        console.log(`[LighterTracker] Using expired cache as fallback (${this.cachedMarkets.length} markets)`);
        return this.cachedMarkets;
      }

      throw error;
    }
  }

  /**
   * Plant einen Reconnect-Versuch mit exponentieller Verzögerung
   *
   * Wichtig: Nach erfolgreichem Reconnect werden auch die Timer neu gestartet!
   * Dies war ein kritischer Bug-Fix - ohne Timer-Restart wurden keine Snapshots mehr gespeichert.
   */
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

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();

        // WICHTIG: Timer nach Reconnect neu starten!
        // Ohne dies würden nach einem Reconnect keine Snapshots mehr gespeichert
        this.startSnapshotTimer();
        this.startStatusCheck();
        console.log('[LighterTracker] Reconnect successful, timers restarted');
      } catch (error) {
        console.error('[LighterTracker] Reconnect failed:', error);
      }
    }, this.RECONNECT_DELAY) as any;
  }

  /**
   * Verarbeitet eingehende WebSocket-Nachrichten
   *
   * Nachrichten-Typen:
   * - ping: Server sendet Ping → wir antworten mit Pong (Keep-Alive)
   * - pong: Antwort auf unseren Ping
   * - subscribed/market_stats: Initiale Daten nach Subscription
   * - update/market_stats: Laufende Updates (wichtigster Typ!)
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message: LighterWebSocketMessage = JSON.parse(data);

      // Server-Ping → Pong antworten (Keep-Alive, verhindert "no pong" Error!)
      if (message.type === 'ping') {
        console.log('[LighterTracker] Received ping from server, sending pong');
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'pong' }));
        }
        return;
      }

      // Pong-Antwort auf unseren Ping
      if (message.type === 'pong') {
        console.log('[LighterTracker] Received pong');
        return;
      }

      // Market-Statistiken verarbeiten (initiale Subscription UND laufende Updates!)
      if ((message.type === 'subscribed/market_stats' || message.type === 'update/market_stats')
          && message.market_stats) {
        const stats = message.market_stats;

        // Validierung: Pflichtfelder müssen vorhanden sein
        if (stats.symbol && stats.market_id !== undefined) {
          // In Buffer speichern - überschreibt alte Werte für selbes Symbol
          this.dataBuffer.set(stats.symbol, stats);

          // Logging alle 50 Updates um Spam zu vermeiden
          if (this.messageCount % 50 === 0) {
            console.log(`[LighterTracker] Buffer size: ${this.dataBuffer.size} markets`);
          }
        } else {
          console.warn('[LighterTracker] Received invalid market stats:', stats);
        }

        // Timestamp der letzten Nachricht aktualisieren
        await this.updateTrackerStatus('running', null);
      }
    } catch (error) {
      console.error('[LighterTracker] Failed to handle message:', error);
    }
  }

  /**
   * Startet den Snapshot-Timer
   * Speichert gepufferte Daten alle 15 Sekunden in die Datenbank
   */
  private startSnapshotTimer(): void {
    // Alten Timer clearen falls vorhanden (verhindert Duplikate)
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
    }

    const intervalMs = parseInt(this.env.SNAPSHOT_INTERVAL_MS || '15000');

    this.snapshotInterval = setInterval(async () => {
      await this.saveSnapshot();
    }, intervalMs) as any;
  }

  /**
   * Startet den Status-Check Timer
   * Loggt Status-Informationen alle 30 Sekunden für Monitoring
   */
  private startStatusCheck(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    // Status-Check alle 30 Sekunden
    this.statusCheckInterval = setInterval(() => {
      console.log(`[LighterTracker] Status Check - Connected: ${this.isConnected}, Buffer: ${this.dataBuffer.size}, Messages: ${this.messageCount}`);

      if (this.ws) {
        console.log(`[LighterTracker] WebSocket ready state: ${this.ws.readyState} (1=OPEN)`);
      }
    }, 30000) as any;
  }

  /**
   * Startet den Ping-Interval für Keep-Alive
   * Sendet alle 30 Sekunden einen Ping an den Server
   */
  private startPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Ping alle 30 Sekunden senden
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log('[LighterTracker] Sending ping to keep connection alive');
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.PING_INTERVAL) as any;
  }

  /**
   * Speichert aktuellen Buffer-Inhalt als Snapshot in die D1 Datenbank
   *
   * Ablauf:
   * 1. Buffer in Records konvertieren mit Validierung
   * 2. Default-Werte für fehlende Felder setzen
   * 3. Batch-Insert in D1 (performanter als einzelne Inserts)
   * 4. Buffer leeren um Speicher freizugeben
   *
   * Wichtig: Buffer wird nach jedem Snapshot geleert!
   * Dies verhindert Memory-Probleme bei langem Laufzeit
   */
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

      // Buffer zu Records konvertieren mit Validierung
      for (const [symbol, stats] of this.dataBuffer.entries()) {
        // Pflichtfelder validieren
        if (!stats.symbol || stats.market_id === undefined) {
          console.warn(`[LighterTracker] Skipping invalid record for ${symbol}`);
          continue;
        }

        // Helper-Funktion: Default-Werte für fehlende Felder
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

      // Batch-Insert in D1 Database (performanter als einzelne Inserts)
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

      // Buffer leeren um Speicher freizugeben
      // Wichtig: Neue Daten werden ab jetzt wieder gesammelt
      this.dataBuffer.clear();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[LighterTracker] Failed to save snapshot:', errorMessage);
      console.error('[LighterTracker] Snapshot details - Records count:', records.length);

      // Ersten Record für Debugging ausgeben
      if (records.length > 0) {
        console.error('[LighterTracker] Sample record:', JSON.stringify(records[0]));
      }

      await this.updateTrackerStatus('error', `Snapshot save failed: ${errorMessage}`);
    }
  }

  /**
   * Aktualisiert den Tracker-Status in der Datenbank
   * Wird verwendet für Monitoring und Status-Abfragen
   */
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
