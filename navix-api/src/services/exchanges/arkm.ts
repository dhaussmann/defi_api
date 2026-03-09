import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { arkmSymbolToHyperliquid } from "../../utils/tickersMapper";
import { calculateFundingRatesFrom8H } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var ARKM_API_URL = "https://arkm.com/api";
export class ArkmService extends BaseExchangeService {
  async getMarkets() {
    const url = `${ARKM_API_URL}/public/tickers`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      const markets = response.data || [];
      const perpetualMarkets = markets.filter((market) => market.productType === "perpetual");
      return perpetualMarkets.map((market) => {
        const rate8H = parseFloat(market.fundingRate || "0");
        const fundingRateAPR = calculateFundingRatesFrom8H(rate8H);
        const baseCurrency = arkmSymbolToHyperliquid(market.baseSymbol);
        return {
          ticker: baseCurrency,
          marketPrice: parseFloat(market.markPrice),
          fundingRateAPR,
          openInterest: parseFloat(market.openInterest),
          maxLeverage: null,
          // Not provided by ARKM API
          volume24h: parseFloat(market.usdVolume24h),
          marketPriceChangePercent24h: null,
          spreadBidAsk: null,
          // Not available in this endpoint
          marketType: MarketType.CRYPTO
        };
      });
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching ARKM markets:", error3);
      throw error3;
    }
  }
};
