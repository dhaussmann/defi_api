import axios, { AxiosResponse } from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFrom8H } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

const AEVO_API_URL = "https://api.aevo.xyz";

const RATE_LIMIT_CONFIG = {
	MAX_CONCURRENT_REQUESTS: 2,
	DELAY_BETWEEN_REQUESTS_MS: 150,
	MAX_RETRIES: 3,
	INITIAL_RETRY_DELAY_MS: 1000,
	RETRY_MULTIPLIER: 2,
};

export class AevoService extends BaseExchangeService {
	private lastRequestTime = 0;

	private async rateLimitDelay(): Promise<void> {
		const now = Date.now();
		const timeSinceLastRequest = now - this.lastRequestTime;
		if (timeSinceLastRequest < RATE_LIMIT_CONFIG.DELAY_BETWEEN_REQUESTS_MS) {
			await this.sleep(RATE_LIMIT_CONFIG.DELAY_BETWEEN_REQUESTS_MS - timeSinceLastRequest);
		}
		this.lastRequestTime = Date.now();
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
		let lastError: any = null;
		for (let attempt = 0; attempt < RATE_LIMIT_CONFIG.MAX_RETRIES; attempt++) {
			try {
				await this.rateLimitDelay();
				return await operation();
			} catch (error: any) {
				lastError = error;
				const isRateLimitError = error?.response?.status === 429;
				if (isRateLimitError && attempt < RATE_LIMIT_CONFIG.MAX_RETRIES - 1) {
					const delay =
						RATE_LIMIT_CONFIG.INITIAL_RETRY_DELAY_MS *
						RATE_LIMIT_CONFIG.RETRY_MULTIPLIER ** attempt;
					console.log(
						`Rate limited on ${operationName}, retrying in ${delay}ms (attempt ${attempt + 1}/${RATE_LIMIT_CONFIG.MAX_RETRIES})`,
					);
					await this.sleep(delay);
				} else {
					throw error;
				}
			}
		}
		throw lastError;
	}

	private async mapWithConcurrency<T, R>(
		items: T[],
		concurrency: number,
		worker: (item: T, index: number) => Promise<R>,
	): Promise<R[]> {
		const results = new Array<R>(items.length);
		let nextIndex = 0;
		const runWorker = async () => {
			while (true) {
				const currentIndex = nextIndex++;
				if (currentIndex >= items.length) return;
				results[currentIndex] = await worker(items[currentIndex], currentIndex);
			}
		};
		const workers = Array.from(
			{ length: Math.min(concurrency, items.length) },
			() => runWorker(),
		);
		await Promise.all(workers);
		return results;
	}

	async getMarkets(): Promise<UnifiedMarketData[]> {
		const url = `${AEVO_API_URL}/markets`;
		const startTime = Date.now();
		logApiRequest("GET", url);

		try {
			const response = await axios.get(url, { params: { instrument_type: "PERPETUAL" } });
			logApiResponse("GET", url, response.status, Date.now() - startTime);

			if (!response.data || !Array.isArray(response.data)) {
				throw new Error("Invalid market response");
			}

			const perpetualMarkets = response.data.filter(
				(m: any) => m.instrument_type === "PERPETUAL" && m.is_active,
			);

			const fundingCache = new Map<string, any>();
			const statisticsCache = new Map<string, any>();

			const marketData = await this.mapWithConcurrency(
				perpetualMarkets,
				RATE_LIMIT_CONFIG.MAX_CONCURRENT_REQUESTS,
				async (market: any) => {
					try {
						const baseTicker = this.extractBaseTicker(market.instrument_name);
						let fundingData = fundingCache.get(market.instrument_name);
						if (!fundingData) {
							fundingData = await this.withRetry(
								() => this.getCurrentFundingRate(market.instrument_name),
								`funding/${market.instrument_name}`,
							);
							fundingCache.set(market.instrument_name, fundingData);
						}

						let statisticsData = statisticsCache.get(baseTicker);
						if (statisticsData === undefined) {
							try {
								statisticsData = await this.withRetry(
									() => this.getStatistics(baseTicker),
									`statistics/${baseTicker}`,
								);
							} catch {
								statisticsData = null;
							}
							statisticsCache.set(baseTicker, statisticsData);
						}

						const fundingRate = parseFloat(fundingData.funding_rate);
						const fundingRateAPR = calculateFundingRatesFrom8H(fundingRate);

						return {
							ticker: baseTicker,
							marketPrice: parseFloat(market.mark_price),
							fundingRateAPR,
							openInterest: statisticsData
								? parseFloat(statisticsData.open_interest.total) *
									parseFloat(market.mark_price)
								: null,
							maxLeverage: parseFloat(market.max_leverage),
							volume24h: statisticsData
								? parseFloat(statisticsData.daily_volume)
								: null,
							spreadBidAsk: null,
							marketPriceChangePercent24h: statisticsData
								? ((parseFloat(statisticsData.mark_price) -
										parseFloat(statisticsData.mark_price_24h_ago)) /
										parseFloat(statisticsData.mark_price_24h_ago)) *
									100
								: null,
							marketType: MarketType.CRYPTO,
						} as UnifiedMarketData;
					} catch (error) {
						console.warn(`Failed to get data for ${market.instrument_name}:`, error);
						return {
							ticker: this.extractBaseTicker(market.instrument_name),
							marketPrice: parseFloat(market.mark_price),
							fundingRateAPR: 0,
							openInterest: null,
							maxLeverage: parseFloat(market.max_leverage),
							volume24h: null,
							spreadBidAsk: null,
							marketPriceChangePercent24h: null,
							marketType: MarketType.CRYPTO,
						} as UnifiedMarketData;
					}
				},
			);

			return marketData;
		} catch (error) {
			logApiError("GET", url, error, Date.now() - startTime);
			throw error;
		}
	}

	private async getCurrentFundingRate(instrumentName: string): Promise<any> {
		const url = `${AEVO_API_URL}/funding`;
		const startTime = Date.now();
		logApiRequest("GET", url, { instrument_name: instrumentName });
		try {
			const response = await axios.get(url, { params: { instrument_name: instrumentName } });
			logApiResponse("GET", url, response.status, Date.now() - startTime);
			return response.data;
		} catch (error) {
			logApiError("GET", url, error, Date.now() - startTime);
			throw error;
		}
	}

	private async getStatistics(asset: string): Promise<any> {
		const url = `${AEVO_API_URL}/statistics`;
		const startTime = Date.now();
		logApiRequest("GET", url, { asset, instrument_type: "PERPETUAL" });
		try {
			const response = await axios.get(url, {
				params: { asset, instrument_type: "PERPETUAL" },
			});
			logApiResponse("GET", url, response.status, Date.now() - startTime);
			return response.data;
		} catch (error) {
			logApiError("GET", url, error, Date.now() - startTime);
			throw error;
		}
	}

	private extractBaseTicker(instrumentName: string): string {
		return instrumentName.split("-")[0];
	}
}
