import {
  Env,
  ParadexMarket,
  ParadexMarketData,
  ParadexSubscribeMessage,
  ParadexWebSocketMessage,
  MarketStatsRecord,
} from './types';

/**
 * ParadexTracker - Durable Object für persistente WebSocket-Verbindung
 *
 * Dieser Tracker verwaltet eine dauerhafte WebSocket-Verbindung zum Paradex Exchange
 * und speichert Market-Statistiken in regelmäßigen Snapshots in die D1 Datenbank.
 *
 * Hauptfunktionen:
 * - WebSocket-Verbindung mit automatischer Reconnect-Logik
 * - Buffering von Market-Daten im Speicher
 * - Regelmäßige Snapshots (alle 15 Sekunden) in die Datenbank
 * - Caching der verfügbaren Markets (60 Minuten)
 * - Keep-Alive via Ping/Pong (JSON-RPC 2.0)
 */
export class ParadexTracker implements DurableObject {
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
  private dataBuffer: Map<string, ParadexMarketData> = new Map(); // Zwischenspeicher für Market-Daten
  private cachedMarkets: ParadexMarket[] = []; // Cache für verfügbare Markets
  private lastMarketsFetch: number = 0; // Timestamp des letzten Market-Fetch

  // Status-Variablen
  private isConnected = false;
  private reconnectAttempts = 0;
  private messageCount = 0;
  private messageIdCounter = 1; // JSON-RPC Message ID Counter

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
      console.log('[ParadexTracker] Auto-starting tracker');
      await this.connect().catch((error) => {
        console.error('[ParadexTracker] Auto-start failed:', error);
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
   * Stellt WebSocket-Verbindung zum Paradex Exchange her
   *
   * Ablauf:
   * 1. Alte Verbindung schließen (falls vorhanden)
   * 2. Markets von API abrufen (mit Caching, nur PERP)
   * 3. WebSocket-Verbindung aufbauen
   * 4. Event-Handler registrieren
   * 5. Nach Verbindungsaufbau: Zu markets_summary Channel subscriben
   * 6. Ping-Interval starten für Keep-Alive
   */
  private async connect(): Promise<void> {
    try {
      // Alte Verbindung aufräumen
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }

      // Markets von API holen (verwendet Cache wenn verfügbar, nur PERP)
      console.log('[ParadexTracker] Fetching available PERP markets...');
      const markets = await this.fetchAvailableMarkets();
      console.log(`[ParadexTracker] Found ${markets.length} PERP markets to track`);

      // WebSocket-Verbindung zu Paradex erstellen
      this.ws = new WebSocket('wss://ws.api.prod.paradex.trade/v1');

      // Event Handler: Verbindung aufgebaut
      this.ws.addEventListener('open', async () => {
        console.log('[ParadexTracker] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Zu markets_summary Channel subscriben (JSON-RPC 2.0)
        const subscribeMsg: ParadexSubscribeMessage = {
          jsonrpc: '2.0',
          method: 'subscribe',
          params: {
            channel: 'markets_summary',
          },
          id: this.messageIdCounter++,
        };

        this.ws?.send(JSON.stringify(subscribeMsg));
        console.log('[ParadexTracker] Subscribed to markets_summary channel');

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
          console.log(`[ParadexTracker] Received ${this.messageCount} messages total`);
        }
        await this.handleMessage(event.data);
      });

      // Event Handler: Verbindung geschlossen
      this.ws.addEventListener('close', (event) => {
        console.log(`[ParadexTracker] WebSocket closed - Code: ${event.code}, Reason: ${event.reason}`);
        this.isConnected = false;
        // Automatisch Reconnect versuchen
        this.scheduleReconnect();
      });

      // Event Handler: Fehler
      this.ws.addEventListener('error', (event) => {
        console.error('[ParadexTracker] WebSocket error:', event);
        this.updateTrackerStatus('error', 'WebSocket error occurred');
      });

    } catch (error) {
      console.error('[ParadexTracker] Connection failed:', error);
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
   * Holt verfügbare Markets von der Paradex API mit Caching
   * Filtert nur PERP-Märkte (asset_kind === 'PERP')
   *
   * Cache-Strategie:
   * - Cache ist 60 Minuten gültig
   * - Bei Fehler: Verwende alten Cache als Fallback
   * - Reduziert API-Calls und verbessert Performance
   */
  private async fetchAvailableMarkets(): Promise<ParadexMarket[]> {
    const now = Date.now();

    // Cache verwenden wenn vorhanden und noch nicht abgelaufen
    if (this.cachedMarkets.length > 0 && (now - this.lastMarketsFetch) < this.MARKETS_REFRESH_INTERVAL) {
      console.log(`[ParadexTracker] Using cached markets (${this.cachedMarkets.length} PERP markets, cached ${Math.round((now - this.lastMarketsFetch) / 60000)} minutes ago)`);
      return this.cachedMarkets;
    }

    try {
      // Frische Markets von API holen
      console.log('[ParadexTracker] Fetching fresh markets from API...');
      const response = await fetch('https://api.prod.paradex.trade/v1/markets', {
        headers: {
          'accept': 'application/json',
          'user-agent': 'Mozilla/5.0 (compatible; ParadexTracker/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch markets: ${response.status}`);
      }

      const data = await response.json();
      const allMarkets: ParadexMarket[] = data.results || data;

      // Nur PERP-Märkte filtern
      const perpMarkets = allMarkets.filter(market => market.asset_kind === 'PERP');
      console.log(`[ParadexTracker] Fetched ${allMarkets.length} markets from API, filtered to ${perpMarkets.length} PERP markets`);

      // Cache aktualisieren
      this.cachedMarkets = perpMarkets;
      this.lastMarketsFetch = now;

      return perpMarkets;
    } catch (error) {
      console.error('[ParadexTracker] Failed to fetch markets:', error);

      // Fallback: Alten Cache verwenden auch wenn abgelaufen
      if (this.cachedMarkets.length > 0) {
        console.log(`[ParadexTracker] Using expired cache as fallback (${this.cachedMarkets.length} PERP markets)`);
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
      console.error('[ParadexTracker] Max reconnect attempts reached');
      this.updateTrackerStatus('failed', 'Max reconnect attempts reached');
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    console.log(`[ParadexTracker] Scheduling reconnect attempt ${this.reconnectAttempts}`);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();

        // WICHTIG: Timer nach Reconnect neu starten!
        // Ohne dies würden nach einem Reconnect keine Snapshots mehr gespeichert
        this.startSnapshotTimer();
        this.startStatusCheck();
        console.log('[ParadexTracker] Reconnect successful, timers restarted');
      } catch (error) {
        console.error('[ParadexTracker] Reconnect failed:', error);
      }
    }, this.RECONNECT_DELAY) as any;
  }

  /**
   * Verarbeitet eingehende WebSocket-Nachrichten (JSON-RPC 2.0)
   *
   * Nachrichten-Typen:
   * - result: Subscription erfolgreich
   * - subscription: Daten vom markets_summary Channel
   * - error: Fehler vom Server
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const message: ParadexWebSocketMessage = JSON.parse(data);

      // Subscription erfolgreich
      if (message.id && message.result !== undefined) {
        console.log('[ParadexTracker] Subscription confirmed:', message.result);
        return;
      }

      // Fehler-Nachricht
      if (message.error) {
        console.error('[ParadexTracker] Server error:', message.error);
        return;
      }

      // Market-Daten verarbeiten (subscription method mit markets_summary)
      if (message.method === 'subscription' && message.params?.channel === 'markets_summary' && message.params.data) {
        const data = message.params.data;

        // Validierung: Pflichtfelder müssen vorhanden sein
        if (data.symbol) {
          // NUR PERP-Märkte speichern: Prüfen ob Symbol in unserer gefilterten Liste ist
          const isPerpMarket = this.cachedMarkets.some(market => market.symbol === data.symbol);

          if (isPerpMarket) {
            // In Buffer speichern - überschreibt alte Werte für selbes Symbol
            this.dataBuffer.set(data.symbol, data);

            // Logging alle 50 Updates um Spam zu vermeiden
            if (this.messageCount % 50 === 0) {
              console.log(`[ParadexTracker] Buffer size: ${this.dataBuffer.size} PERP markets`);
            }
          } else {
            // Symbol ist kein PERP-Markt, überspringen
            if (this.messageCount % 100 === 0) {
              console.log(`[ParadexTracker] Skipping non-PERP market: ${data.symbol}`);
            }
          }
        } else {
          console.warn('[ParadexTracker] Received invalid market data:', data);
        }

        // Timestamp der letzten Nachricht aktualisieren
        await this.updateTrackerStatus('running', null);
      }
    } catch (error) {
      console.error('[ParadexTracker] Failed to handle message:', error);
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
      console.log(`[ParadexTracker] Status Check - Connected: ${this.isConnected}, Buffer: ${this.dataBuffer.size}, Messages: ${this.messageCount}`);

      if (this.ws) {
        console.log(`[ParadexTracker] WebSocket ready state: ${this.ws.readyState} (1=OPEN)`);
      }
    }, 30000) as any;
  }

  /**
   * Startet den Ping-Interval für Keep-Alive
   * Sendet alle 30 Sekunden einen Ping an den Server (JSON-RPC 2.0)
   */
  private startPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Ping alle 30 Sekunden senden
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log('[ParadexTracker] Sending ping to keep connection alive');
        // JSON-RPC 2.0 Ping - Paradex könnte eine ping method oder heartbeat erwarten
        const pingMsg = {
          jsonrpc: '2.0',
          method: 'ping',
          id: this.messageIdCounter++,
        };
        this.ws.send(JSON.stringify(pingMsg));
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
    console.log(`[ParadexTracker] saveSnapshot called, buffer size: ${this.dataBuffer.size}`);

    if (this.dataBuffer.size === 0) {
      console.log('[ParadexTracker] No data to save in snapshot');
      return;
    }

    // Variable außerhalb des try-Blocks deklarieren, damit sie im catch-Block verfügbar ist
    let records: MarketStatsRecord[] = [];

    try {
      const recordedAt = Date.now();
      console.log('[ParadexTracker] Starting to process buffer for snapshot');

      // Buffer zu Records konvertieren mit Validierung
      for (const [symbol, data] of this.dataBuffer.entries()) {
        // Pflichtfelder validieren
        if (!data.symbol) {
          console.warn(`[ParadexTracker] Skipping invalid record for ${symbol}`);
          continue;
        }

        // Helper-Funktion: Default-Werte für fehlende Felder
        const getValue = (value: any, defaultValue: any) => value !== undefined && value !== null ? value : defaultValue;

        // Paradex hat keine market_id, wir verwenden einen Hash oder Index
        const marketId = this.getMarketIdForSymbol(symbol);

        records.push({
          exchange: 'paradex',
          symbol: data.symbol,
          market_id: marketId,
          index_price: getValue(data.underlying_price, '0'),
          mark_price: getValue(data.mark_price, '0'),
          open_interest: getValue(data.open_interest, '0'),
          open_interest_limit: '0', // Paradex hat dieses Feld nicht
          funding_clamp_small: '0', // Paradex hat dieses Feld nicht
          funding_clamp_big: '0', // Paradex hat dieses Feld nicht
          last_trade_price: getValue(data.last_traded_price, '0'),
          current_funding_rate: getValue(data.funding_rate, '0'),
          funding_rate: getValue(data.future_funding_rate, getValue(data.funding_rate, '0')),
          funding_timestamp: getValue(data.created_at, recordedAt),
          daily_base_token_volume: parseFloat(getValue(data.volume_24h, '0')),
          daily_quote_token_volume: parseFloat(getValue(data.total_volume, '0')),
          daily_price_low: 0, // Paradex hat dieses Feld nicht direkt
          daily_price_high: 0, // Paradex hat dieses Feld nicht direkt
          daily_price_change: parseFloat(getValue(data.price_change_rate_24h, '0')),
          recorded_at: recordedAt,
        });
      }

      if (records.length === 0) {
        console.log('[ParadexTracker] No valid records to save');
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

      console.log(`[ParadexTracker] Saved snapshot with ${records.length} records`);

      // Buffer leeren um Speicher freizugeben
      // Wichtig: Neue Daten werden ab jetzt wieder gesammelt
      this.dataBuffer.clear();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ParadexTracker] Failed to save snapshot:', errorMessage);
      console.error('[ParadexTracker] Snapshot details - Records count:', records.length);

      // Ersten Record für Debugging ausgeben
      if (records.length > 0) {
        console.error('[ParadexTracker] Sample record:', JSON.stringify(records[0]));
      }

      await this.updateTrackerStatus('error', `Snapshot save failed: ${errorMessage}`);
    }
  }

  /**
   * Generiert eine Market ID für ein Symbol (Simple Hash-Funktion)
   * Da Paradex keine market_id bereitstellt, erstellen wir eine aus dem Symbol
   */
  private getMarketIdForSymbol(symbol: string): number {
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
      const char = symbol.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
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
        'paradex'
      ).run();
    } catch (error) {
      console.error('[ParadexTracker] Failed to update tracker status:', error);
    }
  }
}
