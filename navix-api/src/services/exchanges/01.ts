import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFromHourly } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var NORD_API_URL = "https://zo-mainnet.n1.xyz";
export class ZeroOneService extends BaseExchangeService {
  async getMarkets() {
    const infoUrl = `${NORD_API_URL}/info`;
    const startTime = Date.now();
    logApiRequest("GET", infoUrl);
    try {
      const infoResponse = await axios.get(infoUrl);
      logApiResponse("GET", infoUrl, infoResponse.status, Date.now() - startTime);
      const markets = infoResponse.data.markets || [];
      const statsPromises = markets.map(async (market) => {
        const statsUrl = `${NORD_API_URL}/market/${market.marketId}/stats`;
        const statsStartTime = Date.now();
        try {
          logApiRequest("GET", statsUrl);
          const statsResponse = await axios.get(statsUrl);
          logApiResponse("GET", statsUrl, statsResponse.status, Date.now() - statsStartTime);
          const stats = statsResponse.data;
          const fundingRate1H = stats.perpStats?.funding_rate || 0;
          const fundingRateAPR = calculateFundingRatesFromHourly(fundingRate1H);
          const markPrice = stats.perpStats?.mark_price || null;
          const openInterest = stats.perpStats?.open_interest || null;
          const ticker = market.symbol || market.name;
          const baseTicker = ticker.replace(/[-_]?PERP$/i, "").replace(/[-_]?USD[CT]?$/i, "");
          return {
            ticker: baseTicker,
            marketPrice: markPrice,
            fundingRateAPR,
            openInterest: openInterest && markPrice ? openInterest * markPrice : null,
            maxLeverage: market.maxLeverage || null,
            volume24h: stats.volumeQuote24h || null,
            spreadBidAsk: null,
            marketPriceChangePercent24h: stats.prevClose24h && stats.close24h ? (stats.close24h - stats.prevClose24h) / stats.prevClose24h * 100 : null,
            marketType: MarketType.CRYPTO
          };
        } catch (error3) {
          logApiError("GET", statsUrl, error3, Date.now() - statsStartTime);
          console.warn(`Failed to get stats for Nord market ${market.marketId}:`, error3);
          return null;
        }
      });
      const results = await Promise.all(statsPromises);
      return results.filter((item) => item !== null);
    } catch (error3) {
      logApiError("GET", infoUrl, error3, Date.now() - startTime);
      console.error("Error fetching Nord markets:", error3);
      throw error3;
    }
  }
};
