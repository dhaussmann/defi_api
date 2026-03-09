import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { asterdexSymbolToHyperliquid } from "../../utils/tickersMapper";
import { getMarketType } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var ASTERDEX_API_URL = "https://fapi.asterdex.com";
export class AsterdexService extends BaseExchangeService {
  async getMarkets() {
    const startTime = Date.now();
    try {
      const [premiumIndexData, fundingInfoData, ticker24hrData] = await Promise.all([
        this.fetchPremiumIndex(),
        this.fetchFundingInfo(),
        this.fetchTicker24hr()
      ]);
      const fundingInfoMap =  new Map();
      for (const info3 of fundingInfoData) {
        fundingInfoMap.set(info3.symbol, info3);
      }
      const tickerMap =  new Map();
      for (const ticker of ticker24hrData) {
        tickerMap.set(ticker.symbol, ticker);
      }
      const results = [];
      const timestamp = Date.now();
      for (const premium of premiumIndexData) {
        if (!premium.symbol.endsWith("USDT") && !premium.symbol.endsWith("USD") || premium.symbol.startsWith("SHIELD")) {
          continue;
        }
        const ticker = asterdexSymbolToHyperliquid(premium.symbol);
        const fundingInfo = fundingInfoMap.get(premium.symbol);
        const ticker24hr = tickerMap.get(premium.symbol);
        const fundingRate = parseFloat(premium.lastFundingRate || "0");
        const intervalHours = fundingInfo?.fundingIntervalHours ?? 8;
        const paymentsPerDay = 24 / intervalHours;
        const fundingRateAPR = fundingRate * paymentsPerDay * 365;
        const markPrice = premium.markPrice ? parseFloat(premium.markPrice) : null;
        const indexPrice = premium.indexPrice ? parseFloat(premium.indexPrice) : null;
        const spreadBidAsk = markPrice && indexPrice ? Math.abs(markPrice - indexPrice) / indexPrice * 100 : null;
        results.push({
          ticker,
          fundingRateAPR,
          openInterest: null,
          maxLeverage: null,
          volume24h: ticker24hr?.quoteVolume ? parseFloat(ticker24hr.quoteVolume) : null,
          spreadBidAsk,
          marketPrice: markPrice,
          marketPriceChangePercent24h: ticker24hr?.priceChangePercent ? parseFloat(ticker24hr.priceChangePercent) : null,
          timestamp,
          marketType: getMarketType(ticker)
        });
      }
      console.log(
        `Asterdex: fetched ${results.length} perpetual markets in ${Date.now() - startTime}ms`
      );
      return results;
    } catch (error3) {
      console.error("Error fetching Asterdex markets:", error3);
      throw error3;
    }
  }
  async fetchPremiumIndex() {
    const url = `${ASTERDEX_API_URL}/fapi/v3/premiumIndex`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      return response.data || [];
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      throw error3;
    }
  }
  async fetchFundingInfo() {
    const url = `${ASTERDEX_API_URL}/fapi/v3/fundingInfo`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      return response.data || [];
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      return [];
    }
  }
  async fetchTicker24hr() {
    const url = `${ASTERDEX_API_URL}/fapi/v3/ticker/24hr`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      return response.data || [];
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      return [];
    }
  }
};
