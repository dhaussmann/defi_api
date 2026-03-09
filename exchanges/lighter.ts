import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { getMarketType } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var LIGHTER_WS_URL = "wss://mainnet.zklighter.elliot.ai/stream";
var LIGHTER_REST_URL = "https://explorer.elliot.ai/api";
export class LighterService extends BaseExchangeService {
  marketsCache =  new Map();
  async fetchMarketsMetadata() {
    const url = `${LIGHTER_REST_URL}/markets`;
    try {
      logApiRequest("GET", url);
      const startTime = Date.now();
      const response = await axios.get(url);
      logApiResponse("GET", url, 200, Date.now() - startTime);
      this.marketsCache.clear();
      for (const market of response.data) {
        this.marketsCache.set(market.market_index, market.symbol);
      }
    } catch (error3) {
      logApiError("GET", url, error3, 0);
      console.error("Error fetching Lighter markets metadata:", error3);
    }
  }
  calculateFundingRateAPR(rate, periodHours = 1) {
    const periodsPerDay = 24 / periodHours;
    const periodsPerYear = periodsPerDay * 365;
    return rate * periodsPerYear / 100;
  }
  getTickerFromMarketId(marketId) {
    return this.marketsCache.get(marketId) || `MARKET_${marketId}`;
  }
  // Process individual market stats and store in results map (latest update wins)
  processMarketStats(stats, resultsMap) {
    const ticker = this.getTickerFromMarketId(Number(stats.market_id));
    const fundingRate = parseFloat(String(stats.current_funding_rate || stats.funding_rate || "0"));
    const fundingRateAPR = this.calculateFundingRateAPR(fundingRate);
    const marketPrice = stats.mark_price ? parseFloat(String(stats.mark_price)) : null;
    const openInterest = stats.open_interest ? parseFloat(String(stats.open_interest)) * 2 : null;
    const volume24h = stats.daily_quote_token_volume ? parseFloat(String(stats.daily_quote_token_volume)) : null;
    const priceChange24h = stats.daily_price_change ? parseFloat(String(stats.daily_price_change)) : null;
    resultsMap.set(ticker, {
      ticker,
      marketPrice,
      fundingRateAPR,
      openInterest,
      maxLeverage: null,
      volume24h,
      marketPriceChangePercent24h: priceChange24h,
      spreadBidAsk: null,
      marketType: getMarketType(ticker)
    });
  }
  // Fetch market data using native Workers WebSocket
  async fetchMarketDataViaWebSocket() {
    return new Promise((resolve, reject) => {
      const resultsMap =  new Map();
      const ws = new WebSocket(LIGHTER_WS_URL);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket timeout"));
      }, 1e4);
      ws.addEventListener("open", () => {
        const subscribeMessage = {
          type: "subscribe",
          channel: "market_stats/all"
        };
        ws.send(JSON.stringify(subscribeMessage));
      });
      ws.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(
            typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data)
          );
          if (message.channel?.includes("market_stats") && message.market_stats) {
            const marketStatsData = message.market_stats;
            for (const marketId in marketStatsData) {
              const marketData = marketStatsData[marketId];
              if (marketData && marketData.market_id !== void 0) {
                this.processMarketStats(marketData, resultsMap);
              }
            }
          }
        } catch (error3) {
          console.error("Error parsing WebSocket message:", error3);
        }
      });
      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket connection error"));
      });
      setTimeout(() => {
        clearTimeout(timeout);
        ws.close();
        resolve(Array.from(resultsMap.values()));
      }, 5e3);
    });
  }
  async getMarkets() {
    const startTime = Date.now();
    await this.fetchMarketsMetadata();
    logApiRequest("WebSocket", LIGHTER_WS_URL);
    try {
      const results = await this.fetchMarketDataViaWebSocket();
      logApiResponse("WebSocket", LIGHTER_WS_URL, 200, Date.now() - startTime);
      return results;
    } catch (error3) {
      logApiError("WebSocket", LIGHTER_WS_URL, error3, Date.now() - startTime);
      console.error("Error fetching Lighter markets via WebSocket:", error3);
      return [];
    }
  }
};
