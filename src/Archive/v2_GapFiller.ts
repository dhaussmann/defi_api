/**
 * V2 Gap Filler - Automatically detects and fills data gaps
 * Runs as part of hourly cron to ensure data completeness
 */

export interface Env {
  DB_WRITE: D1Database;
}

interface DataGap {
  exchange: string;
  symbol: string;
  gap_start: number;
  gap_end: number;
  expected_records: number;
  actual_records: number;
}

/**
 * Detect gaps in data for all V2 exchanges
 * A gap is defined as missing hourly records between first and last timestamp
 */
export async function detectDataGaps(env: Env): Promise<DataGap[]> {
  const gaps: DataGap[] = [];
  const now = Date.now();
  const maxGapHours = 72; // Only check for gaps in last 72 hours

  // Check Lighter
  const lighterGaps = await env.DB_WRITE.prepare(`
    WITH RECURSIVE hours AS (
      SELECT 
        symbol,
        MIN(timestamp) as start_ts,
        MAX(timestamp) as end_ts,
        COUNT(*) as actual_count
      FROM lighter_raw_data
      WHERE timestamp > ?
      GROUP BY symbol
    )
    SELECT 
      'lighter' as exchange,
      symbol,
      start_ts as gap_start,
      end_ts as gap_end,
      CAST((end_ts - start_ts) / 3600000 AS INTEGER) + 1 as expected_records,
      actual_count as actual_records
    FROM hours
    WHERE actual_count < (CAST((end_ts - start_ts) / 3600000 AS INTEGER) + 1) * 0.95
  `).bind(now - maxGapHours * 3600000).all();

  if (lighterGaps.results) {
    gaps.push(...lighterGaps.results as DataGap[]);
  }

  // Check Hyperliquid
  const hyperliquidGaps = await env.DB_WRITE.prepare(`
    WITH RECURSIVE hours AS (
      SELECT 
        symbol,
        MIN(timestamp) as start_ts,
        MAX(timestamp) as end_ts,
        COUNT(*) as actual_count
      FROM hyperliquid_raw_data
      WHERE timestamp > ?
      GROUP BY symbol
    )
    SELECT 
      'hyperliquid' as exchange,
      symbol,
      start_ts as gap_start,
      end_ts as gap_end,
      CAST((end_ts - start_ts) / 3600000 AS INTEGER) + 1 as expected_records,
      actual_count as actual_records
    FROM hours
    WHERE actual_count < (CAST((end_ts - start_ts) / 3600000 AS INTEGER) + 1) * 0.95
  `).bind(now - maxGapHours * 3600000).all();

  if (hyperliquidGaps.results) {
    gaps.push(...hyperliquidGaps.results as DataGap[]);
  }

  // Check Extended
  const extendedGaps = await env.DB_WRITE.prepare(`
    WITH RECURSIVE hours AS (
      SELECT 
        symbol,
        MIN(timestamp) as start_ts,
        MAX(timestamp) as end_ts,
        COUNT(*) as actual_count
      FROM extended_raw_data
      WHERE timestamp > ?
      GROUP BY symbol
    )
    SELECT 
      'extended' as exchange,
      symbol,
      start_ts as gap_start,
      end_ts as gap_end,
      CAST((end_ts - start_ts) / 3600000 AS INTEGER) + 1 as expected_records,
      actual_count as actual_records
    FROM hours
    WHERE actual_count < (CAST((end_ts - start_ts) / 3600000 AS INTEGER) + 1) * 0.95
  `).bind(now - maxGapHours * 3600000).all();

  if (extendedGaps.results) {
    gaps.push(...extendedGaps.results as DataGap[]);
  }

  return gaps;
}

/**
 * Get the last timestamp for each exchange to determine lookback period
 */
export async function getLastTimestamps(env: Env): Promise<Map<string, number>> {
  const timestamps = new Map<string, number>();

  // Lighter
  const lighter = await env.DB_WRITE.prepare(
    'SELECT MAX(timestamp) as last_ts FROM lighter_raw_data'
  ).first<{last_ts: number}>();
  if (lighter?.last_ts) timestamps.set('lighter', lighter.last_ts);

  // Aster
  const aster = await env.DB_WRITE.prepare(
    'SELECT MAX(funding_time) as last_ts FROM aster_raw_data'
  ).first<{last_ts: number}>();
  if (aster?.last_ts) timestamps.set('aster', aster.last_ts);

  // Extended
  const extended = await env.DB_WRITE.prepare(
    'SELECT MAX(timestamp) as last_ts FROM extended_raw_data'
  ).first<{last_ts: number}>();
  if (extended?.last_ts) timestamps.set('extended', extended.last_ts);

  // Hyperliquid
  const hyperliquid = await env.DB_WRITE.prepare(
    'SELECT MAX(timestamp) as last_ts FROM hyperliquid_raw_data'
  ).first<{last_ts: number}>();
  if (hyperliquid?.last_ts) timestamps.set('hyperliquid', hyperliquid.last_ts);

  // Binance
  const binance = await env.DB_WRITE.prepare(
    'SELECT MAX(timestamp) as last_ts FROM binance_raw_data'
  ).first<{last_ts: number}>();
  if (binance?.last_ts) timestamps.set('binance', binance.last_ts);

  return timestamps;
}

/**
 * Calculate optimal lookback period for each exchange
 * Returns number of hours to look back
 */
export function calculateLookback(lastTimestamp: number | undefined): number {
  if (!lastTimestamp) {
    return 72; // Default 72 hours if no data
  }

  const now = Date.now();
  const hoursSinceLastUpdate = (now - lastTimestamp) / (1000 * 60 * 60);

  // Add buffer to ensure we catch all data
  const lookbackHours = Math.ceil(hoursSinceLastUpdate) + 2;

  // Cap at 168 hours (7 days) to avoid excessive API calls
  return Math.min(lookbackHours, 168);
}

/**
 * Log gap detection results
 */
export function logGapReport(gaps: DataGap[], timestamps: Map<string, number>): void {
  console.log('[Gap Filler] === Data Gap Report ===');
  console.log(`[Gap Filler] Detected ${gaps.length} gaps across exchanges`);

  if (gaps.length > 0) {
    console.log('[Gap Filler] Gaps requiring attention:');
    gaps.forEach(gap => {
      const missingRecords = gap.expected_records - gap.actual_records;
      const gapHours = (gap.gap_end - gap.gap_start) / (1000 * 60 * 60);
      console.log(
        `[Gap Filler]   ${gap.exchange}/${gap.symbol}: Missing ${missingRecords} records (${gapHours.toFixed(1)}h gap)`
      );
    });
  }

  console.log('[Gap Filler] Last timestamps:');
  timestamps.forEach((ts, exchange) => {
    const hoursAgo = (Date.now() - ts) / (1000 * 60 * 60);
    console.log(`[Gap Filler]   ${exchange}: ${hoursAgo.toFixed(1)} hours ago`);
  });
}
