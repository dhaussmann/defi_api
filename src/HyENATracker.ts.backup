import {
  Env,
  HyperliquidMetaAndAssetCtxs,
  HyperliquidUniverse,
  HyperliquidAssetCtx,
  MarketStatsRecord,
} from './types';

/**
 * HyENATracker - Durable Object für API-basierte Datenabfrage
 *
 * Dieser Tracker verwendet API-Polling statt WebSocket-Verbindungen
 * und speichert Market-Statistiken in regelmäßigen Snapshots in die D1 Datenbank.
 *
 * Hauptfunktionen:
 * - API-Polling alle 15 Sekunden (synchron mit Snapshot-Intervall)
 * - Zeitgesteuerte Abfragen um Timestamps auf :00, :15, :30, :45 zu erreichen
 * - Automatische Speicherung in Datenbank nach jedem Poll
 * - Mapping von universe-Array zu assetCtxs-Array über Index
 */
export class HyENATracker implements DurableObject {
  // Durable Object State und Environment
  private state: DurableObjectState;
  private env: Env;

  // Timer
  private pollingInterval: number | null = null;
  private statusCheckInterval: number | null = null;

  // Daten-Buffer
  private dataBuffer: Map<string, { universe: HyperliquidUniverse; assetCtx: HyperliquidAssetCtx }> = new Map();

  // Status-Variablen
  private isRunning = false;
  private pollCount = 0;
  private lastPollTime = 0;
  private lastSuccessfulPoll = 0;

  // Konfigurationskonstanten
  private readonly POLL_INTERVAL = 15000; // 15 Sekunden - synchron mit Snapshot-Intervall
  private readonly API_URL = 'https://api.hyperliquid.xyz/info';

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

    // Auto-Start: Tracker automatisch starten, wenn nicht aktiv (außer bei /stop)
    if (path !== '/stop' && !this.isRunning) {
      console.log('[HyENATracker] Auto-starting tracker');
      await this.start().catch((error) => {
        console.error('[HyENATracker] Auto-start failed:', error);
      });
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
    if (this.isRunning) {
      return Response.json({
        success: true,
        message: 'Already running',
        status: 'running',
      });
    }

    try {
      await this.start();

      return Response.json({
        success: true,
        message: 'Polling started',
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
    this.stop();

    return Response.json({
      success: true,
      message: 'Polling stopped',
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
        running: this.isRunning,
        pollCount: this.pollCount,
        bufferSize: this.dataBuffer.size,
        bufferedSymbols: Array.from(this.dataBuffer.keys()),
        lastPollTime: this.lastPollTime,
        lastSuccessfulPoll: this.lastSuccessfulPoll,
      },
    });
  }

  /**
   * Handler für /debug - Erweiterte Debug-Informationen
   */
  private async handleDebug(): Promise<Response> {
    return Response.json({
      success: true,
      debug: {
        running: this.isRunning,
        pollCount: this.pollCount,
        bufferSize: this.dataBuffer.size,
        bufferedSymbols: Array.from(this.dataBuffer.keys()).slice(0, 10),
        lastPollTime: this.lastPollTime,
        lastSuccessfulPoll: this.lastSuccessfulPoll,
        timeSinceLastPoll: Date.now() - this.lastPollTime,
        nextPollIn: this.isRunning ? this.POLL_INTERVAL - (Date.now() - this.lastPollTime) : null,
      },
    });
  }

  /**
   * Startet den Polling-Mechanismus
   * Verwendet zeitgesteuerte Abfragen um auf :00, :15, :30, :45 zu synchronisieren
   */
  private async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log('[HyENATracker] Starting polling mechanism');

    // Erste Abfrage sofort durchführen
    await this.pollAndSave();

    // Status-Check Timer starten
    this.startStatusCheck();

    // Polling-Interval starten
    // Berechne Zeit bis zur nächsten :00, :15, :30 oder :45 Sekunde
    this.scheduleNextPoll();

    // Status in Datenbank aktualisieren
    await this.updateTrackerStatus('running', null);
  }

  /**
   * Berechnet und plant den nächsten Poll um auf :00, :15, :30, :45 zu synchronisieren
   */
  private scheduleNextPoll(): void {
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
    }

    const now = new Date();
    const currentSeconds = now.getSeconds();
    const currentMs = now.getMilliseconds();

    // Berechne Sekunden bis zur nächsten 15-Sekunden-Marke
    const targetSeconds = [0, 15, 30, 45];
    let nextTargetSeconds = targetSeconds.find(s => s > currentSeconds) || 60;

    let secondsUntilNext: number;
    if (nextTargetSeconds === 60) {
      // Nächste Minute, 0 Sekunden
      secondsUntilNext = 60 - currentSeconds;
      nextTargetSeconds = 0;
    } else {
      secondsUntilNext = nextTargetSeconds - currentSeconds;
    }

    // Millisekunden bis zum nächsten Poll
    const msUntilNext = (secondsUntilNext * 1000) - currentMs;

    console.log(`[HyENATracker] Next poll scheduled in ${msUntilNext}ms (at :${nextTargetSeconds.toString().padStart(2, '0')})`);

    this.pollingInterval = setTimeout(async () => {
      await this.pollAndSave();
      // Nach jedem Poll den nächsten planen
      this.scheduleNextPoll();
    }, msUntilNext) as any;
  }

  /**
   * Stoppt den Polling-Mechanismus
   */
  private stop(): void {
    this.isRunning = false;

    // Alle Timer aufräumen
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }

    this.updateTrackerStatus('stopped', null);
    console.log('[HyENATracker] Polling stopped');
  }

  /**
   * Führt API-Abfrage durch und speichert Daten direkt
   *
   * Ablauf:
   * 1. API aufrufen (metaAndAssetCtxs mit dex: "hyna")
   * 2. universe-Array und assetCtxs-Array über Index mappen
   * 3. Buffer füllen
   * 4. Sofort in Datenbank speichern
   * 5. Buffer leeren
   */
  private async pollAndSave(): Promise<void> {
    this.lastPollTime = Date.now();
    this.pollCount++;

    console.log(`[HyENATracker] Poll #${this.pollCount} starting...`);

    try {
      // API aufrufen - HyENA verwendet dex: "hyna" Parameter
      const response = await fetch(this.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'metaAndAssetCtxs',
          dex: 'hyna',
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();

      // API gibt Array zurück: [0] = meta mit universe, [1] = assetCtxs array
      if (!Array.isArray(responseData) || responseData.length !== 2) {
        throw new Error('Invalid API response: expected array with 2 elements');
      }

      const meta = responseData[0];
      const assetCtxs = responseData[1];

      // Validierung
      if (!meta.universe || !Array.isArray(assetCtxs)) {
        throw new Error('Invalid API response: missing universe or assetCtxs');
      }

      const universe = meta.universe;

      if (universe.length !== assetCtxs.length) {
        console.warn(`[HyENATracker] Array length mismatch: universe=${universe.length}, assetCtxs=${assetCtxs.length}`);
      }

      // Buffer füllen - universe und assetCtxs über Index mappen
      this.dataBuffer.clear();
      const maxLength = Math.min(universe.length, assetCtxs.length);

      for (let i = 0; i < maxLength; i++) {
        const universeItem = universe[i];
        const assetCtx = assetCtxs[i];

        if (universeItem && assetCtx && universeItem.name) {
          // Symbol mit hyna: Prefix versehen (nur wenn nicht bereits vorhanden)
          const rawSymbol = universeItem.name;
          const symbol = rawSymbol.startsWith('hyna:') ? rawSymbol : `hyna:${rawSymbol}`;
          this.dataBuffer.set(symbol, { universe: universeItem, assetCtx });
        }
      }

      console.log(`[HyENATracker] Poll #${this.pollCount} fetched ${this.dataBuffer.size} assets`);

      // Sofort speichern
      await this.saveToDatabase();

      this.lastSuccessfulPoll = Date.now();
      await this.updateTrackerStatus('running', null);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[HyENATracker] Poll #${this.pollCount} failed:`, errorMessage);
      await this.updateTrackerStatus('error', `Poll failed: ${errorMessage}`);
    }
  }

  /**
   * Speichert Buffer-Inhalt in die D1 Datenbank
   *
   * Wird direkt nach jedem erfolgreichen Poll aufgerufen
   */
  private async saveToDatabase(): Promise<void> {
    if (this.dataBuffer.size === 0) {
      console.log('[HyENATracker] No data to save');
      return;
    }

    let records: MarketStatsRecord[] = [];

    try {
      const recordedAt = Date.now();
      console.log('[HyENATracker] Starting to process buffer for database save');

      // Buffer zu Records konvertieren
      for (const [symbol, data] of this.dataBuffer.entries()) {
        const { universe, assetCtx } = data;

        // Helper-Funktion: Default-Werte für fehlende Felder
        const getValue = (value: any, defaultValue: any) => value !== undefined && value !== null ? value : defaultValue;

        // Market ID aus Symbol generieren (Hash-Funktion)
        const marketId = this.getMarketIdForSymbol(symbol);

        // Open Interest USD berechnen: OI * mark_price
        const markPrice = parseFloat(getValue(assetCtx.markPx, '0'));
        const openInterest = parseFloat(getValue(assetCtx.openInterest, '0'));
        const openInterestUsd = (markPrice * openInterest).toString();

        records.push({
          exchange: 'hyena',
          symbol: symbol,
          market_id: marketId,
          index_price: getValue(assetCtx.oraclePx, '0'),
          mark_price: getValue(assetCtx.markPx, '0'),
          open_interest: getValue(assetCtx.openInterest, '0'),
          open_interest_usd: openInterestUsd,
          open_interest_limit: '0', // HyENA hat dieses Feld nicht
          funding_clamp_small: '0', // HyENA hat dieses Feld nicht
          funding_clamp_big: '0', // HyENA hat dieses Feld nicht
          last_trade_price: getValue(assetCtx.midPx, '0'),
          current_funding_rate: getValue(assetCtx.funding, '0'),
          funding_rate: getValue(assetCtx.funding, '0'),
          funding_timestamp: recordedAt,
          daily_base_token_volume: parseFloat(getValue(assetCtx.dayNtlVlm, '0')),
          daily_quote_token_volume: parseFloat(getValue(assetCtx.dayNtlVlm, '0')),
          daily_price_low: 0, // HyENA hat dieses Feld nicht direkt
          daily_price_high: 0, // HyENA hat dieses Feld nicht direkt
          daily_price_change: assetCtx.prevDayPx && assetCtx.markPx
            ? ((parseFloat(assetCtx.markPx) - parseFloat(assetCtx.prevDayPx)) / parseFloat(assetCtx.prevDayPx))
            : 0,
          recorded_at: recordedAt,
        });
      }

      if (records.length === 0) {
        console.log('[HyENATracker] No valid records to save');
        return;
      }

      // Batch-Insert in D1 Database
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

      console.log(`[HyENATracker] ✅ Saved ${records.length} records to database`);

      // Buffer leeren
      this.dataBuffer.clear();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[HyENATracker] ❌ Failed to save to database:', errorMessage);
      console.error('[HyENATracker] Records count:', records.length);

      if (records.length > 0) {
        console.error('[HyENATracker] Sample record:', JSON.stringify(records[0]));
      }

      await this.updateTrackerStatus('error', `Database save failed: ${errorMessage}`);
    }
  }

  /**
   * Startet den Status-Check Timer
   * Loggt Status-Informationen alle 30 Sekunden für Monitoring
   */
  private startStatusCheck(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    this.statusCheckInterval = setInterval(() => {
      console.log(`[HyENATracker] Status Check - Running: ${this.isRunning}, Buffer: ${this.dataBuffer.size}, Polls: ${this.pollCount}`);
      console.log(`[HyENATracker] Last poll: ${new Date(this.lastPollTime).toISOString()}`);
    }, 30000) as any;
  }

  /**
   * Generiert eine Market ID für ein Symbol (Simple Hash-Funktion)
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
        0, // HyENA hat keine Reconnects, immer 0
        now,
        'hyena'
      ).run();
    } catch (error) {
      console.error('[HyENATracker] Failed to update tracker status:', error);
    }
  }
}
