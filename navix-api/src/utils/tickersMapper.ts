export const paradexSymbolToHyperliquid = (paradexSymbol: string): string => {
	return paradexSymbol.split("-")[0];
};

export const asterdexSymbolToHyperliquid = (asterdexSymbol: string): string => {
	if (asterdexSymbol.endsWith("USDT")) return asterdexSymbol.slice(0, -4);
	if (asterdexSymbol.endsWith("USD")) return asterdexSymbol.slice(0, -3);
	return asterdexSymbol;
};

export const apexSymbolToHyperliquid = (apexSymbol: string): string => {
	return apexSymbol.replace("USDT", "");
};

export const vestSymbolToHyperliquid = (vestSymbol: string): string => {
	return vestSymbol.split("-")[0];
};

export const extendedSymbolToHyperliquid = (extendedSymbol: string): string => {
	return extendedSymbol.split("-")[0];
};

export const arkmSymbolToHyperliquid = (arkmSymbol: string): string => {
	return arkmSymbol.split(".")[0];
};

export const reyaSymbolToHyperliquid = (reyaSymbol: string): string => {
	return reyaSymbol.replace("RUSDPERP", "");
};

export const etherealSymbolToHyperliquid = (etherealSymbol: string): string => {
	return etherealSymbol.replace("USD", "");
};

export const tradeXYZSymbolToHyperliquid = (tradeXYZSymbol: string): string => {
	return tradeXYZSymbol.includes(":") ? tradeXYZSymbol.split(":")[1] : tradeXYZSymbol;
};

export const rwaMapper = (rwaSymbol: string): string => {
	if (rwaSymbol.includes("XYZ100") || rwaSymbol.includes("NDX")) return "NASDAQ";
	if (rwaSymbol.includes("GOOG")) return "GOOGLE";
	if (rwaSymbol.includes("SPX")) return "S&P 500";
	return rwaSymbol;
};
