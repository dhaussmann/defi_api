import { ExchangeConfig } from "../../config/exchanges";
import { BaseExchangeService } from "./base/BaseExchangeService";

import { AevoService } from "./aevo";
import { HyperliquidService } from "./hyperliquid";
import { ParadexService } from "./paradex";
import { ExtendedService } from "./extended";
import { VestService } from "./vest";
import { AsterdexService } from "./asterdex";
import { AstrosService } from "./astros";
import { ApexService } from "./apex";
import { DriftService } from "./drift";
import { ArkmService } from "./arkm";
import { DydxService } from "./dydx";
import { EdgeXService } from "./edgex";
import { LighterService } from "./lighter";
import { PacificaService } from "./pacifica";
import { EtherealService } from "./ethereal";
import { ReyaService } from "./reya";
import { TradeXYZService } from "./tradexyz";
import { VariationalService } from "./variational";
import { ZeroOneService } from "./01";
import { BackpackService } from "./backpack";
import { EvedexService } from "./evedex";
import { NadoService } from "./nado";
import { GrvtService } from "./grvt";
import { StandxService } from "./standx";
import { HibachiService } from "./hibachi";
import { BullpenService } from "./bullpen";

const SERVICE_REGISTRY: Record<string, new () => BaseExchangeService> = {
	aevo: AevoService,
	hyperliquid: HyperliquidService,
	paradex: ParadexService,
	extended: ExtendedService,
	vest: VestService,
	asterdex: AsterdexService,
	astros: AstrosService,
	apex: ApexService,
	drift: DriftService,
	arkm: ArkmService,
	dydx: DydxService,
	edgex: EdgeXService,
	lighter: LighterService,
	pacifica: PacificaService,
	ethereal: EtherealService,
	reya: ReyaService,
	tradexyz: TradeXYZService,
	variational: VariationalService,
	"01": ZeroOneService,
	backpack: BackpackService,
	evedex: EvedexService,
	nado: NadoService,
	grvt: GrvtService,
	standx: StandxService,
	hibachi: HibachiService,
	bullpen: BullpenService,
};

export class ServiceFactory {
	private services = new Map<ExchangeConfig, BaseExchangeService>();

	getService(exchange: ExchangeConfig): BaseExchangeService {
		if (this.services.has(exchange)) {
			return this.services.get(exchange)!;
		}

		const ServiceClass = SERVICE_REGISTRY[exchange.key];
		if (!ServiceClass) {
			throw new Error(`Unsupported exchange: ${exchange.key}`);
		}

		const service = new ServiceClass();
		this.services.set(exchange, service);
		return service;
	}
}

export const serviceFactory = new ServiceFactory();
