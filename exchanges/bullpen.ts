import { BaseExchangeService } from "./base/BaseExchangeService";
import { HyperliquidService } from "./hyperliquid";
import { TradeXYZService } from "./tradexyz";
import { logApiRequest, logApiResponse, logApiError } from "../../utils/logger";

export class BullpenService extends BaseExchangeService {
  hyperliquidService;
  tradeXYZService;
  constructor() {
    super();
    this.hyperliquidService = new HyperliquidService();
    this.tradeXYZService = new TradeXYZService();
  }
  async getMarkets() {
    const startTime = Date.now();
    logApiRequest("AGGREGATE", "bullpen", { sources: ["hyperliquid", "tradexyz"] });
    try {
      const [hyperliquidMarkets, tradeXYZMarkets] = await Promise.all([
        this.hyperliquidService.getMarkets(),
        this.tradeXYZService.getMarkets()
      ]);
      const seenTickers =  new Set();
      const aggregatedMarkets = [];
      for (const market of hyperliquidMarkets) {
        if (market && !seenTickers.has(market.ticker)) {
          seenTickers.add(market.ticker);
          aggregatedMarkets.push(market);
        }
      }
      for (const market of tradeXYZMarkets) {
        if (market && !seenTickers.has(market.ticker)) {
          seenTickers.add(market.ticker);
          aggregatedMarkets.push(market);
        }
      }
      logApiResponse("AGGREGATE", "bullpen", 200, Date.now() - startTime);
      return aggregatedMarkets;
    } catch (error3) {
      logApiError("AGGREGATE", "bullpen", error3, Date.now() - startTime);
      console.error("Error fetching Bullpen aggregated markets:", error3);
      throw error3;
    }
  }
};
