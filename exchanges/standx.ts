import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var STANDX_API_URL = "https://perps.standx.com";
export class StandxService extends BaseExchangeService {
  calculateFundingRateAPR(rate1H) {
    return rate1H * 24 * 365;
  }
  calculateSpreadBidAsk(bid1, ask1, midPrice) {
    if (!bid1 || !ask1 || midPrice === 0) return null;
    const bid = parseFloat(bid1);
    const ask = parseFloat(ask1);
    if (Number.isNaN(bid) || Number.isNaN(ask)) return null;
    return (ask - bid) / midPrice * 100;
  }
  async getMarkets() {
    const symbolsUrl = `${STANDX_API_URL}/api/query_symbol_info`;
    const startTime = Date.now();
    logApiRequest("GET", symbolsUrl);
    try {
      const symbolsResponse = await axios.get(symbolsUrl);
      logApiResponse("GET", symbolsUrl, symbolsResponse.status, Date.now() - startTime);
      const enabledSymbols = symbolsResponse.data.filter((s) => s.status === "trading");
      const results = [];
      for (const symbolInfo of enabledSymbols) {
        const marketUrl = `${STANDX_API_URL}/api/query_symbol_market?symbol=${symbolInfo.symbol}`;
        const marketStartTime = Date.now();
        logApiRequest("GET", marketUrl);
        try {
          const marketResponse = await axios.get(marketUrl);
          logApiResponse("GET", marketUrl, marketResponse.status, Date.now() - marketStartTime);
          const market = marketResponse.data;
          const rate1H = parseFloat(market.funding_rate);
          const fundingRateAPR = this.calculateFundingRateAPR(rate1H);
          const midPrice = parseFloat(market.mid_price);
          const markPrice = parseFloat(market.mark_price);
          results.push({
            ticker: market.base,
            marketPrice: markPrice,
            fundingRateAPR,
            openInterest: parseFloat(market.open_interest_notional),
            maxLeverage: parseFloat(symbolInfo.max_leverage),
            volume24h: market.volume_quote_24h,
            marketPriceChangePercent24h: null,
            spreadBidAsk: this.calculateSpreadBidAsk(market.bid1, market.ask1, midPrice),
            marketType: MarketType.CRYPTO
          });
        } catch (error3) {
          logApiError("GET", marketUrl, error3, Date.now() - marketStartTime);
        }
      }
      return results;
    } catch (error3) {
      logApiError("GET", symbolsUrl, error3, Date.now() - startTime);
      console.error("Error fetching StandX markets:", error3);
      throw error3;
    }
  }
};
