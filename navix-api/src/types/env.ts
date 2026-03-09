export interface Env {
	DB: D1Database;
	MARKET_KV: KVNamespace;
	CLOUDFLARE_ACCOUNT_ID?: string;
	ANALYTICS_ENGINE_API_TOKEN?: string;
	TELEGRAM_BOT_TOKEN?: string;
	EXPO_ACCESS_TOKEN?: string;
	INTERNAL_API_KEY?: string;
	CORS_ORIGINS?: string;
}
