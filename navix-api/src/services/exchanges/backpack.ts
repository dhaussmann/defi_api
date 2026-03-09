import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFromHourly } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var BACKPACK_API_URL = "https://api.backpack.exchange";
export class BackpackService extends BaseExchangeService {
  async getMarkets() {
    const startTime = Date.now();
    try {
      const [marketsRes, tickersRes, markPricesRes, openInterestRes] = await Promise.all([
        this.fetchMarkets(),
        this.fetchTickers(),
        this.fetchMarkPrices(),
        this.fetchOpenInterest()
      ]);
      const perpetualMarkets = marketsRes.filter((m) => m.marketType === "PERP" && m.visible);
      const tickerMap =  new Map();
      for (const ticker of tickersRes) {
        tickerMap.set(ticker.symbol, ticker);
      }
      const markPriceMap =  new Map();
      for (const mp of markPricesRes) {
        markPriceMap.set(mp.symbol, mp);
      }
      const openInterestMap =  new Map();
      for (const oi of openInterestRes) {
        openInterestMap.set(oi.symbol, oi);
      }
      const results = perpetualMarkets.map((market) => {
        const ticker = tickerMap.get(market.symbol);
        const markPrice = markPriceMap.get(market.symbol);
        const openInterest = openInterestMap.get(market.symbol);
        const fundingRateStr = markPrice?.fundingRate || "0";
        const fundingRatePerInterval = parseFloat(fundingRateStr);
        const fundingIntervalMs = market.fundingInterval || 36e5;
        const intervalsPerHour = 36e5 / fundingIntervalMs;
        const hourlyFundingRate = fundingRatePerInterval * intervalsPerHour;
        const fundingRateAPR = calculateFundingRatesFromHourly(hourlyFundingRate);
        const marketPriceNum = markPrice?.markPrice ? parseFloat(markPrice.markPrice) : null;
        const openInterestNum = openInterest?.openInterest ? parseFloat(openInterest.openInterest) : null;
        const baseTicker = market.baseSymbol || market.symbol.split("_")[0];
        return {
          ticker: baseTicker,
          marketPrice: marketPriceNum,
          fundingRateAPR,
          openInterest: openInterestNum && marketPriceNum ? openInterestNum * marketPriceNum : null,
          maxLeverage: market.filters?.leverage?.maxLeverage ? parseFloat(market.filters.leverage.maxLeverage) : null,
          volume24h: ticker?.quoteVolume ? parseFloat(ticker.quoteVolume) : null,
          spreadBidAsk: null,
          marketPriceChangePercent24h: ticker?.priceChangePercent ? parseFloat(ticker.priceChangePercent) : null,
          marketType: MarketType.CRYPTO
        };
      });
      console.log(
        `Backpack: fetched ${results.length} perpetual markets in ${Date.now() - startTime}ms`
      );
      return results;
    } catch (error3) {
      console.error("Error fetching Backpack markets:", error3);
      throw error3;
    }
  }
  async fetchMarkets() {
    const url = `${BACKPACK_API_URL}/api/v1/markets`;
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
  async fetchTickers() {
    const url = `${BACKPACK_API_URL}/api/v1/tickers`;
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
  async fetchMarkPrices() {
    const url = `${BACKPACK_API_URL}/api/v1/markPrices`;
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
  async fetchOpenInterest() {
    const url = `${BACKPACK_API_URL}/api/v1/openInterest`;
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
