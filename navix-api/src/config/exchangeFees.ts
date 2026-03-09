export interface ExchangeFee {
	takerFeeBps: number;
	makerFeeBps: number;
}

export const EXCHANGE_FEES: Record<string, ExchangeFee> = {
	hyperliquid: { takerFeeBps: 4.5, makerFeeBps: 0.2 },
	paradex: { takerFeeBps: 0, makerFeeBps: 0 },
	extended: { takerFeeBps: 2.5, makerFeeBps: 1 },
	lighter: { takerFeeBps: 0, makerFeeBps: 0 },
	asterdex: { takerFeeBps: 4, makerFeeBps: 0.5 },
	edgex: { takerFeeBps: 2, makerFeeBps: 0 },
	variational: { takerFeeBps: 3, makerFeeBps: 0.5 },
	reya: { takerFeeBps: 2.5, makerFeeBps: 0 },
	pacifica: { takerFeeBps: 3, makerFeeBps: 1 },
	backpack: { takerFeeBps: 3, makerFeeBps: 1 },
	ethereal: { takerFeeBps: 2.5, makerFeeBps: 0.5 },
	vest: { takerFeeBps: 0, makerFeeBps: 0 },
	tradexyz: { takerFeeBps: 3, makerFeeBps: 1 },
	drift: { takerFeeBps: 3, makerFeeBps: 0.5 },
	evedex: { takerFeeBps: 3, makerFeeBps: 1 },
	apex: { takerFeeBps: 3.5, makerFeeBps: 1 },
	arkm: { takerFeeBps: 3, makerFeeBps: 1 },
	dydx: { takerFeeBps: 2.5, makerFeeBps: 1 },
	aevo: { takerFeeBps: 3, makerFeeBps: 0 },
	"01": { takerFeeBps: 3, makerFeeBps: 1 },
	nado: { takerFeeBps: 3, makerFeeBps: 1 },
	grvt: { takerFeeBps: 2.5, makerFeeBps: 0.5 },
	astros: { takerFeeBps: 3, makerFeeBps: 1 },
	standx: { takerFeeBps: 3, makerFeeBps: 1 },
	hibachi: { takerFeeBps: 3, makerFeeBps: 1 },
	bullpen: { takerFeeBps: 3, makerFeeBps: 1 },
};

export function bpsToPercent(bps: number): number {
	return bps / 100;
}
