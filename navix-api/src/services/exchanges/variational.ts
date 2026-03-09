import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var VARIATIONAL_API_URL = "https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats";
export class VariationalService extends BaseExchangeService {
  async getMarkets() {
    const url = VARIATIONAL_API_URL;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      const markets = data.listings.map((listing) => {
        const fundingRateAPR = parseFloat(listing.funding_rate || "0");
        const longOI = parseFloat(listing.open_interest?.long_open_interest || "0");
        const shortOI = parseFloat(listing.open_interest?.short_open_interest || "0");
        const openInterest = longOI + shortOI;
        return {
          ticker: listing.ticker,
          marketPrice: parseFloat(listing.mark_price || "0"),
          fundingRateAPR,
          openInterest,
          volume24h: parseFloat(listing.volume_24h || "0"),
          maxLeverage: null,
          spreadBidAsk: null,
          marketPriceChangePercent24h: null,
          marketType: MarketType.CRYPTO
        };
      });
      return markets;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      throw error3;
    }
  }
};
