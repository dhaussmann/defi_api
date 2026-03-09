import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { calculateFundingRatesFrom8H } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var EVEDEX_API_URL = "https://exchange-api.evedex.com";
export class EvedexService extends BaseExchangeService {
  async getMarkets() {
    const url = `${EVEDEX_API_URL}/api/market/instrument`;
    const startTime = Date.now();
    logApiRequest("GET", url, { fields: "metrics" });
    try {
      const response = await axios.get(url, {
        params: {
          fields: "metrics"
        }
      });
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      const instruments = response.data || [];
      const activeInstruments = instruments.filter(
        (inst) => inst.trading !== "none" && inst.trading !== "restricted" && inst.marketState === "OPEN"
      );
      const results = activeInstruments.map((inst) => {
        const fundingRateStr = inst.fundingRate || "0";
        const fundingRate8H = parseFloat(fundingRateStr) * -1;
        const fundingRateAPR = calculateFundingRatesFrom8H(fundingRate8H);
        const markPrice = inst.markPrice || null;
        const openInterest = inst.openInterest || null;
        const ticker = inst.name || inst.displayName || inst.id;
        const baseTicker = ticker.replace(/[-_]?PERP$/i, "").replace(/[-_]?USD[CT]?$/i, "").replace(/\/.*$/, "");
        const priceChange = inst.closePrice && inst.lastPrice ? (inst.lastPrice - inst.closePrice) / inst.closePrice * 100 : null;
        return {
          ticker: baseTicker,
          marketPrice: markPrice,
          fundingRateAPR,
          openInterest: openInterest && markPrice ? openInterest * markPrice : null,
          maxLeverage: inst.maxLeverage || null,
          volume24h: inst.volumeBase || null,
          spreadBidAsk: null,
          marketPriceChangePercent24h: priceChange,
          marketType: MarketType.CRYPTO
        };
      });
      console.log(`Evedex: fetched ${results.length} instruments in ${Date.now() - startTime}ms`);
      return results;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching Evedex markets:", error3);
      throw error3;
    }
  }
};
