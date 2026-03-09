import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFrom8H } from "../../utils/utils";
import { getMarketType } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";
import { tradeXYZSymbolToHyperliquid, rwaMapper } from "../../utils/tickersMapper";

var TRADEXYZ_API_URL = "https://api.hyperliquid.xyz/info";
export class TradeXYZService extends BaseExchangeService {
  // Get all markets in unified format
  async getMarkets() {
    return this.getAllMarkets();
  }
  async getAllMarkets() {
    const url = TRADEXYZ_API_URL;
    const requestBody = {
      type: "metaAndAssetCtxs",
      dex: "xyz"
    };
    const startTime = Date.now();
    logApiRequest("POST", url, requestBody);
    try {
      const response = await axios.post(url, requestBody);
      logApiResponse("POST", url, response.status, Date.now() - startTime);
      const [meta, assetContexts] = response.data;
      return this.mapMarket({ meta, assetContexts });
    } catch (error3) {
      logApiError("POST", url, error3, Date.now() - startTime);
      console.error("Error fetching HyperLiquid markets:", error3);
      throw error3;
    }
  }
  mapMarket({ meta, assetContexts }) {
    return meta.universe.map((market, index) => {
      if (market.isDelisted) {
        return null;
      }
      const rate8H = Number.parseFloat(assetContexts[index]?.funding || "0") * 8;
      const fundingRateAPR = calculateFundingRatesFrom8H(rate8H);
      const marketPrice = assetContexts[index]?.markPx ? Number.parseFloat(assetContexts[index].markPx) : null;
      const openInterestInTokens = assetContexts[index]?.openInterest ? Number.parseFloat(assetContexts[index].openInterest) : null;
      const volume24h = assetContexts[index]?.dayNtlVlm ? Number.parseFloat(assetContexts[index].dayNtlVlm) : null;
      const ticker = tradeXYZSymbolToHyperliquid(rwaMapper(market.name));
      return {
        ticker,
        marketPrice,
        fundingRateAPR,
        openInterest: openInterestInTokens && marketPrice ? openInterestInTokens * marketPrice : null,
        maxLeverage: market.maxLeverage || null,
        volume24h,
        spreadBidAsk: assetContexts[index]?.impactPxs && assetContexts[index].markPx ? (Number.parseFloat(assetContexts[index].impactPxs[1]) - Number.parseFloat(assetContexts[index].impactPxs[0])) / Number.parseFloat(assetContexts[index].markPx) * 100 : null,
        marketPriceChangePercent24h: assetContexts[index]?.markPx ? (Number.parseFloat(assetContexts[index].markPx) - Number.parseFloat(assetContexts[index].prevDayPx)) / Number.parseFloat(assetContexts[index].prevDayPx) * 100 : null,
        marketType: getMarketType(ticker)
      };
    });
  }
};
