import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFromHourly } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var DYDX_API_URL = "https://indexer.dydx.trade";
export class DydxService extends BaseExchangeService {
  async getMarkets() {
    const url = `${DYDX_API_URL}/v4/perpetualMarkets`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      const marketsData = response.data.markets || {};
      const markets = [];
      for (const [_marketId, market] of Object.entries(marketsData)) {
        const hourlyRate = parseFloat(market.defaultFundingRate1H || "0");
        const fundingRateAPR = calculateFundingRatesFromHourly(hourlyRate);
        const baseTicker = market.ticker.split("-")[0];
        markets.push({
          ticker: baseTicker,
          marketPrice: parseFloat(market.oraclePrice),
          fundingRateAPR,
          openInterest: parseFloat(market.openInterest),
          maxLeverage: market.initialMarginFraction ? 1 / parseFloat(market.initialMarginFraction) : null,
          volume24h: parseFloat(market.volume24H),
          spreadBidAsk: null,
          // Not available in this endpoint
          marketPriceChangePercent24h: parseFloat(market.priceChange24H) / parseFloat(market.oraclePrice) * 100,
          marketType: MarketType.CRYPTO
        });
      }
      return markets;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching DYDX markets:", error3);
      throw error3;
    }
  }
};
