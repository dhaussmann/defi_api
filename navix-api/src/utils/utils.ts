import {
	MarketType,
	stockMarkets,
	forexMarkets,
	etfMarkets,
	indexMarkets,
	commodityMarkets,
} from "../types/marketTypes";

export function calculateFundingRatesFromHourly(hourlyRate: number): number {
	return hourlyRate * 24 * 365;
}

export function calculateFundingRatesFrom8H(rate8H: number): number {
	return rate8H * 3 * 365;
}

export function getMarketType(ticker: string): MarketType {
	if (!ticker) return MarketType.CRYPTO;

	const t = ticker.toLowerCase();

	if (stockMarkets.includes(t)) return MarketType.STOCK;
	if (forexMarkets.includes(t)) return MarketType.FOREX;
	if (etfMarkets.includes(t)) return MarketType.ETF;
	if (indexMarkets.includes(t)) return MarketType.INDEX;
	if (commodityMarkets.includes(t)) return MarketType.COMMODITY;

	return MarketType.CRYPTO;
}
