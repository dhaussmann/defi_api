import { UnifiedMarketData } from "../../types/marketTypes";

export abstract class BaseExchangeService {
	abstract getMarkets(): Promise<UnifiedMarketData[]>;
}
