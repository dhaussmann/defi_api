import { Env } from './types';

/**
 * Extended Exchange Market Data Interface
 */
interface ExtendedMarketStats {
  dailyVolume: string;
  dailyVolumeBase: string;
  dailyPriceChange: string;
  dailyPriceChangePercentage: string;
  dailyLow: string;
  dailyHigh: string;
  lastPrice: string;
  askPrice: string;
  bidPrice: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingRate: number;
  openInterest: string;
  openInterestBase: string;
}

interface ExtendedMarketData {
  name: string;
  uiName: string;
  category: string;
  assetName: string;
  status: string;
  active: boolean;
  marketStats: ExtendedMarketStats;
}

interface ExtendedApiResponse {
  status: string;
  data: ExtendedMarketData[];
}

/**
 * ExtendedTracker - Durable Object für Extended Exchange API Polling
 *
 * Dieser Tracker ruft regelmäßig die Extended Exchange API ab und
 * speichert Market-Statistiken in die D1 Datenbank.
 *
 * Hauptfunktionen:
 * - API-Polling alle 15 Sekunden
 * - Buffering von Market-Daten im Speicher
 * - Regelmäßige Snapshots (alle 60 Sekunden) in die Datenbank
 * - Nur ACTIVE Märkte werden gespeichert
 */
export class ExtendedTracker implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  // Timer
  private pollInterval: number | null = null;
  private snapshotInterval: number | null = null;

  // Daten-Buffer
  private dataBuffer: Map<string, ExtendedMarketData> = new Map();

  // Status-Variablen
  private isRunning = false;
  private pollCount = 0;
  private lastPollTime: string | null = null;

  // Konfigurationskonstanten
  private readonly POLL_INTERVAL = 15000; // 15 Sekunden
  private readonly SNAPSHOT_INTERVAL = 15000; // 15 Sekunden (konsistent mit anderen Trackern)
  private readonly API_URL = 'https://api.starknet.extended.exchange/api/v1/info/markets';

  constructor(state: DurableObjectState, env: Env) {
    console.log('[ExtendedTracker] Constructor called');
    this.state = state;
    this.env = env;
    console.log('[ExtendedTracker] Constructor complete');
  }

  async fetch(request: Request): Promise<Response> {
    console.log('[ExtendedTracker] fetch() called');
    const url = new URL(request.url);
    const path = url.pathname;
    console.log(`[ExtendedTracker] Path: ${path}, isRunning: ${this.isRunning}`);

    // Auto-Start
    if (path !== '/stop' && !this.isRunning) {
      console.log('[ExtendedTracker] Auto-starting tracker');
      await this.start();
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

    await this.start();
    return Response.json({
      success: true,
      message: 'Extended Exchange tracker started',
      status: 'running',
    });
  }

  private async handleStop(): Promise<Response> {
    this.stop();
    return Response.json({
      success: true,
      message: 'Extended Exchange tracker stopped',
    });
  }

  private async handleStatus(): Promise<Response> {
    return Response.json({
      success: true,
      data: {
        running: this.isRunning,
        pollCount: this.pollCount,
        lastPollTime: this.lastPollTime,
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
   * Startet Polling und Snapshot-Timer
   */
  private async start(): Promise<void> {
    try {
      console.log('[ExtendedTracker] >>>>>> start() ENTRY <<<<<<');

      if (this.isRunning) {
        console.log('[ExtendedTracker] Already running, skipping start');
        return;
      }

      console.log('[ExtendedTracker] Starting Extended Exchange tracker');
      this.isRunning = true;

      // Sofort ersten Poll durchführen
      console.log('[ExtendedTracker] Triggering initial poll');
      await this.pollMarkets();
      console.log('[ExtendedTracker] Initial poll completed');
      
      // Sofort ersten Snapshot nach Poll
      console.log('[ExtendedTracker] Triggering initial snapshot');
      await this.saveSnapshot();
      console.log('[ExtendedTracker] Initial snapshot completed');

      // Regelmäßiges Polling starten (alle 15 Sekunden)
      console.log(`[ExtendedTracker] Setting up poll interval: ${this.POLL_INTERVAL}ms`);
      this.pollInterval = setInterval(async () => {
        console.log('[ExtendedTracker] Poll interval triggered');
        await this.pollMarkets();
      }, this.POLL_INTERVAL) as any;

      // Snapshot-Timer starten (alle 15 Sekunden)
      console.log(`[ExtendedTracker] Setting up snapshot interval: ${this.SNAPSHOT_INTERVAL}ms`);
      this.snapshotInterval = setInterval(async () => {
        console.log('[ExtendedTracker] Snapshot interval triggered');
        await this.saveSnapshot();
      }, this.SNAPSHOT_INTERVAL) as any;

      await this.updateTrackerStatus('running', null);
      console.log('[ExtendedTracker] >>>>>> start() EXIT SUCCESS <<<<<<');
    } catch (error) {
      console.error('[ExtendedTracker] !!!!! start() FAILED !!!!!');
      console.error('[ExtendedTracker] Error in start():', error);
      console.error('[ExtendedTracker] Error type:', typeof error);
      console.error('[ExtendedTracker] Error stack:', error instanceof Error ? error.stack : 'No stack');
      throw error;
    }
  }

  /**
   * Stoppt alle Timer
   */
  private stop(): void {
    console.log('[ExtendedTracker] Stopping Extended Exchange tracker');
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }

    this.updateTrackerStatus('stopped', null);
  }

  /**
   * Ruft Market-Daten von der Extended Exchange API ab
   */
  private async pollMarkets(): Promise<void> {
    console.log('[ExtendedTracker] ========== pollMarkets() START ==========');
    try {
      console.log(`[ExtendedTracker] Polling Extended Exchange API: ${this.API_URL}`);

      const response = await fetch(this.API_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json',
        },
      });
      console.log(`[ExtendedTracker] API Response status: ${response.status}`);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      console.log('[ExtendedTracker] Parsing JSON response');
      const json = (await response.json()) as ExtendedApiResponse;
      console.log(`[ExtendedTracker] JSON parsed, has data: ${!!json.data}, is array: ${Array.isArray(json.data)}`);

      if (!json.data || !Array.isArray(json.data)) {
        throw new Error('Invalid API response format');
      }

      this.pollCount++;
      this.lastPollTime = new Date().toISOString();
      console.log(`[ExtendedTracker] Poll count incremented to: ${this.pollCount}`);

      // Nur ACTIVE Märkte in Buffer speichern
      let activeCount = 0;
      for (const market of json.data) {
        if (market.status === 'ACTIVE' && market.active === true) {
          this.dataBuffer.set(market.name, market);
          activeCount++;
        }
      }

      console.log(`[ExtendedTracker] Poll #${this.pollCount}: Found ${activeCount} active markets (${json.data.length} total)`);

      console.log('[ExtendedTracker] Updating tracker status to running');
      await this.updateTrackerStatus('running', null);
      console.log('[ExtendedTracker] ========== pollMarkets() END SUCCESS ==========');
    } catch (error) {
      console.error('[ExtendedTracker] ========== pollMarkets() ERROR ==========');
      console.error('[ExtendedTracker] Failed to poll markets:', error);
      console.error('[ExtendedTracker] Error type:', typeof error);
      console.error('[ExtendedTracker] Error details:', JSON.stringify(error, null, 2));
      await this.updateTrackerStatus('error', error instanceof Error ? error.message : 'Failed to poll markets');
    }
  }

  /**
   * Speichert aktuellen Buffer-Inhalt als Snapshot in die D1 Datenbank
   */
  private async saveSnapshot(): Promise<void> {
    console.log('[ExtendedTracker] ========== saveSnapshot() START ==========');
    console.log(`[ExtendedTracker] saveSnapshot called, buffer size: ${this.dataBuffer.size}`);

    if (this.dataBuffer.size === 0) {
      console.log('[ExtendedTracker] No data to save in snapshot');
      return;
    }

    const records: any[] = [];
    const recordedAt = Date.now();
    const createdAt = Math.floor(recordedAt / 1000);

    console.log('[ExtendedTracker] Starting to process buffer for database save');

    for (const [name, market] of this.dataBuffer.entries()) {
      if (!market.marketStats || !market.marketStats.markPrice) {
        console.warn(`[ExtendedTracker] Skipping invalid record for ${name}`);
        continue;
      }

      const stats = market.marketStats;

      // Extended liefert openInterest bereits in USD
      // dailyVolume ist auch bereits in USD
      const record: any = {
        exchange: 'extended',
        symbol: name,
        last_trade_price: stats.lastPrice,
        index_price: stats.indexPrice,
        mark_price: stats.markPrice,
        open_interest: stats.openInterest,
        open_interest_usd: stats.openInterest, // Bereits in USD
        funding_rate: stats.fundingRate,
        next_funding_time: stats.nextFundingRate.toString(),
        volume_24h: stats.dailyVolume,
        price_change_24h: stats.dailyPriceChange,
        price_change_24h_percent: stats.dailyPriceChangePercentage,
        daily_low: stats.dailyLow,
        daily_high: stats.dailyHigh,
        created_at: createdAt,
      };

      records.push(record);
    }

    if (records.length === 0) {
      console.log('[ExtendedTracker] No valid records to save');
      return;
    }

    try {
      const insertStatements = records.map((record) => {
        return this.env.DB_WRITE.prepare(
          `INSERT INTO market_stats (
            exchange, symbol, market_id, last_trade_price, index_price, mark_price,
            open_interest, open_interest_usd, funding_rate, funding_timestamp, created_at,
            open_interest_limit, funding_clamp_small, funding_clamp_big,
            current_funding_rate, daily_base_token_volume,
            daily_quote_token_volume, daily_price_low, daily_price_high, daily_price_change, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          record.exchange,
          record.symbol,
          '0', // market_id as TEXT
          record.last_trade_price || '0',
          record.index_price || '0',
          record.mark_price || '0',
          record.open_interest || '0',
          record.open_interest_usd || '0',
          record.funding_rate || '0',
          parseInt(record.next_funding_time || '0'), // funding_timestamp (next funding time)
          record.created_at,
          '0', // open_interest_limit
          '0', // funding_clamp_small
          '0', // funding_clamp_big
          record.funding_rate || '0', // current_funding_rate
          parseFloat(record.volume_24h || '0'), // daily_base_token_volume (24h volume in USD)
          0, // daily_quote_token_volume
          parseFloat(record.daily_low || '0'), // daily_price_low
          parseFloat(record.daily_high || '0'), // daily_price_high
          parseFloat(record.price_change_24h || '0'), // daily_price_change
          record.created_at // recorded_at
        );
      });

      await this.env.DB_WRITE.batch(insertStatements);
      console.log(`[ExtendedTracker] Saved ${records.length} records to database`);
      console.log('[ExtendedTracker] ========== saveSnapshot() END SUCCESS ==========');
    } catch (error) {
      console.error('[ExtendedTracker] ========== saveSnapshot() ERROR ==========');
      console.error('[ExtendedTracker] Failed to save snapshot to database:', error);
      console.error('[ExtendedTracker] Error type:', typeof error);
      console.error('[ExtendedTracker] Error stack:', error instanceof Error ? error.stack : 'No stack');
      throw error;
    }
  }

  private async updateTrackerStatus(status: string, error: string | null): Promise<void> {
    try {
      await this.env.DB_WRITE.prepare(
        `UPDATE tracker_status SET status = ?, error_message = ?, updated_at = ? WHERE exchange = ?`
      )
        .bind(status, error, Math.floor(Date.now() / 1000), 'extended')
        .run();
    } catch (err) {
      console.error('[ExtendedTracker] Failed to update tracker status:', err);
    }
  }
}
