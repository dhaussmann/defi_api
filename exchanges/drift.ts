import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFrom8H } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var DRIFT_API_URL = "https://data.api.drift.trade";
export class DriftService extends BaseExchangeService {
  // Get all markets in unified format
  async getMarkets() {
    const url = `${DRIFT_API_URL}/contracts`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      const allContracts = Array.isArray(response.data) ? response.data : response.data.contracts;
      if (!allContracts || !Array.isArray(allContracts)) {
        throw new Error("Invalid response format from Drift API");
      }
      const results = allContracts.filter((contract) => {
        return contract.product_type === "PERP" && parseFloat(contract.open_interest) > 0 && parseFloat(contract.quote_volume) > 0;
      }).map((contract) => {
        const fundingRate = parseFloat(contract.funding_rate) * 8 / 100;
        const fundingRateAPR = calculateFundingRatesFrom8H(fundingRate);
        return {
          ticker: contract.index_name,
          marketPrice: parseFloat(contract.last_price) || 0,
          fundingRateAPR,
          openInterest: parseFloat(contract.open_interest) || 0,
          maxLeverage: null,
          // Drift doesn't provide leverage info in contracts endpoint
          volume24h: parseFloat(contract.quote_volume) || 0,
          // Drift doesn't provide volume in contracts endpoint
          spreadBidAsk: null,
          // Drift doesn't provide bid/ask in contracts endpoint
          marketPriceChangePercent24h: null,
          marketType: MarketType.CRYPTO
        };
      });
      return results;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching Drift markets:", error3);
      throw error3;
    }
  }
  /* 	// Get funding data history for a specific ticker with configurable period
  	async getFundingData(
  		hyperliquidTicker: string,
  		period: FundingPeriod = 3,
  	): Promise<UnifiedFundingData[]> {
  		const driftSymbol = hyperliquidToDriftTicker(hyperliquidTicker);
  		const { intervalHours } = this.getPeriodRange(period);
  
  		const url = `${DRIFT_API_URL}/fundingRates`;
  		const requestStartTime = Date.now();
  
  		const params = {
  			marketName: driftSymbol,
  		};
  
  		logApiRequest("GET", url, params);
  
  		try {
  			const response: AxiosResponse<{ fundingRates: DriftFundingRate[] }> = await axios.get(url, {
  				params,
  			});
  
  			logApiResponse("GET", url, response.status, Date.now() - requestStartTime);
  
  			const fundingHistory = response.data.fundingRates || [];
  
  			// Sort by timestamp descending first
  			fundingHistory.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  
  			// Filter to keep points based on dynamic interval
  			const filteredHistory = fundingHistory.filter((_, index) => index % intervalHours === 0);
  
  			// Sort by timestamp ascending for final result
  			filteredHistory.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  
  			// Convert to unified format
  			const unifiedHistory: UnifiedFundingData[] = filteredHistory.map((point) => {
  				// Convert funding rate from quote/base to percentage
  				// fundingRate is in 1e9 precision, oraclePriceTwap is in 1e6 precision
  				const fundingRateRaw = parseFloat(point.fundingRate) / 1e9;
  				const oraclePriceTwap = parseFloat(point.oraclePriceTwap) / 1e6;
  				const fundingRatePercentage = (fundingRateRaw / oraclePriceTwap) * 100;
  
  				// Assuming this is an 8H rate from Drift
  				const { fundingRate8H, fundingRateAPR } =
  					this.calculateFundingRatesFrom8H(fundingRatePercentage);
  
  				return {
  					ticker: hyperliquidTicker,
  					timestamp: new Date(point.ts).getTime(),
  					fundingRate8H,
  					fundingRateAPR,
  				};
  			});
  
  			return unifiedHistory;
  		} catch (error) {
  			logApiError("GET", url, error, Date.now() - requestStartTime);
  			console.error(`Error fetching Drift funding data for ${hyperliquidTicker}:`, error);
  			throw error;
  		}
  	}
   */
};
