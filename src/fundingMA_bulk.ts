import { Env } from './types';

/**
 * Get bulk latest MAs for all symbols across all exchanges
 */
export async function getBulkLatestMA(env: Env): Promise<any> {
  try {
    // Get latest MAs for all symbol-exchange pairs
    const query = await env.DB_UNIFIED.prepare(`
      SELECT 
        normalized_symbol,
        exchange,
        period,
        ma_rate_1h,
        ma_apr,
        data_points,
        std_dev,
        calculated_at
      FROM funding_ma
      WHERE (normalized_symbol, exchange, period, calculated_at) IN (
        SELECT normalized_symbol, exchange, period, MAX(calculated_at)
        FROM funding_ma
        GROUP BY normalized_symbol, exchange, period
      )
      ORDER BY exchange, normalized_symbol, 
        CASE period
          WHEN '1h' THEN 1
          WHEN '24h' THEN 2
          WHEN '3d' THEN 3
          WHEN '7d' THEN 4
          WHEN '14d' THEN 5
          WHEN '30d' THEN 6
        END
    `).all();

    if (!query.success) {
      throw new Error('Failed to query bulk MAs');
    }

    // Group by exchange and symbol
    const byExchange: Record<string, Record<string, any[]>> = {};
    
    query.results.forEach((row: any) => {
      if (!byExchange[row.exchange]) {
        byExchange[row.exchange] = {};
      }
      if (!byExchange[row.exchange][row.normalized_symbol]) {
        byExchange[row.exchange][row.normalized_symbol] = [];
      }
      byExchange[row.exchange][row.normalized_symbol].push({
        period: row.period,
        ma_rate_1h: row.ma_rate_1h,
        ma_apr: row.ma_apr,
        data_points: row.data_points,
        std_dev: row.std_dev,
        calculated_at: row.calculated_at
      });
    });

    return {
      success: true,
      timestamp: Date.now(),
      total_records: query.results.length,
      exchanges: Object.keys(byExchange).length,
      data: byExchange
    };

  } catch (error) {
    console.error('[MA] Error fetching bulk MAs:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
