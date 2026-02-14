/**
 * V3 Exchange Configuration
 * 
 * Centralized configuration for all exchanges including:
 * - Rate format (decimal vs percent)
 * - Conversion factors
 * - Interval information
 * - API endpoints
 * - Validation ranges
 */

export type RateFormat = 'decimal' | 'percent' | 'basis_points';

export interface ExchangeConfig {
  name: string;
  
  // Rate Format Configuration
  rateFormat: RateFormat;
  conversionFactor: number;  // Factor to convert to percent
  
  // Interval Configuration
  defaultIntervalHours: number;
  hasVariableInterval: boolean;
  
  // API Configuration
  apiBaseUrl: string;
  requiresUserAgent: boolean;
  
  // Validation Ranges (in percent)
  validation: {
    minRatePercent: number;  // Minimum expected rate (e.g., -10%)
    maxRatePercent: number;  // Maximum expected rate (e.g., +10%)
    warnThreshold: number;   // Warn if rate exceeds this (e.g., 1%)
  };
  
  // Market Configuration
  dynamicMarkets: boolean;  // Fetch markets from API vs hardcoded
  
  // Special Fields
  hasDirection?: boolean;    // Lighter has direction field
  hasCumulativeValue?: boolean;  // Lighter has cumulative value
}

/**
 * Exchange Configurations
 */
export const EXCHANGE_CONFIGS: Record<string, ExchangeConfig> = {
  extended: {
    name: 'Extended',
    rateFormat: 'decimal',
    conversionFactor: 100,  // 0.0001 → 0.01%
    defaultIntervalHours: 1,
    hasVariableInterval: false,
    apiBaseUrl: 'https://api.starknet.extended.exchange/api/v1',
    requiresUserAgent: true,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  hyperliquid: {
    name: 'Hyperliquid',
    rateFormat: 'decimal',
    conversionFactor: 100,  // 0.0001 → 0.01%
    defaultIntervalHours: 1,
    hasVariableInterval: false,
    apiBaseUrl: 'https://api.hyperliquid.xyz',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  lighter: {
    name: 'Lighter',
    rateFormat: 'percent',  // API returns percent values directly (0.01 = 0.01%)
    conversionFactor: 1,    // No conversion needed
    defaultIntervalHours: 8,
    hasVariableInterval: true,
    apiBaseUrl: 'https://mainnet.zklighter.elliot.ai/api/v1',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true,
    hasDirection: true,
    hasCumulativeValue: true
  },
  
  aster: {
    name: 'Aster',
    rateFormat: 'decimal',
    conversionFactor: 100,  // 0.0001 → 0.01%
    defaultIntervalHours: 8,
    hasVariableInterval: true,
    apiBaseUrl: 'https://fapi.asterdex.com/fapi/v1',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  nado: {
    name: 'Nado',
    rateFormat: 'decimal',
    conversionFactor: 100,  // Rate from x18 format → percent
    defaultIntervalHours: 24,  // 24hr funding rate
    hasVariableInterval: false,
    apiBaseUrl: 'https://gateway.test.nado.xyz/v2',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  hyena: {
    name: 'HyENA',
    rateFormat: 'decimal',
    conversionFactor: 100,  // 0.0001 → 0.01%
    defaultIntervalHours: 1,  // 1h funding rate (same as Hyperliquid)
    hasVariableInterval: false,
    apiBaseUrl: 'https://api.hyperliquid.xyz',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  felix: {
    name: 'Felix',
    rateFormat: 'decimal',
    conversionFactor: 100,  // 0.0001 → 0.01%
    defaultIntervalHours: 1,  // 1h funding rate (same as Hyperliquid)
    hasVariableInterval: false,
    apiBaseUrl: 'https://api.hyperliquid.xyz',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  ventuals: {
    name: 'Ventuals',
    rateFormat: 'decimal',
    conversionFactor: 100,  // 0.0001 → 0.01%
    defaultIntervalHours: 1,  // 1h funding rate (same as Hyperliquid)
    hasVariableInterval: false,
    apiBaseUrl: 'https://api.hyperliquid.xyz',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  xyz: {
    name: 'XYZ',
    rateFormat: 'decimal',
    conversionFactor: 100,  // 0.0001 → 0.01%
    defaultIntervalHours: 1,  // 1h funding rate (same as Hyperliquid)
    hasVariableInterval: false,
    apiBaseUrl: 'https://api.hyperliquid.xyz',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  variational: {
    name: 'Variational',
    rateFormat: 'decimal',  // Rate already converted in collector (funding_rate / 10 / 100)
    conversionFactor: 100,  // Convert to percent
    defaultIntervalHours: 8,  // Default 8h, but variable per market
    hasVariableInterval: true,
    apiBaseUrl: 'https://omni-client-api.prod.ap-northeast-1.variational.io',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  paradex: {
    name: 'Paradex',
    rateFormat: 'decimal',
    conversionFactor: 100,  // 0.00004723617486 → 0.004723617486%
    defaultIntervalHours: 8,  // 8h funding rate
    hasVariableInterval: false,
    apiBaseUrl: 'https://api.prod.paradex.trade',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },
  
  ethereal: {
    name: 'Ethereal',
    rateFormat: 'decimal',
    conversionFactor: 100,  // -0.000008856 → -0.0008856%
    defaultIntervalHours: 1,  // fundingRate1h is already 1h rate
    hasVariableInterval: false,
    apiBaseUrl: 'https://api.ethereal.trade',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  },

  edgex: {
    name: 'EdgeX',
    rateFormat: 'decimal',
    conversionFactor: 100,  // 0.00005000 → 0.005%
    defaultIntervalHours: 4,  // 4h funding rate (240 minutes)
    hasVariableInterval: false,
    apiBaseUrl: 'https://pro.edgex.exchange/api/v1/public',
    requiresUserAgent: false,
    validation: {
      minRatePercent: -10,
      maxRatePercent: 10,
      warnThreshold: 1
    },
    dynamicMarkets: true
  }
};

/**
 * Convert raw rate to percent based on exchange configuration
 */
export function convertRateToPercent(
  rawRate: number,
  exchangeName: string
): number {
  const config = EXCHANGE_CONFIGS[exchangeName];
  if (!config) {
    throw new Error(`Unknown exchange: ${exchangeName}`);
  }
  
  let ratePercent: number;
  
  switch (config.rateFormat) {
    case 'decimal':
      ratePercent = rawRate * config.conversionFactor;
      break;
    case 'percent':
      ratePercent = rawRate;
      break;
    case 'basis_points':
      ratePercent = rawRate / 100;  // 100 bps = 1%
      break;
    default:
      throw new Error(`Unknown rate format: ${config.rateFormat}`);
  }
  
  return ratePercent;
}

/**
 * Validate rate is within expected range
 */
export function validateRate(
  ratePercent: number,
  exchangeName: string
): { valid: boolean; warning: boolean; message?: string } {
  const config = EXCHANGE_CONFIGS[exchangeName];
  if (!config) {
    return { valid: false, warning: false, message: `Unknown exchange: ${exchangeName}` };
  }
  
  const { minRatePercent, maxRatePercent, warnThreshold } = config.validation;
  
  // Check if completely out of range
  if (ratePercent < minRatePercent || ratePercent > maxRatePercent) {
    return {
      valid: false,
      warning: false,
      message: `Rate ${ratePercent}% is outside valid range [${minRatePercent}%, ${maxRatePercent}%]`
    };
  }
  
  // Check if exceeds warning threshold
  if (Math.abs(ratePercent) > warnThreshold) {
    return {
      valid: true,
      warning: true,
      message: `Rate ${ratePercent}% exceeds warning threshold ${warnThreshold}%`
    };
  }
  
  return { valid: true, warning: false };
}

/**
 * Calculate normalized rates based on interval
 */
export function calculateRates(
  rawRate: number,
  intervalHours: number,
  exchangeName: string
): {
  rateRaw: number;
  rateRawPercent: number;
  rate1hPercent: number;
  rateApr: number;
} {
  const rateRawPercent = convertRateToPercent(rawRate, exchangeName);
  const rate1hPercent = rateRawPercent / intervalHours;
  const eventsPerYear = (365 * 24) / intervalHours;
  const rateApr = rateRawPercent * eventsPerYear;
  
  return {
    rateRaw: rawRate,
    rateRawPercent,
    rate1hPercent,
    rateApr
  };
}

/**
 * Get exchange configuration
 */
export function getExchangeConfig(exchangeName: string): ExchangeConfig {
  const config = EXCHANGE_CONFIGS[exchangeName];
  if (!config) {
    throw new Error(`Unknown exchange: ${exchangeName}`);
  }
  return config;
}

/**
 * Get all supported exchanges
 */
export function getSupportedExchanges(): string[] {
  return Object.keys(EXCHANGE_CONFIGS);
}
