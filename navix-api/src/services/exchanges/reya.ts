import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFromHourly } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";
import { reyaSymbolToHyperliquid } from "../../utils/tickersMapper";

var REYA_API_URL = "https://api.reya.xyz/v2";
export class ReyaService extends BaseExchangeService {
  marketDefinitions =  new Map();
  prices =  new Map();
  // Fetch market definitions to get max leverage
  async fetchMarketDefinitions() {
    const url = `${REYA_API_URL}/marketDefinitions`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      for (const definition of response.data) {
        this.marketDefinitions.set(definition.symbol, definition);
      }
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching Reya market definitions:", error3);
      throw error3;
    }
  }
  // Fetch prices to get current market prices
  async fetchPrices() {
    const url = `${REYA_API_URL}/prices`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      for (const price of response.data) {
        this.prices.set(price.symbol, price);
      }
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching Reya prices:", error3);
      throw error3;
    }
  }
  // Get all markets in unified format
  async getMarkets() {
    await Promise.all([this.fetchMarketDefinitions(), this.fetchPrices()]);
    const url = `${REYA_API_URL}/markets/summary`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      const results = [];
      for (const market of response.data) {
        const hourlyRate = parseFloat(market.fundingRate);
        const fundingRateAPR = calculateFundingRatesFromHourly(hourlyRate) / 100;
        const definition = this.marketDefinitions.get(market.symbol);
        const priceData = this.prices.get(market.symbol);
        const marketPrice = priceData?.poolPrice ? parseFloat(priceData.poolPrice) : priceData?.oraclePrice ? parseFloat(priceData.oraclePrice) : market.throttledPoolPrice ? parseFloat(market.throttledPoolPrice) : market.throttledOraclePrice ? parseFloat(market.throttledOraclePrice) : null;
        const oiQty = parseFloat(market.oiQty);
        const openInterest = oiQty && marketPrice ? oiQty * marketPrice : null;
        if (!openInterest || openInterest === 0 || parseFloat(market.volume24h) === 0) {
          continue;
        }
        results.push({
          ticker: reyaSymbolToHyperliquid(market.symbol),
          marketPrice,
          fundingRateAPR,
          openInterest,
          maxLeverage: definition?.maxLeverage || null,
          volume24h: market.volume24h ? parseFloat(market.volume24h) : null,
          marketPriceChangePercent24h: market.pxChange24h ? parseFloat(market.pxChange24h) : null,
          spreadBidAsk: null,
          // Reya doesn't provide bid/ask spread in summary
          marketType: MarketType.CRYPTO
        });
      }
      return results;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching Reya market summaries:", error3);
      throw error3;
    }
  }
};
