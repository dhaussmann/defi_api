import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var PACIFICA_API_URL = "https://api.pacifica.fi/api/v1";
export class PacificaService extends BaseExchangeService {
  // Calculate APR for 1-hour funding rate
  // Pacifica uses hourly funding: 24 payments per day × 365 days
  calculateFundingRateAPR(rate1H) {
    return rate1H * 24 * 365;
  }
  // Get all markets in unified format
  async getMarkets() {
    const url = `${PACIFICA_API_URL}/info/prices`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      if (!response.data.success) {
        throw new Error(`Pacifica API error: ${response.data.error || "Unknown error"}`);
      }
      const allMarkets = response.data.data;
      const results = [];
      for (const market of allMarkets) {
        const rate1H = parseFloat(market.funding);
        const fundingRateAPR = this.calculateFundingRateAPR(rate1H);
        const currentPrice = parseFloat(market.mark);
        const yesterdayPrice = parseFloat(market.yesterday_price);
        const priceChange24h = yesterdayPrice > 0 ? (currentPrice - yesterdayPrice) / yesterdayPrice * 100 : null;
        results.push({
          ticker: market.symbol,
          // Already in simple format (e.g., "BTC", "ETH")
          marketPrice: currentPrice,
          fundingRateAPR,
          openInterest: parseFloat(market.open_interest),
          // Already in USD
          maxLeverage: null,
          // Not provided in /info/prices endpoint
          volume24h: parseFloat(market.volume_24h),
          // Already in USD
          marketPriceChangePercent24h: priceChange24h,
          spreadBidAsk: null,
          // Not available in this endpoint
          marketType: MarketType.CRYPTO
        });
      }
      return results;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching Pacifica markets:", error3);
      throw error3;
    }
  }
};
