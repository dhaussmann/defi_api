import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFromHourly } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var ASTROS_API_URL = "https://api.astros.ag";
var ASTROS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9"
};
export class AstrosService extends BaseExchangeService {
  async getMarkets() {
    const pairsUrl = `${ASTROS_API_URL}/api/third/info/pairs`;
    const startTime = Date.now();
    logApiRequest("GET", pairsUrl);
    try {
      const pairsResponse = await axios.get(
        pairsUrl,
        { headers: ASTROS_HEADERS }
      );
      if (pairsResponse.data.error || pairsResponse.data.code !== 200) {
        throw new Error(`Astros API error: ${pairsResponse.data.msg}`);
      }
      logApiResponse("GET", pairsUrl, pairsResponse.status, Date.now() - startTime);
      const marketDataPromises = pairsResponse.data.data.map(
        async (market) => {
          const symbol = market.symbol;
          try {
            const [fundingResponse, tickerResponse, oiResponse] = await Promise.all([
              axios.get(
                `${ASTROS_API_URL}/api/third/v1/market/funding/current?pairName=${symbol}`,
                { headers: ASTROS_HEADERS }
              ).catch(() => null),
              axios.get(
                `${ASTROS_API_URL}/api/third/info/ticker/24hr?pairName=${symbol}`,
                { headers: ASTROS_HEADERS }
              ).catch(() => null),
              axios.get(
                `${ASTROS_API_URL}/api/third/info/oi?pairName=${symbol}`,
                { headers: ASTROS_HEADERS }
              ).catch(() => null)
            ]);
            const fundingRateRaw = fundingResponse?.data?.data?.fundingRate;
            const hourlyRate = fundingRateRaw ? parseFloat(fundingRateRaw) : 0;
            const fundingRateAPR = calculateFundingRatesFromHourly(hourlyRate);
            const tickerData = tickerResponse?.data?.data;
            const openPrice = tickerData?.open ? parseFloat(tickerData.open) : null;
            const closePrice = tickerData?.close ? parseFloat(tickerData.close) : null;
            let priceChangePercent24h = null;
            if (openPrice && closePrice && openPrice > 0) {
              priceChangePercent24h = (closePrice - openPrice) / openPrice * 100;
            }
            const volume24h = tickerData?.amount ? parseFloat(tickerData.amount) : null;
            const oiData = oiResponse?.data?.data;
            const openInterest = oiData && oiData.length > 0 ? parseFloat(oiData[0].amount) : null;
            const baseCurrency = symbol.split("-")[0];
            return {
              ticker: baseCurrency,
              marketPrice: closePrice,
              marketPriceChangePercent24h: priceChangePercent24h,
              fundingRateAPR,
              openInterest,
              maxLeverage: market.maxLever,
              // Not provided in public API
              volume24h,
              spreadBidAsk: null,
              // Would need orderbook data
              marketType: MarketType.CRYPTO
            };
          } catch (err) {
            console.error(`Error fetching data for ${symbol}:`, err);
            return null;
          }
        }
      );
      const results = await Promise.all(marketDataPromises);
      return results.filter((r) => r !== null);
    } catch (error3) {
      logApiError("GET", pairsUrl, error3, Date.now() - startTime);
      console.error("Error fetching Astros markets:", error3);
      throw error3;
    }
  }
};
