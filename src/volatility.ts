/**
 * Volatility Calculation Module
 *
 * Provides comprehensive volatility metrics:
 * - ATR (Average True Range)
 * - Bollinger Band Width
 * - Historical Volatility
 * - Standard Deviation
 */

import { Env } from './types';

export interface PriceData {
  timestamp: number;
  high: number;
  low: number;
  close: number;
  open?: number;
}

export interface VolatilityMetrics {
  volatility_24h: number;      // 24h realized volatility (%)
  volatility_7d: number;        // 7d realized volatility (%)
  atr_14: number;               // 14-period Average True Range
  bb_width: number;             // Bollinger Band Width (%)
  price_std_dev: number;        // Standard Deviation
  high_24h: number;             // 24h high
  low_24h: number;              // 24h low
  avg_price_24h: number;        // 24h average
}

/**
 * Berechnet True Range für eine Periode
 */
function calculateTrueRange(current: PriceData, previous: PriceData | null): number {
  if (!previous) {
    return current.high - current.low;
  }

  const tr1 = current.high - current.low;
  const tr2 = Math.abs(current.high - previous.close);
  const tr3 = Math.abs(current.low - previous.close);

  return Math.max(tr1, tr2, tr3);
}

/**
 * Berechnet Average True Range (ATR)
 * @param data Array von Preisdaten (mindestens 14 Perioden)
 * @param period ATR Periode (Standard: 14)
 */
export function calculateATR(data: PriceData[], period: number = 14): number {
  if (data.length < period + 1) {
    return 0;
  }

  // Sortiere nach Timestamp (älteste zuerst)
  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);

  // Berechne True Ranges
  const trueRanges: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const tr = calculateTrueRange(sorted[i], sorted[i - 1]);
    trueRanges.push(tr);
  }

  // Erste ATR: Durchschnitt der ersten N True Ranges
  let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;

  // Smoothed ATR: (Previous ATR × (period - 1) + Current TR) / period
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
  }

  return atr;
}

/**
 * Berechnet Standardabweichung
 */
function calculateStdDev(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;

  return Math.sqrt(variance);
}

/**
 * Berechnet Bollinger Band Width
 * @param data Array von Preisdaten (mindestens 20 Perioden empfohlen)
 * @param period Periode für Moving Average (Standard: 20)
 * @param stdDevMultiplier Standardabweichungs-Multiplikator (Standard: 2)
 */
export function calculateBollingerBandWidth(
  data: PriceData[],
  period: number = 20,
  stdDevMultiplier: number = 2
): number {
  if (data.length < period) {
    return 0;
  }

  // Sortiere nach Timestamp
  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);

  // Nehme die letzten N Perioden
  const recentPrices = sorted.slice(-period).map(d => d.close);

  // Berechne SMA (Simple Moving Average)
  const sma = recentPrices.reduce((sum, price) => sum + price, 0) / period;

  // Berechne Standardabweichung
  const stdDev = calculateStdDev(recentPrices);

  // Bollinger Bands
  const upperBand = sma + (stdDevMultiplier * stdDev);
  const lowerBand = sma - (stdDevMultiplier * stdDev);

  // Band Width in Prozent vom Mittelwert
  const bandWidth = ((upperBand - lowerBand) / sma) * 100;

  return bandWidth;
}

/**
 * Berechnet Realized Volatility (Historische Volatilität)
 * Basierend auf logarithmischen Returns
 *
 * @param data Array von Preisdaten
 * @param annualizeFactor Annualisierungsfaktor (365 für Tage, 8760 für Stunden)
 */
export function calculateRealizedVolatility(
  data: PriceData[],
  annualizeFactor: number = 365
): number {
  if (data.length < 2) {
    return 0;
  }

  // Sortiere nach Timestamp
  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);

  // Berechne logarithmische Returns
  const logReturns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const logReturn = Math.log(sorted[i].close / sorted[i - 1].close);
    logReturns.push(logReturn);
  }

  // Standardabweichung der Returns
  const stdDev = calculateStdDev(logReturns);

  // Annualisierte Volatilität in Prozent
  const volatility = stdDev * Math.sqrt(annualizeFactor) * 100;

  return volatility;
}

/**
 * Haupt-Funktion: Berechnet alle Volatilitäts-Metriken für ein Exchange-Symbol Paar
 */
export async function calculateVolatilityMetrics(
  env: Env,
  exchange: string,
  symbol: string
): Promise<VolatilityMetrics | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;
    const sevenDaysAgo = now - 604800;

    // 24h Daten holen (stündliche Aggregation)
    const data24h = await env.DB.prepare(`
      SELECT
        hour_timestamp as timestamp,
        avg_mark_price as close,
        max_price as high,
        min_price as low
      FROM market_history
      WHERE exchange = ? AND symbol = ? AND hour_timestamp > ?
      ORDER BY hour_timestamp ASC
    `).bind(exchange, symbol, oneDayAgo).all();

    // 7d Daten holen
    const data7d = await env.DB.prepare(`
      SELECT
        hour_timestamp as timestamp,
        avg_mark_price as close,
        max_price as high,
        min_price as low
      FROM market_history
      WHERE exchange = ? AND symbol = ? AND hour_timestamp > ?
      ORDER BY hour_timestamp ASC
    `).bind(exchange, symbol, sevenDaysAgo).all();

    if (!data24h.results || data24h.results.length < 2) {
      return null;
    }

    // Konvertiere zu PriceData Format
    const priceData24h: PriceData[] = (data24h.results as any[]).map(row => ({
      timestamp: row.timestamp,
      high: parseFloat(row.high || '0'),
      low: parseFloat(row.low || '0'),
      close: parseFloat(row.close || '0'),
    }));

    const priceData7d: PriceData[] = (data7d.results as any[]).map(row => ({
      timestamp: row.timestamp,
      high: parseFloat(row.high || '0'),
      low: parseFloat(row.low || '0'),
      close: parseFloat(row.close || '0'),
    }));

    // Berechne Metriken
    const volatility24h = calculateRealizedVolatility(priceData24h, 365);
    const volatility7d = priceData7d.length >= 2
      ? calculateRealizedVolatility(priceData7d, 365)
      : volatility24h;

    const atr14 = calculateATR(priceData24h, 14);
    const bbWidth = calculateBollingerBandWidth(priceData24h, 20, 2);

    // Standardabweichung der 24h Preise
    const prices24h = priceData24h.map(d => d.close);
    const priceStdDev = calculateStdDev(prices24h);

    // 24h High/Low/Avg
    const high24h = Math.max(...priceData24h.map(d => d.high));
    const low24h = Math.min(...priceData24h.map(d => d.low));
    const avgPrice24h = prices24h.reduce((sum, p) => sum + p, 0) / prices24h.length;

    return {
      volatility_24h: volatility24h,
      volatility_7d: volatility7d,
      atr_14: atr14,
      bb_width: bbWidth,
      price_std_dev: priceStdDev,
      high_24h: high24h,
      low_24h: low24h,
      avg_price_24h: avgPrice24h,
    };

  } catch (error) {
    console.error(`[Volatility] Error calculating metrics for ${exchange}/${symbol}:`, error);
    return null;
  }
}

/**
 * Berechnet Volatilitäts-Metriken für alle aktiven Markets
 */
export async function calculateAllVolatilityMetrics(env: Env): Promise<void> {
  console.log('[Volatility] Starting calculation for all markets');

  try {
    // Hole alle aktiven Exchange-Symbol Kombinationen aus normalized_tokens
    // und hole die original symbols aus market_history für die Berechnung
    const result = await env.DB.prepare(`
      SELECT DISTINCT nt.exchange, nt.symbol as normalized_symbol, mh.symbol as original_symbol
      FROM normalized_tokens nt
      INNER JOIN market_history mh ON nt.exchange = mh.exchange AND nt.original_symbol = mh.symbol
      WHERE mh.hour_timestamp > ?
      ORDER BY nt.exchange, nt.symbol
    `).bind(Math.floor(Date.now() / 1000) - 86400).all();

    if (!result.results || result.results.length === 0) {
      console.log('[Volatility] No active markets found');
      return;
    }

    const markets = result.results as { exchange: string; normalized_symbol: string; original_symbol: string }[];
    console.log(`[Volatility] Calculating metrics for ${markets.length} unique markets`);

    const calculatedAt = Math.floor(Date.now() / 1000);
    const updates: any[] = [];

    // Berechne für alle Markets (jetzt sinnvoll limitiert)
    const marketsToProcess = markets.slice(0, 200);
    console.log(`[Volatility] Processing ${marketsToProcess.length} markets out of ${markets.length} total`);

    for (const market of marketsToProcess) {
      try {
        console.log(`[Volatility] Calculating for ${market.exchange}/${market.original_symbol} (normalized: ${market.normalized_symbol})`);
        const metrics = await calculateVolatilityMetrics(env, market.exchange, market.original_symbol);

        if (!metrics) {
          console.log(`[Volatility] No metrics returned for ${market.exchange}/${market.original_symbol} - skipping`);
          continue;
        }

        console.log(`[Volatility] Got metrics for ${market.exchange}/${market.original_symbol}:`, {
          vol24h: metrics.volatility_24h,
          atr: metrics.atr_14,
          bbw: metrics.bb_width
        });

        // Update normalized_tokens with normalized symbol
        updates.push(
          env.DB.prepare(`
            UPDATE normalized_tokens
            SET
              volatility_24h = ?,
              volatility_7d = ?,
              atr_14 = ?,
              bb_width = ?
            WHERE exchange = ? AND symbol = ?
          `).bind(
            metrics.volatility_24h,
            metrics.volatility_7d,
            metrics.atr_14,
            metrics.bb_width,
            market.exchange,
            market.normalized_symbol
          )
        );

        // Insert into volatility_stats für 24h (use original symbol for stats table)
        updates.push(
          env.DB.prepare(`
            INSERT INTO volatility_stats (
              exchange, symbol, period, volatility, atr, bb_width, std_dev,
              high, low, avg_price, calculated_at
            ) VALUES (?, ?, '24h', ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(exchange, symbol, period)
            DO UPDATE SET
              volatility = excluded.volatility,
              atr = excluded.atr,
              bb_width = excluded.bb_width,
              std_dev = excluded.std_dev,
              high = excluded.high,
              low = excluded.low,
              avg_price = excluded.avg_price,
              calculated_at = excluded.calculated_at
          `).bind(
            market.exchange,
            market.original_symbol,
            metrics.volatility_24h,
            metrics.atr_14,
            metrics.bb_width,
            metrics.price_std_dev,
            metrics.high_24h,
            metrics.low_24h,
            metrics.avg_price_24h,
            calculatedAt
          )
        );
      } catch (marketError) {
        console.error(`[Volatility] Error calculating metrics for ${market.exchange}/${market.original_symbol}:`, marketError);
        continue;
      }
    }

    // Batch-Execute
    if (updates.length > 0) {
      await env.DB.batch(updates);
      console.log(`[Volatility] ✅ Updated ${updates.length / 2} markets with volatility metrics`);
    }

  } catch (error) {
    console.error('[Volatility] Error in bulk calculation:', error);
  }
}
