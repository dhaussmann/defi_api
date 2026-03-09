import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { etherealSymbolToHyperliquid } from "../../utils/tickersMapper";
import { getMarketType } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var ETHEREAL_API_URL = "https://api.ethereal.trade/v1";
export class EtherealService extends BaseExchangeService {
  calculateFundingRateAPR(rate1H) {
    return rate1H * 24 * 365;
  }
  async getMarkets() {
    const productsUrl = `${ETHEREAL_API_URL}/product?order=asc&orderBy=createdAt`;
    const startTime = Date.now();
    logApiRequest("GET", productsUrl);
    try {
      const productsResponse = await axios.get(productsUrl);
      logApiResponse("GET", productsUrl, productsResponse.status, Date.now() - startTime);
      const perpetualProducts = productsResponse.data.data.filter(
        (product) => product.engineType === 0
      );
      if (perpetualProducts.length === 0) {
        return [];
      }
      const productIds = perpetualProducts.map((p) => p.id).join(",");
      const pricesUrl = `${ETHEREAL_API_URL}/product/market-price?productIds=${productIds}`;
      const pricesStartTime = Date.now();
      logApiRequest("GET", pricesUrl);
      const pricesResponse = await axios.get(pricesUrl);
      logApiResponse("GET", pricesUrl, pricesResponse.status, Date.now() - pricesStartTime);
      const priceMap =  new Map();
      for (const priceData of pricesResponse.data.data) {
        priceMap.set(priceData.productId, priceData);
      }
      const results = [];
      for (const product of perpetualProducts) {
        const priceData = priceMap.get(product.id);
        const rate1H = parseFloat(product.fundingRate1h);
        const fundingRateAPR = this.calculateFundingRateAPR(rate1H);
        let marketPrice = null;
        let spreadBidAsk = null;
        let marketPriceChangePercent24h = null;
        if (priceData) {
          const oraclePrice = parseFloat(priceData.oraclePrice);
          const price24hAgo = parseFloat(priceData.price24hAgo);
          const bestBid = parseFloat(priceData.bestBidPrice);
          const bestAsk = parseFloat(priceData.bestAskPrice);
          marketPrice = oraclePrice;
          if (bestBid > 0 && bestAsk > 0) {
            spreadBidAsk = (bestAsk - bestBid) / bestBid * 100;
          }
          if (price24hAgo > 0) {
            marketPriceChangePercent24h = (oraclePrice - price24hAgo) / price24hAgo * 100;
          }
        }
        results.push({
          ticker: etherealSymbolToHyperliquid(product.ticker),
          marketPrice,
          fundingRateAPR,
          openInterest: parseFloat(product.openInterest),
          maxLeverage: product.maxLeverage,
          volume24h: parseFloat(product.volume24h),
          marketPriceChangePercent24h,
          spreadBidAsk,
          marketType: getMarketType(product.ticker)
        });
      }
      return results;
    } catch (error3) {
      logApiError("GET", productsUrl, error3, Date.now() - startTime);
      console.error("Error fetching Ethereal markets:", error3);
      throw error3;
    }
  }
};
