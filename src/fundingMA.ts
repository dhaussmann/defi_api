import { Env } from './types';

interface MACalculationResult {
  normalized_symbol: string;
  exchange: string;
  period: string;
  ma_rate_1h: number;
  ma_apr: number;
  data_points: number;
  std_dev: number;
  min_rate: number;
  max_rate: number;
  period_start: number;
  period_end: number;
}

interface CrossExchangeMAResult {
  normalized_symbol: string;
  period: string;
  avg_ma_rate_1h: number;
  avg_ma_apr: number;
  weighted_ma_rate_1h: number;
  weighted_ma_apr: number;
  exchange_count: number;
  total_data_points: number;
  min_exchange_ma: number;
  max_exchange_ma: number;
  spread: number;
  period_start: number;
  period_end: number;
}

const PERIODS = {
  '1h': 1 * 60 * 60,
  '24h': 24 * 60 * 60,
  '3d': 3 * 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '14d': 14 * 24 * 60 * 60,
  '30d': 30 * 24 * 60 * 60,
};

export async function calculateFundingMA(env: Env): Promise<{ success: boolean; message: string; stats: any }> {
  console.log('[MA] Starting hourly moving average calculation');
  const startTime = Date.now();
  const calculatedAt = Math.floor(startTime / 1000);
  
  const stats = {
    periods_calculated: 0,
    symbols_processed: 0,
    exchanges_processed: 0,
    cross_exchange_calculated: 0,
    errors: 0,
  };

  try {
    // Get all unique symbols from unified_v3
    const symbolsResult = await env.DB_UNIFIED.prepare(`
      SELECT DISTINCT normalized_symbol 
      FROM unified_v3 
      ORDER BY normalized_symbol
    `).all();

    if (!symbolsResult.results || symbolsResult.results.length === 0) {
      return { success: true, message: 'No symbols found', stats };
    }

    const symbols = symbolsResult.results.map((r: any) => r.normalized_symbol);
    console.log(`[MA] Processing ${symbols.length} symbols`);

    // Get all unique exchanges
    const exchangesResult = await env.DB_UNIFIED.prepare(`
      SELECT DISTINCT exchange 
      FROM unified_v3 
      ORDER BY exchange
    `).all();

    const exchanges = exchangesResult.results?.map((r: any) => r.exchange) || [];
    console.log(`[MA] Processing ${exchanges.length} exchanges`);

    // Calculate MA for each symbol, exchange, and period
    for (const symbol of symbols) {
      for (const exchange of exchanges) {
        for (const [periodName, periodSeconds] of Object.entries(PERIODS)) {
          try {
            const result = await calculateMAForSymbolExchange(
              env,
              symbol,
              exchange,
              periodName,
              periodSeconds,
              calculatedAt
            );

            if (result) {
              await insertMA(env, result, calculatedAt);
              stats.periods_calculated++;
            }
          } catch (error) {
            console.error(`[MA] Error calculating ${symbol}/${exchange}/${periodName}:`, error);
            stats.errors++;
          }
        }
      }
      stats.symbols_processed++;
    }

    stats.exchanges_processed = exchanges.length;

    // Calculate cross-exchange aggregates
    for (const symbol of symbols) {
      for (const periodName of Object.keys(PERIODS)) {
        try {
          const crossResult = await calculateCrossExchangeMA(
            env,
            symbol,
            periodName,
            calculatedAt
          );

          if (crossResult) {
            await insertCrossExchangeMA(env, crossResult, calculatedAt);
            stats.cross_exchange_calculated++;
          }
        } catch (error) {
          console.error(`[MA] Error calculating cross-exchange ${symbol}/${periodName}:`, error);
          stats.errors++;
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[MA] Calculation completed in ${duration}ms`, stats);

    return {
      success: true,
      message: `Moving averages calculated successfully`,
      stats: { ...stats, duration_ms: duration },
    };
  } catch (error) {
    console.error('[MA] Fatal error during calculation:', error);
    return {
      success: false,
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      stats,
    };
  }
}

async function calculateMAForSymbolExchange(
  env: Env,
  symbol: string,
  exchange: string,
  period: string,
  periodSeconds: number,
  calculatedAt: number
): Promise<MACalculationResult | null> {
  const periodEnd = calculatedAt;
  const periodStart = calculatedAt - periodSeconds;

  // Query funding rates for this period
  const query = await env.DB_UNIFIED.prepare(`
    SELECT 
      rate_1h_percent,
      rate_apr,
      funding_time
    FROM unified_v3
    WHERE normalized_symbol = ?
      AND exchange = ?
      AND funding_time >= ?
      AND funding_time <= ?
      AND rate_1h_percent IS NOT NULL
    ORDER BY funding_time DESC
  `).bind(symbol, exchange, periodStart, periodEnd).all();

  if (!query.results || query.results.length === 0) {
    return null;
  }

  const rates = query.results.map((r: any) => r.rate_1h_percent);
  const aprs = query.results.map((r: any) => r.rate_apr).filter((apr: any) => apr !== null);

  if (rates.length === 0) {
    return null;
  }

  // Calculate statistics
  const ma_rate_1h = rates.reduce((sum: number, r: number) => sum + r, 0) / rates.length;
  const ma_apr = aprs.length > 0 ? aprs.reduce((sum: number, r: number) => sum + r, 0) / aprs.length : 0;

  // Standard deviation
  const variance = rates.reduce((sum: number, r: number) => sum + Math.pow(r - ma_rate_1h, 2), 0) / rates.length;
  const std_dev = Math.sqrt(variance);

  const min_rate = Math.min(...rates);
  const max_rate = Math.max(...rates);

  return {
    normalized_symbol: symbol,
    exchange,
    period,
    ma_rate_1h,
    ma_apr,
    data_points: rates.length,
    std_dev,
    min_rate,
    max_rate,
    period_start: periodStart,
    period_end: periodEnd,
  };
}

async function insertMA(env: Env, result: MACalculationResult, calculatedAt: number): Promise<void> {
  await env.DB_UNIFIED.prepare(`
    INSERT INTO funding_ma (
      normalized_symbol, exchange, period,
      ma_rate_1h, ma_apr,
      data_points, std_dev, min_rate, max_rate,
      calculated_at, period_start, period_end
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_symbol, exchange, period, calculated_at)
    DO UPDATE SET
      ma_rate_1h = excluded.ma_rate_1h,
      ma_apr = excluded.ma_apr,
      data_points = excluded.data_points,
      std_dev = excluded.std_dev,
      min_rate = excluded.min_rate,
      max_rate = excluded.max_rate,
      period_start = excluded.period_start,
      period_end = excluded.period_end
  `).bind(
    result.normalized_symbol,
    result.exchange,
    result.period,
    result.ma_rate_1h,
    result.ma_apr,
    result.data_points,
    result.std_dev,
    result.min_rate,
    result.max_rate,
    calculatedAt,
    result.period_start,
    result.period_end
  ).run();
}

async function calculateCrossExchangeMA(
  env: Env,
  symbol: string,
  period: string,
  calculatedAt: number
): Promise<CrossExchangeMAResult | null> {
  // Get latest MA values for all exchanges for this symbol and period
  const query = await env.DB_UNIFIED.prepare(`
    SELECT 
      exchange,
      ma_rate_1h,
      ma_apr,
      data_points
    FROM funding_ma
    WHERE normalized_symbol = ?
      AND period = ?
      AND calculated_at = ?
      AND ma_rate_1h IS NOT NULL
  `).bind(symbol, period, calculatedAt).all();

  if (!query.results || query.results.length === 0) {
    return null;
  }

  const exchanges = query.results;
  const maRates = exchanges.map((e: any) => e.ma_rate_1h);
  const maAprs = exchanges.map((e: any) => e.ma_apr).filter((apr: any) => apr !== null && apr !== 0);
  const dataPoints = exchanges.map((e: any) => e.data_points);

  // Simple average
  const avg_ma_rate_1h = maRates.reduce((sum: number, r: number) => sum + r, 0) / maRates.length;
  const avg_ma_apr = maAprs.length > 0 ? maAprs.reduce((sum: number, r: number) => sum + r, 0) / maAprs.length : 0;

  // Weighted average (by data points)
  const totalDataPoints = dataPoints.reduce((sum: number, d: number) => sum + d, 0);
  const weighted_ma_rate_1h = exchanges.reduce((sum: number, e: any) => 
    sum + (e.ma_rate_1h * e.data_points), 0) / totalDataPoints;
  const weighted_ma_apr = exchanges.reduce((sum: number, e: any) => 
    sum + ((e.ma_apr || 0) * e.data_points), 0) / totalDataPoints;

  // Range
  const min_exchange_ma = Math.min(...maRates);
  const max_exchange_ma = Math.max(...maRates);
  const spread = max_exchange_ma - min_exchange_ma;

  const periodSeconds = PERIODS[period as keyof typeof PERIODS];
  const period_start = calculatedAt - periodSeconds;

  return {
    normalized_symbol: symbol,
    period,
    avg_ma_rate_1h,
    avg_ma_apr,
    weighted_ma_rate_1h,
    weighted_ma_apr,
    exchange_count: exchanges.length,
    total_data_points: totalDataPoints,
    min_exchange_ma,
    max_exchange_ma,
    spread,
    period_start,
    period_end: calculatedAt,
  };
}

async function insertCrossExchangeMA(env: Env, result: CrossExchangeMAResult, calculatedAt: number): Promise<void> {
  await env.DB_UNIFIED.prepare(`
    INSERT INTO funding_ma_cross (
      normalized_symbol, period,
      avg_ma_rate_1h, avg_ma_apr,
      weighted_ma_rate_1h, weighted_ma_apr,
      exchange_count, total_data_points,
      min_exchange_ma, max_exchange_ma, spread,
      calculated_at, period_start, period_end
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_symbol, period, calculated_at)
    DO UPDATE SET
      avg_ma_rate_1h = excluded.avg_ma_rate_1h,
      avg_ma_apr = excluded.avg_ma_apr,
      weighted_ma_rate_1h = excluded.weighted_ma_rate_1h,
      weighted_ma_apr = excluded.weighted_ma_apr,
      exchange_count = excluded.exchange_count,
      total_data_points = excluded.total_data_points,
      min_exchange_ma = excluded.min_exchange_ma,
      max_exchange_ma = excluded.max_exchange_ma,
      spread = excluded.spread,
      period_start = excluded.period_start,
      period_end = excluded.period_end
  `).bind(
    result.normalized_symbol,
    result.period,
    result.avg_ma_rate_1h,
    result.avg_ma_apr,
    result.weighted_ma_rate_1h,
    result.weighted_ma_apr,
    result.exchange_count,
    result.total_data_points,
    result.min_exchange_ma,
    result.max_exchange_ma,
    result.spread,
    calculatedAt,
    result.period_start,
    result.period_end
  ).run();
}

export async function queryFundingMA(
  env: Env,
  symbol: string,
  period: string,
  exchange?: string,
  limit: number = 24
): Promise<any> {
  if (exchange && exchange !== 'all') {
    // Query specific exchange
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        normalized_symbol,
        exchange,
        period,
        ma_rate_1h,
        ma_apr,
        data_points,
        std_dev,
        min_rate,
        max_rate,
        calculated_at,
        period_start,
        period_end
      FROM funding_ma
      WHERE normalized_symbol = ?
        AND exchange = ?
        AND period = ?
      ORDER BY calculated_at DESC
      LIMIT ?
    `).bind(symbol, exchange, period, limit).all();

    return {
      success: true,
      symbol,
      exchange,
      period,
      count: query.results?.length || 0,
      data: query.results || [],
    };
  } else {
    // Query cross-exchange aggregates
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        normalized_symbol,
        period,
        avg_ma_rate_1h,
        avg_ma_apr,
        weighted_ma_rate_1h,
        weighted_ma_apr,
        exchange_count,
        total_data_points,
        min_exchange_ma,
        max_exchange_ma,
        spread,
        calculated_at,
        period_start,
        period_end
      FROM funding_ma_cross
      WHERE normalized_symbol = ?
        AND period = ?
      ORDER BY calculated_at DESC
      LIMIT ?
    `).bind(symbol, period, limit).all();

    return {
      success: true,
      symbol,
      exchange: 'cross-exchange',
      period,
      count: query.results?.length || 0,
      data: query.results || [],
    };
  }
}

export async function getLatestMA(
  env: Env,
  symbol: string,
  exchange?: string
): Promise<any> {
  if (exchange && exchange !== 'all') {
    // Get latest MA for all periods for specific exchange
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        period,
        ma_rate_1h,
        ma_apr,
        data_points,
        std_dev,
        calculated_at
      FROM funding_ma
      WHERE normalized_symbol = ?
        AND exchange = ?
        AND calculated_at = (
          SELECT MAX(calculated_at) 
          FROM funding_ma 
          WHERE normalized_symbol = ? AND exchange = ?
        )
      ORDER BY 
        CASE period
          WHEN '1h' THEN 1
          WHEN '24h' THEN 2
          WHEN '3d' THEN 3
          WHEN '7d' THEN 4
          WHEN '14d' THEN 5
          WHEN '30d' THEN 6
        END
    `).bind(symbol, exchange, symbol, exchange).all();

    return {
      success: true,
      symbol,
      exchange,
      data: query.results || [],
    };
  } else {
    // Get latest cross-exchange MA for all periods
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        period,
        avg_ma_rate_1h,
        avg_ma_apr,
        weighted_ma_rate_1h,
        weighted_ma_apr,
        exchange_count,
        total_data_points,
        spread,
        calculated_at
      FROM funding_ma_cross
      WHERE normalized_symbol = ?
        AND calculated_at = (
          SELECT MAX(calculated_at) 
          FROM funding_ma_cross 
          WHERE normalized_symbol = ?
        )
      ORDER BY 
        CASE period
          WHEN '1h' THEN 1
          WHEN '24h' THEN 2
          WHEN '3d' THEN 3
          WHEN '7d' THEN 4
          WHEN '14d' THEN 5
          WHEN '30d' THEN 6
        END
    `).bind(symbol, symbol).all();

    return {
      success: true,
      symbol,
      exchange: 'cross-exchange',
      data: query.results || [],
    };
  }
}
