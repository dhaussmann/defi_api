import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFrom8H } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var HIBACHI_API_URL = "https://data-api.hibachi.xyz";
export class HibachiService extends BaseExchangeService {
  // Extract base symbol from Hibachi symbol format (e.g., "BTC/USDT-P" -> "BTC")
  extractBaseSymbol(hibachiSymbol) {
    return hibachiSymbol.split("/")[0];
  }
  // Fetch price data for a specific symbol
  async fetchPriceData(symbol) {
    const url = `${HIBACHI_API_URL}/market/data/prices?symbol=${encodeURIComponent(symbol)}`;
    const startTime = Date.now();
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      return response.data;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      return null;
    }
  }
  // Fetch stats data for a specific symbol
  async fetchStatsData(symbol) {
    const url = `${HIBACHI_API_URL}/market/data/stats?symbol=${encodeURIComponent(symbol)}`;
    const startTime = Date.now();
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      return response.data;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      return null;
    }
  }
  // Fetch open interest data for a specific symbol
  async fetchOpenInterestData(symbol) {
    const url = `${HIBACHI_API_URL}/market/data/open-interest?symbol=${encodeURIComponent(symbol)}`;
    const startTime = Date.now();
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      return response.data;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      return null;
    }
  }
  // Get all markets in unified format
  async getMarkets() {
    const exchangeInfoUrl = `${HIBACHI_API_URL}/market/exchange-info`;
    const startTime = Date.now();
    logApiRequest("GET", exchangeInfoUrl);
    try {
      const exchangeInfoResponse = await axios.get(exchangeInfoUrl);
      logApiResponse("GET", exchangeInfoUrl, exchangeInfoResponse.status, Date.now() - startTime);
      const contracts = exchangeInfoResponse.data.futureContracts;
      const liveContracts = contracts.filter((contract) => contract.status === "LIVE");
      const marketDataPromises = liveContracts.map(async (contract) => {
        const symbol = contract.symbol;
        const [priceData, statsData, openInterestData] = await Promise.all([
          this.fetchPriceData(symbol),
          this.fetchStatsData(symbol),
          this.fetchOpenInterestData(symbol)
        ]);
        if (!priceData) {
          return null;
        }
        const fundingRate8H = parseFloat(
          priceData.fundingRateEstimation?.estimatedFundingRate || "0"
        );
        const fundingRateAPR = calculateFundingRatesFrom8H(fundingRate8H);
        const marketPrice = parseFloat(priceData.markPrice);
        const openInterestQuantity = openInterestData ? parseFloat(openInterestData.totalQuantity) : null;
        const openInterest = openInterestQuantity !== null && marketPrice ? openInterestQuantity * marketPrice : null;
        const volume24h = statsData ? parseFloat(statsData.volume24h) : null;
        let marketPriceChangePercent24h = null;
        if (statsData) {
          const high24h = parseFloat(statsData.high24h);
          const low24h = parseFloat(statsData.low24h);
          const midPrice = (high24h + low24h) / 2;
          if (midPrice > 0) {
            marketPriceChangePercent24h = (marketPrice - midPrice) / midPrice * 100;
          }
        }
        const bidPrice = parseFloat(priceData.bidPrice);
        const askPrice = parseFloat(priceData.askPrice);
        const spreadBidAsk = bidPrice && askPrice && marketPrice ? (askPrice - bidPrice) / marketPrice * 100 : null;
        const initialMarginRate = parseFloat(contract.initialMarginRate);
        const maxLeverage = initialMarginRate > 0 ? Math.round(1 / initialMarginRate) : null;
        return {
          ticker: this.extractBaseSymbol(symbol),
          marketPrice,
          fundingRateAPR,
          openInterest,
          maxLeverage,
          volume24h,
          marketPriceChangePercent24h,
          spreadBidAsk,
          marketType: MarketType.CRYPTO
        };
      });
      const results = await Promise.all(marketDataPromises);
      return results.filter((item) => item !== null);
    } catch (error3) {
      logApiError("GET", exchangeInfoUrl, error3, Date.now() - startTime);
      console.error("Error fetching Hibachi markets:", error3);
      throw error3;
    }
  }
};
