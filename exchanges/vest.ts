import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFromHourly } from "../../utils/utils";
import { getMarketType } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";
import { vestSymbolToHyperliquid, rwaMapper } from "../../utils/tickersMapper";

var VEST_API_URL = "https://server-prod.hz.vestmarkets.com/v2";
var VEST_HEADERS = {
  xrestservermm: "restserver0"
};
export class VestService extends BaseExchangeService {
  // Get all markets in unified format
  async getMarkets() {
    const urlTickers = `${VEST_API_URL}/ticker/latest`;
    const urlTickers24h = `${VEST_API_URL}/ticker/24hr`;
    const startTime = Date.now();
    logApiRequest("GET", urlTickers);
    logApiRequest("GET", urlTickers24h);
    try {
      const vestTickersResponse = await axios.get(urlTickers, {
        headers: VEST_HEADERS
      });
      const vestTickers24hResponse = await axios.get(
        urlTickers24h,
        {
          headers: VEST_HEADERS
        }
      );
      logApiResponse("GET", urlTickers, vestTickersResponse.status, Date.now() - startTime);
      logApiResponse("GET", urlTickers24h, vestTickers24hResponse.status, Date.now() - startTime);
      const allTickers = vestTickersResponse.data.tickers || [];
      return allTickers.filter((vestTicker) => {
        return vestTicker.status === "TRADING" && vestTicker.symbol.includes("-") && vestTickers24hResponse.data.tickers.some(
          (ticker) => ticker.symbol === vestTicker.symbol
        );
      }).map((vestTicker) => {
        const hourlyRate = parseFloat(vestTicker.oneHrFundingRate || "0");
        const fundingRateAPR = calculateFundingRatesFromHourly(hourlyRate);
        const baseCurrency = vestSymbolToHyperliquid(vestTicker.symbol);
        const additionalData = vestTickers24hResponse.data.tickers.find(
          (ticker) => ticker.symbol === vestTicker.symbol
        );
        let marketType = MarketType.CRYPTO;
        if (vestTicker.symbol.includes("-USD-")) {
          marketType = getMarketType(baseCurrency);
          if (marketType === MarketType.CRYPTO) {
            marketType = MarketType.STOCK;
          }
        }
        return {
          ticker: rwaMapper(baseCurrency),
          marketPrice: vestTicker.markPrice ? parseFloat(vestTicker.markPrice) : null,
          marketPriceChangePercent24h: additionalData?.priceChangePercent ? parseFloat(additionalData?.priceChangePercent ?? "0") * 100 : null,
          fundingRateAPR,
          openInterest: null,
          // Vest doesn't provide open interest in ticker endpoint
          maxLeverage: null,
          volume24h: additionalData?.quoteVolume ? parseFloat(additionalData?.quoteVolume ?? "0") : null,
          spreadBidAsk: vestTicker.markPrice && vestTicker.indexPrice ? Math.abs(parseFloat(vestTicker.markPrice) - parseFloat(vestTicker.indexPrice)) / parseFloat(vestTicker.indexPrice) * 100 : null,
          marketType
        };
      });
    } catch (error3) {
      logApiError("GET", urlTickers, error3, Date.now() - startTime);
      logApiError("GET", urlTickers24h, error3, Date.now() - startTime);
      console.error("Error fetching Vest markets:", error3);
      throw error3;
    }
  }
  /* 	// Get funding data history for a specific ticker with configurable period
  	async getFundingData(
  		hyperliquidTicker: string,
  		period: FundingPeriod = 3,
  	): Promise<UnifiedFundingData[]> {
  		const vestSymbol = hyperliquidToVestTicker(hyperliquidTicker);
  		const fundingUrl = `${VEST_API_URL}/funding/history`;
  		const { startTime, pointCount, intervalHours } = this.getPeriodRange(period);
  
  		const params = {
  			symbol: vestSymbol,
  			startTime: startTime,
  			interval: `${intervalHours}h`, // Dynamic interval based on period
  			limit: pointCount + 1,
  		};
  
  		const requestStartTime = Date.now();
  		logApiRequest("GET", fundingUrl, params);
  
  		try {
  			const response: AxiosResponse<VestFundingHistoryResponse[]> = await axios.get(fundingUrl, {
  				headers: VEST_HEADERS,
  				params,
  			});
  
  			logApiResponse("GET", fundingUrl, response.status, Date.now() - requestStartTime);
  
  			const fundingHistory = response.data || [];
  
  			// Convert to unified format
  			const unifiedData: UnifiedFundingData[] = fundingHistory.map((point) => {
  				const hourlyRate = parseFloat(point.oneHrFundingRate);
  				const { fundingRate8H, fundingRateAPR } = this.calculateFundingRates(hourlyRate);
  
  				return {
  					ticker: hyperliquidTicker, // Return in HyperLiquid format
  					timestamp: point.time,
  					fundingRate8H,
  					fundingRateAPR,
  				};
  			});
  
  			// Sort by timestamp to ensure chronological order
  			return unifiedData.sort((a, b) => a.timestamp - b.timestamp);
  		} catch (error) {
  			logApiError("GET", fundingUrl, error, Date.now() - requestStartTime);
  			console.error(`Error fetching Vest funding data for ${hyperliquidTicker}:`, error);
  			throw error;
  		}
  	}
   */
};
