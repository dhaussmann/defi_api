import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFrom8H } from "../../utils/utils";
import { getMarketType } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";
import { paradexSymbolToHyperliquid } from "../../utils/tickersMapper";

var PARADEX_API_URL = "https://api.prod.paradex.trade/v1";
export class ParadexService extends BaseExchangeService {
  marketsMetadata =  new Map();
  // Fetch markets metadata to get funding periods
  async fetchMarketsMetadata() {
    const url = `${PARADEX_API_URL}/markets`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      for (const market of response.data.results) {
        if (market.asset_kind === "PERP") {
          this.marketsMetadata.set(market.symbol, market);
        }
      }
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching Paradex markets metadata:", error3);
      throw error3;
    }
  }
  // Calculate APR based on funding period
  calculateFundingRateAPR(rate, periodHours) {
    const periodsPerDay = 24 / periodHours;
    const periodsPerYear = periodsPerDay * 365;
    return rate * periodsPerYear;
  }
  // Get all markets in unified format
  async getMarkets() {
    await this.fetchMarketsMetadata();
    const url = `${PARADEX_API_URL}/markets/summary?market=ALL`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      const allMarkets = response.data.results;
      const results = [];
      for (const market of allMarkets) {
        if (!market.symbol.includes("-PERP")) {
          continue;
        }
        const rate = parseFloat(market.funding_rate);
        const marketMetadata = this.marketsMetadata.get(market.symbol);
        const fundingPeriodHours = marketMetadata?.funding_period_hours || 8;
        const fundingRateAPR = this.calculateFundingRateAPR(rate, fundingPeriodHours);
        results.push({
          ticker: paradexSymbolToHyperliquid(market.symbol),
          // Use base currency as ticker for consistency
          marketPrice: market.mark_price ? parseFloat(market.mark_price) : null,
          fundingRateAPR,
          openInterest: market.open_interest && market.mark_price ? parseFloat(market.open_interest) * parseFloat(market.mark_price) : null,
          maxLeverage: null,
          volume24h: market.volume_24h ? parseFloat(market.volume_24h) : null,
          marketPriceChangePercent24h: market.price_change_rate_24h ? parseFloat(market.price_change_rate_24h) * 100 : null,
          spreadBidAsk: market.ask && market.bid && market.last_traded_price ? Math.abs(parseFloat(market.ask) - parseFloat(market.bid)) / parseFloat(market.last_traded_price) * 100 : null,
          marketType: getMarketType(market.symbol)
        });
      }
      return results;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching Paradex markets summary:", error3);
      throw error3;
    }
  }
  // Get funding data history for a specific ticker with configurable period
  /* 	async getFundingData(
  		hyperliquidTicker: string,
  		period: FundingPeriod = 3,
  	): Promise<UnifiedFundingData[]> {
  		const paradexSymbol = hyperliquidToParadexTicker(hyperliquidTicker);
  		const { startTime, endTime, pointCount, intervalHours } = this.getPeriodRange(period);
  
  		const url = `${PARADEX_API_URL}/funding/data`;
  		const results: UnifiedFundingData[] = [];
  
  		// Generate timestamps based on the period and dynamic interval
  		const intervalMs = intervalHours * 60 * 60 * 1000;
  		const timePoints: number[] = [];
  
  		// Round endTime to the previous full hour
  		const roundedEndTime = Math.floor(endTime / (60 * 60 * 1000)) * (60 * 60 * 1000);
  
  		for (let i = 0; i < pointCount + 1; i++) {
  			// Start from roundedEndTime and go backwards: roundedEndTime - (pointCount-1-i) * intervalHours
  			const timestamp = roundedEndTime - (pointCount - i - 1) * intervalMs;
  			timePoints.push(timestamp);
  		}
  
  		// Make individual API calls, each targeting a specific interval window
  		for (const targetTime of timePoints) {
  			// Use a 1-minute window around the target time to ensure we get data
  			const windowMs = 60 * 1000;
  			const windowStart = targetTime - windowMs;
  			const windowEnd = targetTime + windowMs;
  
  			const params: ParadexFundingParams = {
  				market: paradexSymbol,
  				start_at: windowStart,
  				end_at: windowEnd,
  				page_size: 1,
  			};
  
  			const requestStartTime = Date.now();
  			logApiRequest("GET", url, params);
  
  			try {
  				const response: AxiosResponse<ParadexFundingResponse> = await axios.get(url, { params });
  
  				logApiResponse("GET", url, response.status, Date.now() - requestStartTime);
  
  				const fundingData = response.data.results;
  
  				if (fundingData && fundingData.length > 0) {
  					const point = fundingData[0];
  					const rate8H = parseFloat(point.funding_rate);
  					const { fundingRate8H, fundingRateAPR } = this.calculateFundingRatesFrom8H(rate8H);
  
  					results.push({
  						ticker: hyperliquidTicker,
  						timestamp: point.created_at,
  						fundingRate8H,
  						fundingRateAPR,
  					});
  				}
  
  				// Rate limiting protection between calls
  				await new Promise((resolve) => setTimeout(resolve, 100));
  			} catch (error) {
  				logApiError("GET", url, error, Date.now() - requestStartTime);
  				console.error(
  					`Error fetching Paradex funding data for ${hyperliquidTicker} at timestamp ${targetTime}:`,
  					error,
  				);
  				// Continue with other calls even if one fails
  			}
  		}
  
  		// Sort results by timestamp
  		results.sort((a, b) => a.timestamp - b.timestamp);
  
  		return results;
  	}
   */
};
