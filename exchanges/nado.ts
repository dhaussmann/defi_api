import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var NADO_API_URL = "https://archive.prod.nado.xyz/v2";
export class NadoService extends BaseExchangeService {
  async getMarkets() {
    const url = `${NADO_API_URL}/contracts`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      const contracts = response.data;
      const results = [];
      for (const [, contract] of Object.entries(contracts)) {
        if (contract.product_type !== "perpetual") {
          continue;
        }
        const baseTicker = contract.base_currency.replace(/-PERP$/i, "").replace(/_USDT0?$/i, "");
        const fundingRate24H = contract.funding_rate || 0;
        const fundingRateAPR = fundingRate24H * 365;
        results.push({
          ticker: baseTicker,
          marketPrice: contract.mark_price || contract.last_price || null,
          fundingRateAPR,
          openInterest: contract.open_interest_usd || null,
          maxLeverage: null,
          volume24h: contract.quote_volume || null,
          spreadBidAsk: null,
          marketPriceChangePercent24h: contract.price_change_percent_24h || null,
          marketType: MarketType.CRYPTO
        });
      }
      return results;
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching NADO markets:", error3);
      throw error3;
    }
  }
};
