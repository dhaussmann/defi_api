import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { getMarketType } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var GRVT_API_URL = "https://market-data.grvt.io/full/v1";
export class GrvtService extends BaseExchangeService {
  instruments =  new Map();
  grvtSymbolToTicker(symbol) {
    const parts = symbol.split("_");
    if (parts.length >= 1) {
      return parts[0];
    }
    return symbol;
  }
  async fetchInstruments() {
    const url = `${GRVT_API_URL}/instruments`;
    const startTime = Date.now();
    const payload = { kind: ["PERPETUAL"], is_active: true, limit: 1e4 };
    logApiRequest("POST", url, payload);
    try {
      const response = await axios.post(url, payload);
      logApiResponse("POST", url, response.status, Date.now() - startTime);
      for (const instrument of response.data.result) {
        if (instrument.kind === "PERPETUAL") {
          this.instruments.set(instrument.instrument, instrument);
        }
      }
    } catch (error3) {
      logApiError("POST", url, error3, Date.now() - startTime);
      throw error3;
    }
  }
  async fetchTicker(instrument) {
    const url = `${GRVT_API_URL}/ticker`;
    const startTime = Date.now();
    const payload = { instrument };
    logApiRequest("POST", url, payload);
    try {
      const response = await axios.post(url, payload);
      logApiResponse("POST", url, response.status, Date.now() - startTime);
      return response.data.result;
    } catch (error3) {
      logApiError("POST", url, error3, Date.now() - startTime);
      return null;
    }
  }
  calculateFundingRateAPR(rate, periodHours) {
    const periodsPerDay = 24 / periodHours;
    const periodsPerYear = periodsPerDay * 365;
    return rate * periodsPerYear;
  }
  async getMarkets() {
    await this.fetchInstruments();
    const results = [];
    const instrumentList = Array.from(this.instruments.values());
    const tickerPromises = instrumentList.map(async (instrument) => {
      const ticker = await this.fetchTicker(instrument.instrument);
      if (!ticker) return null;
      const markPrice = ticker.mark_price ? parseFloat(ticker.mark_price) : null;
      const fundingRateAPR = ticker.funding_rate ? this.calculateFundingRateAPR(
        parseFloat(ticker.funding_rate),
        instrument.funding_interval_hours ?? 8
      ) / 100 : null;
      const openInterest = ticker.open_interest && markPrice ? parseFloat(ticker.open_interest) * markPrice : null;
      const volume24h = ticker.buy_volume_24h_q && ticker.sell_volume_24h_q ? parseFloat(ticker.buy_volume_24h_q) + parseFloat(ticker.sell_volume_24h_q) : null;
      const spreadBidAsk = ticker.best_ask_price && ticker.best_bid_price && ticker.last_price ? Math.abs(parseFloat(ticker.best_ask_price) - parseFloat(ticker.best_bid_price)) / parseFloat(ticker.last_price) * 100 : null;
      return {
        ticker: this.grvtSymbolToTicker(instrument.instrument),
        marketPrice: markPrice,
        fundingRateAPR,
        openInterest,
        maxLeverage: null,
        volume24h,
        spreadBidAsk,
        marketType: getMarketType(instrument.base)
      };
    });
    const settledResults = await Promise.allSettled(tickerPromises);
    for (const result of settledResults) {
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
      }
    }
    return results;
  }
};
