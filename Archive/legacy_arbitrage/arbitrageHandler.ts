/**
 * API Handler for Arbitrage Opportunities
 */

import { Env, ApiResponse } from './types';
import { getCachedArbitrage } from './arbitrageCache';

/**
 * Get arbitrage opportunities with optional filtering
 * 
 * Query parameters:
 * - symbols: Comma-separated list of symbols (e.g., "BTC,ETH")
 * - exchanges: Comma-separated list of exchanges to include
 * - timeframes: Comma-separated list of timeframes (e.g., "24h,7d")
 * - minSpread: Minimum spread (decimal, e.g., 0.0001)
 * - minSpreadAPR: Minimum spread APR (percentage, e.g., 5)
 * - onlyStable: Set to "true" to only show stable opportunities (stability_score >= 4)
 * - sortBy: Sort field (spread, spread_apr, stability_score) - default: spread_apr
 * - order: Sort order (asc, desc) - default: desc
 * - limit: Maximum number of results - default: 100
 */
export async function getArbitrageOpportunities(
  env: Env,
  url: URL,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Parse query parameters
    const symbolsParam = url.searchParams.get('symbols');
    const symbols = symbolsParam ? symbolsParam.split(',').map(s => s.trim().toUpperCase()) : undefined;

    const exchangesParam = url.searchParams.get('exchanges');
    const exchanges = exchangesParam ? exchangesParam.split(',').map(e => e.trim().toLowerCase()) : undefined;

    const timeframesParam = url.searchParams.get('timeframes');
    const timeframes = timeframesParam ? timeframesParam.split(',').map(t => t.trim()) : undefined;

    const minSpreadParam = url.searchParams.get('minSpread');
    const minSpread = minSpreadParam ? parseFloat(minSpreadParam) : undefined;

    const minSpreadAPRParam = url.searchParams.get('minSpreadAPR');
    const minSpreadAPR = minSpreadAPRParam ? parseFloat(minSpreadAPRParam) : undefined;

    const onlyStable = url.searchParams.get('onlyStable') === 'true';

    const sortBy = url.searchParams.get('sortBy') || 'spread_apr';
    const order = url.searchParams.get('order') || 'desc';
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam) : 100;

    // Fetch cached arbitrage opportunities
    const opportunities = await getCachedArbitrage(env, {
      symbols,
      exchanges,
      timeframes,
      minSpread,
      minSpreadAPR,
      onlyStable,
    });

    // Sort results
    const sortedOpportunities = opportunities.sort((a, b) => {
      let aVal: number, bVal: number;
      
      switch (sortBy) {
        case 'spread':
          aVal = a.spread;
          bVal = b.spread;
          break;
        case 'stability_score':
          aVal = a.stability_score;
          bVal = b.stability_score;
          break;
        case 'spread_apr':
        default:
          aVal = a.spread_apr;
          bVal = b.spread_apr;
          break;
      }

      return order === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Apply limit
    const limitedOpportunities = sortedOpportunities.slice(0, limit);

    // Format response data
    const formattedData = limitedOpportunities.map(opp => ({
      id: `${opp.symbol}-${opp.long_exchange}-${opp.short_exchange}-${opp.timeframe}`,
      symbol: opp.symbol,
      long_exchange: opp.long_exchange,
      short_exchange: opp.short_exchange,
      timeframe: opp.timeframe,
      long_rate: parseFloat((opp.long_rate as number).toFixed(8)),
      short_rate: parseFloat((opp.short_rate as number).toFixed(8)),
      spread: parseFloat((opp.spread as number).toFixed(8)),
      spread_pct: parseFloat(((opp.spread as number) * 100).toFixed(4)),
      long_apr: parseFloat((opp.long_apr as number).toFixed(4)),
      short_apr: parseFloat((opp.short_apr as number).toFixed(4)),
      spread_apr: parseFloat((opp.spread_apr as number).toFixed(4)),
      stability_score: opp.stability_score,
      is_stable: opp.is_stable === 1,
      calculated_at: opp.calculated_at,
    }));

    // Calculate statistics
    const stats = {
      total: formattedData.length,
      stable_count: formattedData.filter(o => o.is_stable).length,
      avg_spread_apr: formattedData.length > 0
        ? parseFloat((formattedData.reduce((sum, o) => sum + o.spread_apr, 0) / formattedData.length).toFixed(4))
        : 0,
      max_spread_apr: formattedData.length > 0
        ? Math.max(...formattedData.map(o => o.spread_apr))
        : 0,
      unique_symbols: new Set(formattedData.map(o => o.symbol)).size,
      unique_exchanges: new Set([
        ...formattedData.map(o => o.long_exchange),
        ...formattedData.map(o => o.short_exchange),
      ]).size,
    };

    return Response.json(
      {
        success: true,
        data: formattedData,
        meta: {
          ...stats,
          filters: {
            symbols: symbols || 'all',
            exchanges: exchanges || 'all',
            timeframes: timeframes || 'all',
            minSpread: minSpread || 'none',
            minSpreadAPR: minSpreadAPR || 'none',
            onlyStable,
          },
          sorting: {
            sortBy,
            order,
            limit,
          },
        },
      } as ApiResponse,
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error('[API] Error in getArbitrageOpportunities:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch arbitrage opportunities',
      } as ApiResponse,
      { status: 500, headers: corsHeaders }
    );
  }
}
