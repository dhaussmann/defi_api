import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFrom8H } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";
import { tradeXYZSymbolToHyperliquid } from "../../utils/tickersMapper";

const HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz/info";

export class HyperliquidService extends BaseExchangeService {
	async getMarkets(): Promise<UnifiedMarketData[]> {
		const [hyperliquidMarkets, xyzMarkets] = await Promise.all([
			this.getAllHyperliquidMarkets(),
			this.getAllXYZMarkets(),
		]);
		return hyperliquidMarkets.concat(xyzMarkets);
	}

	private async getAllHyperliquidMarkets(): Promise<UnifiedMarketData[]> {
		const url = HYPERLIQUID_API_URL;
		const requestBody = { type: "metaAndAssetCtxs" };
		const startTime = Date.now();
		logApiRequest("POST", url, requestBody);

		try {
			const response = await axios.post(url, requestBody);
			logApiResponse("POST", url, response.status, Date.now() - startTime);
			const [meta, assetContexts] = response.data;
			return this.mapMarket({ meta, assetContexts, marketType: MarketType.CRYPTO });
		} catch (error) {
			logApiError("POST", url, error, Date.now() - startTime);
			console.error("Error fetching HyperLiquid markets:", error);
			throw error;
		}
	}

	private async getAllXYZMarkets(): Promise<UnifiedMarketData[]> {
		const url = HYPERLIQUID_API_URL;
		const requestBody = { type: "metaAndAssetCtxs", dex: "xyz" };
		const startTime = Date.now();
		logApiRequest("POST", url, requestBody);

		try {
			const response = await axios.post(url, requestBody);
			logApiResponse("POST", url, response.status, Date.now() - startTime);
			const [meta, assetContexts] = response.data;
			return this.mapMarket({ meta, assetContexts, marketType: MarketType.STOCK });
		} catch (error) {
			logApiError("POST", url, error, Date.now() - startTime);
			console.error("Error fetching HyperLiquid XYZ markets:", error);
			throw error;
		}
	}

	private mapMarket({
		meta,
		assetContexts,
		marketType,
	}: {
		meta: any;
		assetContexts: any[];
		marketType: MarketType;
	}): UnifiedMarketData[] {
		return meta.universe
			.map((market: any, index: number) => {
				if (market.isDelisted) return null;

				const rate8H = parseFloat(assetContexts[index]?.funding || "0") * 8;
				const fundingRateAPR = calculateFundingRatesFrom8H(rate8H);
				const marketPrice = assetContexts[index]?.markPx
					? parseFloat(assetContexts[index].markPx)
					: null;
				const openInterestInTokens = assetContexts[index]?.openInterest
					? parseFloat(assetContexts[index].openInterest)
					: null;
				const volume24h = assetContexts[index]?.dayNtlVlm
					? parseFloat(assetContexts[index].dayNtlVlm)
					: null;

				return {
					ticker:
						marketType !== MarketType.CRYPTO
							? tradeXYZSymbolToHyperliquid(market.name)
							: market.name,
					marketPrice,
					fundingRateAPR,
					openInterest:
						openInterestInTokens && marketPrice
							? openInterestInTokens * marketPrice
							: null,
					maxLeverage: market.maxLeverage || null,
					volume24h,
					spreadBidAsk:
						assetContexts[index]?.impactPxs && assetContexts[index].markPx
							? ((parseFloat(assetContexts[index].impactPxs[1]) -
									parseFloat(assetContexts[index].impactPxs[0])) /
									assetContexts[index].markPx) *
								100
							: null,
					marketPriceChangePercent24h: assetContexts[index]?.markPx
						? ((parseFloat(assetContexts[index].markPx) -
								parseFloat(assetContexts[index].prevDayPx)) /
								parseFloat(assetContexts[index].prevDayPx)) *
							100
						: null,
					marketType,
				} as UnifiedMarketData;
			})
			.filter((item: UnifiedMarketData | null): item is UnifiedMarketData => item !== null);
	}
}
