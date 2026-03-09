import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { apexSymbolToHyperliquid } from "../../utils/tickersMapper";
import { calculateFundingRatesFromHourly } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var APEX_API_URL = "https://omni.apex.exchange/api";
export class ApexService extends BaseExchangeService {
  // Get markets for specific tickers in unified format
  async getMarkets() {
    const configUrl = `${APEX_API_URL}/v3/symbols`;
    const tickersUrl = `${APEX_API_URL}/v3/ticker`;
    const startTime = Date.now();
    logApiRequest("GET", configUrl);
    try {
      const configResponse = await axios.get(configUrl);
      logApiResponse("GET", configUrl, configResponse.status, Date.now() - startTime);
      const availableSymbolsData = configResponse.data.data?.contractConfig.perpetualContract?.filter(
        (contract) => contract.enableTrade && contract.enableDisplay
      ) || [];
      const tickerRequestsStartTime = Date.now();
      const tickerRequests = availableSymbolsData.map(
        async (symbolData) => {
          try {
            const response = await axios.get(tickersUrl, {
              params: { symbol: symbolData.crossSymbolName }
            });
            const tickerData = response.data.data?.[0];
            if (!tickerData) return null;
            const hourlyRate = parseFloat(tickerData.fundingRate);
            const fundingRateAPR = calculateFundingRatesFromHourly(hourlyRate);
            return {
              ticker: apexSymbolToHyperliquid(symbolData.crossSymbolName),
              marketPrice: tickerData.lastPrice ? parseFloat(tickerData.lastPrice) : null,
              fundingRateAPR,
              openInterest: parseFloat(tickerData.openInterest) || null,
              maxLeverage: symbolData.displayMaxLeverage ? parseFloat(symbolData.displayMaxLeverage) : null,
              volume24h: tickerData.volume24h ? parseFloat(tickerData.volume24h) : null,
              marketPriceChangePercent24h: tickerData.price24hPcnt ? parseFloat(tickerData.price24hPcnt) * 100 : null,
              spreadBidAsk: null,
              marketType: MarketType.CRYPTO
            };
          } catch (error3) {
            console.warn(
              `Failed to fetch APEX ticker data for ${symbolData.crossSymbolName}:`,
              error3
            );
            return null;
          }
        }
      );
      const tickerResults = await Promise.allSettled(tickerRequests);
      const results = tickerResults.filter((result) => result.status === "fulfilled" && result.value !== null).map((result) => result.value);
      logApiResponse(
        "GET",
        `${tickersUrl} (${availableSymbolsData.length} parallel)`,
        200,
        Date.now() - tickerRequestsStartTime
      );
      return results;
    } catch (error3) {
      logApiError("GET", configUrl, error3, Date.now() - startTime);
      console.error("Error fetching APEX markets:", error3);
      throw error3;
    }
  }
  // Get funding data history for a specific ticker with configurable period
  /*async getFundingData(
  		hyperliquidTicker: string,
  		period: FundingPeriod = 3,
  	): Promise<UnifiedFundingData[]> {
  		const apexSymbol = hyperliquidToApexTicker(hyperliquidTicker);
  		const { startTime, endTime } = this.getPeriodRange(period);
  
  		const url = `${APEX_API_URL}/v3/history-funding`;
  		const requestStartTime = Date.now();
  
  		const params = {
  			symbol: apexSymbol,
  			beginTimeInclusive: startTime.toString(),
  			endTimeExclusive: endTime.toString(),
  			limit: "1000",
  		};
  
  		logApiRequest("GET", url, params);
  
  		try {
  			const response: AxiosResponse<{ data?: { historyFunds?: ApexFundingHistory[] } }> =
  				await axios.get(url, {
  					params,
  					timeout: 10000, // 10s timeout to prevent hanging
  				});
  
  			logApiResponse("GET", url, response.status, Date.now() - requestStartTime);
  
  			// Handle both possible response structures
  			const fundingHistory = response.data.data?.historyFunds || [];
  
  			// Convert to unified format
  			const unifiedHistory: UnifiedFundingData[] = fundingHistory.map(
  				(point: ApexFundingHistory) => {
  					// APEX provides hourly rates, convert to 8H format
  					const hourlyRate = parseFloat(point.rate);
  					const { fundingRate8H, fundingRateAPR } =
  						this.calculateFundingRatesFromHourly(hourlyRate);
  
  					return {
  						ticker: hyperliquidTicker,
  						timestamp: point.fundingTimestamp,
  						fundingRate8H,
  						fundingRateAPR,
  					};
  				},
  			);
  
  			// Sort by timestamp ascending
  			unifiedHistory.sort((a, b) => a.timestamp - b.timestamp);
  
  			return unifiedHistory;
  		} catch (error) {
  			logApiError("GET", url, error, Date.now() - requestStartTime);
  
  			// Enhanced error logging for debugging
  			if (axios.isAxiosError(error)) {
  				console.error(`APEX funding API error for ${hyperliquidTicker}:`, {
  					status: error.response?.status,
  					data: error.response?.data,
  					params,
  				});
  			}
  
  			console.error(`Error fetching APEX funding data for ${hyperliquidTicker}:`, error);
  
  			// Return empty array instead of throwing for better UX
  			return [];
  		}
  	}*/
};
