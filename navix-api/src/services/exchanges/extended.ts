import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFrom8H } from "../../utils/utils";
import { extendedSymbolToHyperliquid } from "../../utils/tickersMapper";
import { getMarketType } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var EXTENDED_API_URL = "https://api.starknet.extended.exchange/api/v1/info";
export class ExtendedService extends BaseExchangeService {
  // Get all markets in unified format
  async getMarkets() {
    const url = `${EXTENDED_API_URL}/markets`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      const allMarkets = response.data.data;
      return allMarkets.filter((market) => {
        return market.active && market.status === "ACTIVE";
      }).map((market) => {
        const rate8H = parseFloat(market.marketStats.fundingRate) * 8;
        const fundingRateAPR = calculateFundingRatesFrom8H(rate8H);
        const openInterest = parseFloat(market.marketStats.openInterest);
        const baseCurrency = market.assetName || extendedSymbolToHyperliquid(market.name);
        return {
          ticker: baseCurrency,
          marketPrice: market.marketStats.markPrice ? parseFloat(market.marketStats.markPrice) : null,
          fundingRateAPR,
          openInterest,
          maxLeverage: market.tradingConfig?.maxLeverage ? parseFloat(market.tradingConfig.maxLeverage) : null,
          volume24h: market.marketStats?.dailyVolume ? parseFloat(market.marketStats.dailyVolume) : null,
          marketPriceChangePercent24h: parseFloat(market.marketStats.dailyPriceChangePercentage) * 100,
          spreadBidAsk: market.marketStats?.askPrice && market.marketStats?.bidPrice ? (parseFloat(market.marketStats.askPrice) - parseFloat(market.marketStats.bidPrice)) / parseFloat(market.marketStats.markPrice) * 100 : null,
          marketType: getMarketType(baseCurrency)
        };
      });
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      throw error3;
    }
  }
  /* 	// Get funding data history for a specific ticker with configurable period
  	async getFundingData(
  		hyperliquidTicker: string,
  		period: FundingPeriod = 3,
  	): Promise<UnifiedFundingData[]> {
  		const extendedSymbol = hyperliquidToExtendedTicker(hyperliquidTicker);
  		const { startTime, endTime, intervalHours } = this.getPeriodRange(period);
  
  		const url = `${EXTENDED_API_URL}/${extendedSymbol}/funding`;
  		const params = {
  			startTime: Math.floor(startTime / 1000) * 1000, // Convert to milliseconds and round
  			endTime: Math.floor(endTime / 1000) * 1000,
  		} as ExtendedFundingHistoryParams;
  		const requestStartTime = Date.now();
  
  		logApiRequest("GET", url, params);
  
  		try {
  			const response: AxiosResponse<ExtendedFundingHistoryResponse> = await axios.get(url, {
  				params,
  			});
  
  			logApiResponse("GET", url, response.status, Date.now() - requestStartTime);
  
  			const fundingHistory = response.data.data;
  
  			// Sort by timestamp first, then filter to keep points based on dynamic interval
  			fundingHistory.sort((a: ExtendedFundingPoint, b: ExtendedFundingPoint) => b.T - a.T);
  			const filteredHistory = fundingHistory.filter(
  				(_: ExtendedFundingPoint, index: number) => index % intervalHours === 0, // Dynamic interval filtering
  			);
  			filteredHistory.sort((a: ExtendedFundingPoint, b: ExtendedFundingPoint) => a.T - b.T);
  
  			// Convert to unified format
  			const unifiedHistory: UnifiedFundingData[] = filteredHistory.map(
  				(point: ExtendedFundingPoint) => {
  					const rateInterval = parseFloat(point.f) * intervalHours;
  					const { fundingRate8H, fundingRateAPR } = this.calculateFundingRatesFrom8H(rateInterval);
  
  					return {
  						ticker: hyperliquidTicker, // Return in HyperLiquid format
  						timestamp: point.T,
  						fundingRate8H,
  						fundingRateAPR,
  					};
  				},
  			);
  
  			return unifiedHistory;
  		} catch (error) {
  			logApiError("GET", url, error, Date.now() - requestStartTime);
  			throw error;
  		}
  	}
   */
};
