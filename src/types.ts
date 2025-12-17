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
  type: 'subscribed/market_stats' | 'error' | 'ping' | 'pong';
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

// Cloudflare Workers Environment Bindings

export interface Env {
  LIGHTER_TRACKER: DurableObjectNamespace;
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
