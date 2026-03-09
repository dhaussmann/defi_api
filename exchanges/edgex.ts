import axios from "axios";
import { BaseExchangeService } from "./base/BaseExchangeService";
import { UnifiedMarketData, MarketType } from "../../types/marketTypes";
import { getMarketType } from "../../utils/utils";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

var EDGEX_API_URL = "https://pro.edgex.exchange";
export class EdgeXService extends BaseExchangeService {
  contractsMetadata =  new Map();
  coinsMetadata =  new Map();
  // coinId -> coinName
  // Fetch contracts and coins metadata
  async fetchMetadata() {
    const url = `${EDGEX_API_URL}/api/v1/public/meta/getMetaData`;
    const startTime = Date.now();
    logApiRequest("GET", url);
    try {
      const response = await axios.get(url);
      logApiResponse("GET", url, response.status, Date.now() - startTime);
      if (response.data.code === "SUCCESS" && response.data.data) {
        for (const contract of response.data.data.contractList) {
          this.contractsMetadata.set(contract.contractId, contract);
        }
        for (const coin of response.data.data.coinList) {
          this.coinsMetadata.set(coin.coinId, coin.coinName);
        }
      }
    } catch (error3) {
      logApiError("GET", url, error3, Date.now() - startTime);
      console.error("Error fetching EdgeX metadata:", error3);
      throw error3;
    }
  }
  // Delay helper for rate limiting
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  // Fetch funding rate for a single contract with retry on 429
  async fetchFundingRateForContract(contractId, retries = 3) {
    const url = `${EDGEX_API_URL}/api/v1/public/funding/getLatestFundingRate`;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios.get(url, {
          params: { contractId },
          timeout: 15e3
        });
        if (response.data.code === "SUCCESS" && response.data.data && response.data.data.length > 0) {
          return response.data.data[0];
        }
        return null;
      } catch (error3) {
        const is429 = axios.isAxiosError(error3) && error3.response?.status === 429;
        if (is429 && attempt < retries - 1) {
          const backoffMs = 2e3 * 2 ** attempt;
          console.warn(
            `EdgeX 429 for ${contractId}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${retries})`
          );
          await this.delay(backoffMs);
          continue;
        }
        if (attempt === retries - 1) {
          console.warn(
            `Failed to fetch EdgeX funding rate for ${contractId} after ${retries} attempts`
          );
        }
        return null;
      }
    }
    return null;
  }
  // Fetch all funding rates with serialized requests to avoid rate limiting
  async fetchAllFundingRates(contractIds) {
    const startTime = Date.now();
    const delayBetweenRequests = 800;
    logApiRequest(
      "GET",
      `${EDGEX_API_URL}/api/v1/public/funding/getLatestFundingRate (${contractIds.length} contracts, serialized)`
    );
    const fundingRateMap =  new Map();
    for (let i = 0; i < contractIds.length; i++) {
      const contractId = contractIds[i];
      const fundingRate = await this.fetchFundingRateForContract(contractId);
      if (fundingRate) {
        fundingRateMap.set(contractId, fundingRate);
      }
      if (i < contractIds.length - 1) {
        await this.delay(delayBetweenRequests);
      }
    }
    logApiResponse(
      "GET",
      `${EDGEX_API_URL}/api/v1/public/funding/getLatestFundingRate (${contractIds.length} contracts)`,
      200,
      Date.now() - startTime
    );
    return fundingRateMap;
  }
  // Calculate APR from funding rate - EdgeX uses 4-hour intervals (240 minutes)
  calculateFundingRateAPR(rate) {
    const periodsPerDay = 24 / 4;
    const periodsPerYear = periodsPerDay * 365;
    return rate * periodsPerYear;
  }
  // Get all markets in unified format
  async getMarkets() {
    await this.fetchMetadata();
    const enabledContracts = Array.from(this.contractsMetadata.entries()).filter(
      ([_, contract]) => contract.enableDisplay && contract.enableTrade
    );
    if (enabledContracts.length === 0) {
      return [];
    }
    const contractIds = enabledContracts.map(([contractId, _]) => contractId);
    const fundingRateMap = await this.fetchAllFundingRates(contractIds);
    const results = [];
    for (const [contractId, contract] of enabledContracts) {
      const fundingRate = fundingRateMap.get(contractId);
      if (!fundingRate) {
        continue;
      }
      const rate = parseFloat(fundingRate.fundingRate);
      const fundingRateAPR = this.calculateFundingRateAPR(rate);
      const baseCoinName = this.coinsMetadata.get(contract.baseCoinId);
      if (!baseCoinName) {
        continue;
      }
      results.push({
        ticker: baseCoinName,
        // Use coin name directly (BTC, ETH, etc.)
        marketPrice: fundingRate.indexPrice ? parseFloat(fundingRate.indexPrice) : null,
        fundingRateAPR,
        openInterest: null,
        // Not available in funding rate endpoint
        maxLeverage: parseFloat(contract.displayMaxLeverage),
        volume24h: null,
        // Not available in funding rate endpoint
        marketPriceChangePercent24h: null,
        // Not available in funding rate endpoint
        spreadBidAsk: fundingRate.impactAskPrice && fundingRate.impactBidPrice && fundingRate.indexPrice ? Math.abs(
          parseFloat(fundingRate.impactAskPrice) - parseFloat(fundingRate.impactBidPrice)
        ) / parseFloat(fundingRate.indexPrice) * 100 : null,
        marketType: getMarketType(baseCoinName)
      });
    }
    return results;
  }
};
