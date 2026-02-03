import { Env } from './types';

const VARIATIONAL_API_URL = 'https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats';

export async function fetchAndSaveVariationalData(env: Env): Promise<void> {
  try {
    console.log('[VariationalFetcher] Fetching data from API...');

    const response = await fetch(VARIATIONAL_API_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const responseData = await response.json() as any;

    if (!responseData.listings || !Array.isArray(responseData.listings)) {
      throw new Error('Invalid API response: missing listings array');
    }

    const listings = responseData.listings;
    console.log(`[VariationalFetcher] Fetched ${listings.length} assets`);

    const now = Math.floor(Date.now() / 1000);
    const recordedAt = now;
    const createdAt = now;

    const records: any[] = [];

    for (const listing of listings) {
      const ticker = listing.ticker;
      if (!ticker) continue;

      const marketId = listing.market_id || 0;
      const markPrice = parseFloat(listing.mark_price || '0');
      const totalOI = parseFloat(listing.total_oi || '0');
      const openInterestUsd = (totalOI * markPrice).toString();
      const volume24h = parseFloat(listing.volume_24h || '0');

      const fundingRateFromAPI = parseFloat(listing.funding_rate || '0');
      const fundingRate = fundingRateFromAPI / 10 / 100;
      
      const fundingIntervalSeconds = parseInt(listing.funding_interval_s || '28800');
      const fundingIntervalHours = Math.round(fundingIntervalSeconds / 3600);

      records.push({
        exchange: 'variational',
        symbol: ticker,
        market_id: marketId,
        index_price: markPrice.toString(),
        mark_price: markPrice.toString(),
        open_interest: totalOI.toString(),
        open_interest_usd: openInterestUsd,
        open_interest_limit: '0',
        funding_clamp_small: '0',
        funding_clamp_big: '0',
        last_trade_price: markPrice.toString(),
        current_funding_rate: fundingRate,
        funding_rate: fundingRate.toString(),
        funding_timestamp: recordedAt,
        funding_interval_hours: fundingIntervalHours,
        daily_base_token_volume: volume24h,
        daily_quote_token_volume: volume24h,
        daily_price_low: 0,
        daily_price_high: 0,
        daily_price_change: 0,
        recorded_at: recordedAt,
      });
    }

    if (records.length === 0) {
      console.log('[VariationalFetcher] No records to save');
      return;
    }

    const stmt = env.DB_WRITE.prepare(`
      INSERT INTO market_stats (
        exchange, symbol, market_id, index_price, mark_price,
        open_interest, open_interest_usd, open_interest_limit, funding_clamp_small,
        funding_clamp_big, last_trade_price, current_funding_rate,
        funding_rate, funding_timestamp, funding_interval_hours, daily_base_token_volume,
        daily_quote_token_volume, daily_price_low, daily_price_high,
        daily_price_change, recorded_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        record.funding_interval_hours,
        record.daily_base_token_volume,
        record.daily_quote_token_volume,
        record.daily_price_low,
        record.daily_price_high,
        record.daily_price_change,
        record.recorded_at,
        createdAt
      )
    );

    await env.DB_WRITE.batch(batch);

    console.log(`[VariationalFetcher] Saved ${records.length} records to database`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[VariationalFetcher] Failed:', errorMessage);
    throw error;
  }
}
