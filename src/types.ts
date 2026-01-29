// Lighter Exchange WebSocket Message Types

export interface LighterMarket {
  symbol: string;
  market_index: number;
}

export interface LighterMarketStats {
  symbol: string;
  market_id: number;
  index_price: string;
  mark_price: string;
  open_interest: string;
  open_interest_limit: string;
  funding_clamp_small: string;
  funding_clamp_big: string;
  last_trade_price: string;
  current_funding_rate: string;
  funding_rate: string;
  funding_timestamp: number;
  daily_base_token_volume: number;
  daily_quote_token_volume: number;
  daily_price_low: number;
  daily_price_high: number;
  daily_price_change: number;
}

export interface LighterWebSocketMessage {
  type: 'subscribed/market_stats' | 'update/market_stats' | 'error' | 'ping' | 'pong';
  channel?: string;
  market_stats?: LighterMarketStats;
  error?: string;
}

export interface LighterSubscribeMessage {
  type: 'subscribe';
  channel: string;
}

// Database Types

export interface MarketStatsRecord {
  id?: number;
  exchange: string;
  symbol: string;
  market_id: number;
  index_price: string;
  mark_price: string;
  open_interest: string;
  open_interest_usd?: string;
  open_interest_limit: string;
  funding_clamp_small: string;
  funding_clamp_big: string;
  last_trade_price: string;
  current_funding_rate: string;
  funding_rate: string;
  funding_timestamp: number;
  next_funding_time?: string;
  funding_interval_hours?: number;
  daily_base_token_volume: number;
  daily_quote_token_volume: number;
  daily_price_low: number;
  daily_price_high: number;
  daily_price_change: number;
  recorded_at: number;
  created_at?: number;
}

export interface TrackerStatusRecord {
  id?: number;
  exchange: string;
  status: string;
  last_message_at?: number;
  error_message?: string;
  reconnect_count?: number;
  updated_at?: number;
}

// Paradex Exchange Types

export interface ParadexMarket {
  symbol: string;
  base_currency: string;
  quote_currency: string;
  settlement_currency: string;
  order_size_increment: string;
  price_tick_size: string;
  min_notional: string;
  open_at: number;
  expiry_at: number;
  asset_kind: string;
  market_kind: string;
  position_limit: string;
  price_bands_width: string;
  max_slippage: string;
  max_open_orders: number;
  max_funding_rate: string;
  price_feed_id: string;
  oracle_ewma_factor: string;
  max_order_size: string;
  max_funding_rate_change: string;
  max_tob_spread: string;
  interest_rate: string;
  clamp_rate: string;
  funding_period_hours: number;
  funding_multiplier: number;
  tags?: string[];
}

export interface ParadexGreeks {
  delta: string;
  gamma: string;
  vega: string;
  rho: string;
  vanna: string;
  volga: string;
}

export interface ParadexMarketData {
  symbol: string;
  mark_price: string;
  mark_iv?: string;
  delta?: string;
  greeks?: ParadexGreeks;
  last_traded_price: string;
  bid: string;
  bid_iv?: string;
  ask: string;
  ask_iv?: string;
  last_iv?: string;
  volume_24h: string;
  total_volume: string;
  created_at: number;
  underlying_price?: string;
  open_interest: string;
  funding_rate: string;
  price_change_rate_24h: string;
  future_funding_rate?: string;
}

export interface ParadexWebSocketMessage {
  jsonrpc: string;
  method: string;
  params?: {
    channel: string;
    data?: ParadexMarketData;
  };
  id?: number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

export interface ParadexSubscribeMessage {
  jsonrpc: string;
  method: string;
  params: {
    channel: string;
  };
  id: number;
}

// Hyperliquid Exchange Types

export interface HyperliquidUniverse {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
}

export interface HyperliquidAssetCtx {
  dayNtlVlm: string;
  funding: string;
  impactPxs: [string, string];
  markPx: string;
  midPx: string;
  openInterest: string;
  oraclePx: string;
  premium: string;
  prevDayPx: string;
}

export interface HyperliquidMetaAndAssetCtxs {
  universe: HyperliquidUniverse[];
  assetCtxs: HyperliquidAssetCtx[];
}

// EdgeX Exchange Types

export interface EdgeXContract {
  contractId: string;
  contractName: string;
  baseCoinId: string;
  quoteCoinId: string;
  enableTrade: boolean;
  enableDisplay: boolean;
}

export interface EdgeXTickerData {
  contractId: string;
  contractName: string;
  priceChange: string;
  priceChangePercent: string;
  trades: string;
  size: string;
  value: string;
  high: string;
  low: string;
  open: string;
  close: string;
  lastPrice: string;
  indexPrice: string;
  oraclePrice: string;
  openInterest: string;
  fundingRate: string;
  fundingTime: string;
  nextFundingTime: string;
  bestAskPrice: string;
  bestBidPrice: string;
}

export interface EdgeXWebSocketMessage {
  type: 'quote-event' | 'subscribe' | 'unsubscribe' | 'ping' | 'pong';
  channel?: string;
  content?: {
    channel: string;
    dataType: string;
    data: EdgeXTickerData[];
  };
}

export interface EdgeXSubscribeMessage {
  type: 'subscribe';
  channel: string;
}

// Aster Exchange Types

export interface AsterSymbol {
  symbol: string;
  pair: string;
  contractType: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
}

export interface AsterExchangeInfo {
  symbols: AsterSymbol[];
}

export interface AsterPremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice: string;
  lastFundingRate: string;
  interestRate: string;
  nextFundingTime: number;
  time: number;
}

export interface AsterFundingInfo {
  symbol: string;
  interestRate: string;
  time: number;
  fundingIntervalHours: number;
  fundingFeeCap: number;
  fundingFeeFloor: number;
}

export interface AsterOpenInterest {
  symbol: string;
  openInterest: string;
  time: number;
}

export interface AsterKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
  takerBuyBaseVolume: string;
  takerBuyQuoteVolume: string;
  ignore: string;
}

// Pacifica Exchange Types

export interface PacificaPriceData {
  symbol: string;
  funding: string;
  next_funding: string;
  oracle: string;
  mark: string;
  mid: string;
  yesterday_price: string;
  open_interest: string;
  volume_24h: string;
  timestamp: number;
}

export interface PacificaWebSocketMessage {
  method?: string;
  params?: {
    source?: string;
  };
  data?: PacificaPriceData[];
}

// Cloudflare Workers Environment Bindings

export interface Env {
  LIGHTER_TRACKER: DurableObjectNamespace;
  PARADEX_TRACKER: DurableObjectNamespace;
  HYPERLIQUID_TRACKER: DurableObjectNamespace;
  EDGEX_TRACKER: DurableObjectNamespace;
  ASTER_TRACKER: DurableObjectNamespace;
  PACIFICA_TRACKER: DurableObjectNamespace;
  EXTENDED_TRACKER: DurableObjectNamespace;
  HYENA_TRACKER: DurableObjectNamespace;
  XYZ_TRACKER: DurableObjectNamespace;
  FLX_TRACKER: DurableObjectNamespace;
  VNTL_TRACKER: DurableObjectNamespace;
  KM_TRACKER: DurableObjectNamespace;
  VARIATIONAL_TRACKER: DurableObjectNamespace;
  DB: D1Database;
  SNAPSHOT_INTERVAL_MS?: string;
}

// API Response Types

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface MarketStatsQuery {
  exchange?: string;
  symbol?: string;
  from?: number;
  to?: number;
  limit?: number;
}
