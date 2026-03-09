export enum MarketType {
	CRYPTO = "crypto",
	STOCK = "stock",
	FOREX = "forex",
	ETF = "etf",
	INDEX = "index",
	COMMODITY = "commodity",
}

export interface UnifiedMarketData {
	ticker: string;
	marketPrice: number | null;
	fundingRateAPR: number;
	openInterest: number | null;
	maxLeverage: number | null;
	volume24h: number | null;
	spreadBidAsk: number | null;
	marketPriceChangePercent24h: number | null;
	marketType: MarketType;
}

export const stockMarkets: string[] = [
	...new Set([
		"abtc", "mstr", "stke", "cyph", "sbet", "bmnr", "hypd", "naka",
		"stss", "upxi", "asst", "alts", "hsdt", "bnc", "dfdv", "nvda",
		"msft", "aapl", "amzn", "goog", "fb", "tsla", "pltr", "gold",
		"hood", "intc", "coin", "meta", "orcl", "amd", "pzza", "alts",
		"upxi", "grnd", "bynd", "alh", "snap", "stke", "spot", "onds",
	]),
];

export const forexMarkets: string[] = [
	"eur", "gbp", "jpy", "cad", "chf", "aud", "nok", "bek", "nzd",
];

export const commodityMarkets: string[] = ["xau", "xag"];

export const indexMarkets: string[] = ["ndx", "xyz", "spx"];

export const etfMarkets: string[] = [
	"spy", "nvm", "qqq", "gld", "gdx", "sil", "ura", "slv", "remx",
];
