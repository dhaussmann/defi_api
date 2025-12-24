import {
  Env,
  AsterSymbol,
  AsterExchangeInfo,
  AsterPremiumIndex,
  AsterFundingInfo,
  AsterOpenInterest,
  MarketStatsRecord,
} from './types';

/**
 * AsterTracker - Durable Object für Aster Exchange API Polling
 *
 * Dieser Tracker verwendet API-Polling statt WebSocket:
 * - Alle 60 Sekunden werden die Marktdaten für alle PERPETUAL Contracts abgerufen
 * - Verwendet mehrere API-Endpunkte: premiumIndex, fundingInfo, openInterest, klines
 * - Speichert Snapshots alle 15 Sekunden in die Datenbank
 */
export class AsterTracker implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  // Polling und Timer
  private pollingInterval: number | null = null;
  private snapshotInterval: number | null = null;
  private statusCheckInterval: number | null = null;

  // Daten-Buffer und Caches
  private dataBuffer: Map<string, any> = new Map();
  private cachedSymbols: AsterSymbol[] = [];
  private lastSymbolsFetch: number = 0;

  // Status
  private isRunning = false;
  private pollCount = 0;
  private lastPollTime: number | null = null;

  // Konfiguration
  private readonly POLL_INTERVAL = 60000; // 60 Sekunden
  private readonly SYMBOLS_REFRESH_INTERVAL = 3600000; // 60 Minuten
  private readonly API_BASE = 'https://fapi.asterdex.com/fapi/v1';

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auto-Start
    if (path !== '/stop' && !this.isRunning) {
      console.log('[AsterTracker] Auto-starting tracker');
      await this.start().catch((error) => {
        console.error('[AsterTracker] Auto-start failed:', error);
      });
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
        message: 'Tracker started',
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
      message: 'Tracker stopped',
    });
  }

  private async handleStatus(): Promise<Response> {
    return Response.json({
      success: true,
      data: {
        running: this.isRunning,
        pollCount: this.pollCount,
        lastPollTime: this.lastPollTime ? new Date(this.lastPollTime).toISOString() : null,
        bufferSize: this.dataBuffer.size,
        bufferedSymbols: Array.from(this.dataBuffer.keys()),
      },
    });
  }

  private async handleData(): Promise<Response> {
    const data = Array.from(this.dataBuffer.entries()).map(([symbol, value]) => ({
      symbol,
      ...value,
    }));

    return Response.json({
      success: true,
      data,
    });
  }

  private async start(): Promise<void> {
    console.log('[AsterTracker] Starting tracker');
    this.isRunning = true;

    // Initiales Poll
    await this.pollAndBuffer();

    // Polling alle 60 Sekunden
    this.pollingInterval = setInterval(async () => {
      await this.pollAndBuffer();
    }, this.POLL_INTERVAL) as any;

    // Snapshot Timer (alle 15 Sekunden)
    this.startSnapshotTimer();

    // Status Check Timer
    this.startStatusCheck();

    await this.updateTrackerStatus('running', null);
  }

  private stop(): void {
    console.log('[AsterTracker] Stopping tracker');
    this.isRunning = false;

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }

    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }

    this.updateTrackerStatus('stopped', null);
  }

  /**
   * Holt alle verfügbaren Symbole von der API
   */
  private async fetchAvailableSymbols(): Promise<AsterSymbol[]> {
    const now = Date.now();

    // Cache verwenden wenn verfügbar und nicht abgelaufen
    if (this.cachedSymbols.length > 0 && now - this.lastSymbolsFetch < this.SYMBOLS_REFRESH_INTERVAL) {
      const cacheAge = Math.floor((now - this.lastSymbolsFetch) / 60000);
      console.log(`[AsterTracker] Using cached symbols (${this.cachedSymbols.length} symbols, cached ${cacheAge} minutes ago)`);
      return this.cachedSymbols;
    }

    console.log('[AsterTracker] Fetching fresh symbols from API...');
    const response = await fetch(`${this.API_BASE}/exchangeInfo`);
    const data: AsterExchangeInfo = await response.json();

    // Nur PERPETUAL Contracts filtern
    const perpetualSymbols = data.symbols.filter(
      (s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING'
    );

    console.log(`[AsterTracker] Fetched ${data.symbols.length} symbols, filtered to ${perpetualSymbols.length} PERPETUAL contracts`);

    this.cachedSymbols = perpetualSymbols;
    this.lastSymbolsFetch = now;

    return perpetualSymbols;
  }

  /**
   * Pollt alle API-Endpunkte und buffert die Daten
   */
  private async pollAndBuffer(): Promise<void> {
    try {
      this.pollCount++;
      this.lastPollTime = Date.now();
      console.log(`[AsterTracker] Poll #${this.pollCount} starting...`);

      const symbols = await this.fetchAvailableSymbols();
      console.log(`[AsterTracker] Polling data for ${symbols.length} symbols`);

      // Alle Symbole parallel abfragen
      const results = await Promise.allSettled(
        symbols.map((symbol) => this.fetchSymbolData(symbol.symbol))
      );

      let successCount = 0;
      let errorCount = 0;

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const symbol = symbols[index].symbol;
          this.dataBuffer.set(symbol, result.value);
          successCount++;
        } else {
          errorCount++;
          if (result.status === 'rejected') {
            console.error(`[AsterTracker] Failed to fetch data for ${symbols[index].symbol}:`, result.reason);
          }
        }
      });

      console.log(`[AsterTracker] Poll #${this.pollCount} complete: ${successCount} successful, ${errorCount} errors`);
      await this.updateTrackerStatus('running', null);
    } catch (error) {
      console.error('[AsterTracker] Poll failed:', error);
      await this.updateTrackerStatus('error', error instanceof Error ? error.message : 'Poll failed');
    }
  }

  /**
   * Holt alle Daten für ein Symbol
   */
  private async fetchSymbolData(symbol: string): Promise<any> {
    try {
      // Alle API-Calls parallel ausführen
      const [premiumData, fundingData, openInterestData] = await Promise.all([
        this.fetchPremiumIndex(symbol),
        this.fetchFundingInfo(symbol),
        this.fetchOpenInterest(symbol),
      ]);

      // Open Interest in USD berechnen
      let openInterestUsd: number | null = null;
      if (openInterestData && premiumData) {
        const price = await this.fetchPriceAtTimestamp(symbol, openInterestData.time);
        if (price) {
          // OI * Preis * 2
          openInterestUsd = parseFloat(openInterestData.openInterest) * price * 2;
        }
      }

      return {
        symbol,
        markPrice: premiumData?.markPrice || null,
        indexPrice: premiumData?.indexPrice || null,
        lastFundingRate: premiumData?.lastFundingRate || null,
        nextFundingTime: premiumData?.nextFundingTime || null,
        fundingIntervalHours: fundingData?.fundingIntervalHours || null,
        openInterest: openInterestData?.openInterest || null,
        openInterestUsd: openInterestUsd,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(`[AsterTracker] Failed to fetch data for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Premium Index abrufen
   */
  private async fetchPremiumIndex(symbol: string): Promise<AsterPremiumIndex | null> {
    try {
      const response = await fetch(`${this.API_BASE}/premiumIndex?symbol=${symbol}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  /**
   * Funding Info abrufen
   */
  private async fetchFundingInfo(symbol: string): Promise<AsterFundingInfo | null> {
    try {
      const response = await fetch(`${this.API_BASE}/fundingInfo`);
      if (!response.ok) return null;
      const data: AsterFundingInfo[] = await response.json();
      return data.find((f) => f.symbol === symbol) || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Open Interest abrufen
   */
  private async fetchOpenInterest(symbol: string): Promise<AsterOpenInterest | null> {
    try {
      const response = await fetch(`${this.API_BASE}/openInterest?symbol=${symbol}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  /**
   * Preis zum Zeitpunkt des Open Interest Timestamps abrufen
   */
  private async fetchPriceAtTimestamp(symbol: string, timestamp: number): Promise<number | null> {
    try {
      const response = await fetch(
        `${this.API_BASE}/klines?symbol=${symbol}&interval=1m&startTime=${timestamp}&limit=1`
      );
      if (!response.ok) return null;

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) return null;

      // Kline Format: [openTime, open, high, low, close, volume, closeTime, ...]
      const kline = data[0];
      const closePrice = parseFloat(kline[4]); // close price
      return closePrice;
    } catch (error) {
      return null;
    }
  }

  private startSnapshotTimer(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
    }

    const intervalMs = parseInt(this.env.SNAPSHOT_INTERVAL_MS || '15000');
    console.log(`[AsterTracker] Starting snapshot timer with interval: ${intervalMs}ms`);

    this.snapshotInterval = setInterval(async () => {
      await this.saveSnapshot();
    }, intervalMs) as any;
  }

  private startStatusCheck(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    this.statusCheckInterval = setInterval(() => {
      console.log(`[AsterTracker] Status Check - Running: ${this.isRunning}, Buffer: ${this.dataBuffer.size}, Polls: ${this.pollCount}`);
      if (this.lastPollTime) {
        console.log(`[AsterTracker] Last poll: ${new Date(this.lastPollTime).toISOString()}`);
      }
    }, 30000) as any;
  }

  /**
   * Speichert aktuellen Buffer als Snapshot in die Datenbank
   */
  private async saveSnapshot(): Promise<void> {
    console.log(`[AsterTracker] saveSnapshot called, buffer size: ${this.dataBuffer.size}`);

    if (this.dataBuffer.size === 0) {
      console.log('[AsterTracker] No data to save in snapshot');
      return;
    }

    const records: MarketStatsRecord[] = [];
    const recordedAt = Date.now();

    console.log('[AsterTracker] Starting to process buffer for database save');

    for (const [symbol, data] of this.dataBuffer.entries()) {
      if (!data.markPrice || !symbol) {
        console.warn(`[AsterTracker] Skipping invalid record for ${symbol}`);
        continue;
      }

      // Open Interest USD berechnen: OI * price * 2 (1 Kontrakt = 0.5 BTC)
      const markPrice = parseFloat(data.markPrice || '0');
      const openInterest = parseFloat(data.openInterest || '0');
      const openInterestUsd = (markPrice * openInterest * 2).toString();

      const record: any = {
        exchange: 'aster',
        symbol: symbol,
        last_trade_price: data.markPrice,
        index_price: data.indexPrice,
        mark_price: data.markPrice,
        open_interest: data.openInterest,
        open_interest_usd: openInterestUsd,
        funding_rate: data.lastFundingRate,
        next_funding_time: data.nextFundingTime?.toString() || null,
        created_at: Math.floor(recordedAt / 1000),
      };

      records.push(record);
    }

    if (records.length === 0) {
      console.log('[AsterTracker] No valid records to save');
      return;
    }

    try {
      const insertStatements = records.map((record) => {
        return this.env.DB.prepare(
          `INSERT INTO market_stats (
            exchange, symbol, market_id, last_trade_price, index_price, mark_price,
            open_interest, open_interest_usd, funding_rate, next_funding_time, created_at,
            open_interest_limit, funding_clamp_small, funding_clamp_big,
            current_funding_rate, funding_timestamp, daily_base_token_volume,
            daily_quote_token_volume, daily_price_low, daily_price_high, daily_price_change, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          record.next_funding_time || '0',
          record.created_at,
          '0', // open_interest_limit
          '0', // funding_clamp_small
          '0', // funding_clamp_big
          record.funding_rate || '0', // current_funding_rate
          0, // funding_timestamp
          0, // daily_base_token_volume
          0, // daily_quote_token_volume
          0, // daily_price_low
          0, // daily_price_high
          0, // daily_price_change
          record.created_at // recorded_at
        );
      });

      await this.env.DB.batch(insertStatements);
      console.log(`[AsterTracker] Saved ${records.length} records to database`);
    } catch (error) {
      console.error('[AsterTracker] Failed to save snapshot to database:', error);
      throw error;
    }
  }

  private async updateTrackerStatus(status: string, error: string | null): Promise<void> {
    try {
      await this.env.DB.prepare(
        `UPDATE tracker_status SET status = ?, last_error = ?, updated_at = ? WHERE exchange = ?`
      )
        .bind(status, error, Math.floor(Date.now() / 1000), 'aster')
        .run();
    } catch (err) {
      console.error('[AsterTracker] Failed to update tracker status:', err);
    }
  }
}
