/**
 * V4 Exchange Services
 *
 * Fetch-based implementations of all exchange market data collectors.
 * Adapted from exchanges/*.ts (replacing axios with native fetch).
 * Returns UnifiedMarketData[] per exchange.
 *
 * Exchanges: hyperliquid, paradex, lighter, edgex, ethereal, extended,
 *            asterdex, variational, reya, pacifica, backpack, vest,
 *            tradexyz, drift, evedex, apex, arkm, dydx, aevo, 01,
 *            nado, grvt, astros, standx, hibachi, bullpen
 */

// ============================================================
// Types
// ============================================================

export type MarketType = 'crypto' | 'stock' | 'forex' | 'etf' | 'index' | 'commodity';

export interface UnifiedMarketData {
  ticker: string;
  marketPrice: number | null;
  fundingRateAPR: number;
  openInterest: number | null;
  maxLeverage: number | null;
  volume24h: number | null;
  spreadBidAsk: number | null;
  marketPriceChangePercent24h: number | null;
  marketType: MarketType;
}

// ============================================================
// MarketType Classification (from navix-api/src/types/marketTypes.ts)
// ============================================================

const stockMarkets = new Set([
  'abtc', 'mstr', 'stke', 'cyph', 'sbet', 'bmnr', 'hypd', 'naka',
  'stss', 'upxi', 'asst', 'alts', 'hsdt', 'bnc', 'dfdv', 'nvda',
  'msft', 'aapl', 'amzn', 'goog', 'fb', 'tsla', 'pltr', 'gold',
  'hood', 'intc', 'coin', 'meta', 'orcl', 'amd', 'pzza', 'alts',
  'upxi', 'grnd', 'bynd', 'alh', 'snap', 'stke', 'spot', 'onds',
]);

const forexMarkets = new Set(['eur', 'gbp', 'jpy', 'cad', 'chf', 'aud', 'nok', 'bek', 'nzd']);
const commodityMarkets = new Set(['xau', 'xag']);
const indexMarkets = new Set(['ndx', 'xyz', 'spx']);
const etfMarkets = new Set(['spy', 'nvm', 'qqq', 'gld', 'gdx', 'sil', 'ura', 'slv', 'remx']);

function getMarketType(ticker: string): MarketType {
  if (!ticker) return 'crypto';
  const t = ticker.toLowerCase();
  if (stockMarkets.has(t)) return 'stock';
  if (forexMarkets.has(t)) return 'forex';
  if (etfMarkets.has(t)) return 'etf';
  if (indexMarkets.has(t)) return 'index';
  if (commodityMarkets.has(t)) return 'commodity';
  return 'crypto';
}

// ============================================================
// Utility Functions
// ============================================================

function calculateFundingRatesFrom8H(rate8H: number): number {
  return rate8H * 3 * 365;
}

function calculateFundingRatesFromHourly(hourlyRate: number): number {
  return hourlyRate * 24 * 365;
}

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

// Symbol mappers (from navix-api/src/utils/tickersMapper.ts)
const paradexSymbolToTicker = (s: string) => s.split('-')[0];
const asterdexSymbolToTicker = (s: string) => s.endsWith('USDT') ? s.slice(0, -4) : s.endsWith('USD') ? s.slice(0, -3) : s;
const apexSymbolToTicker = (s: string) => s.replace('USDT', '');
const vestSymbolToTicker = (s: string) => s.split('-')[0];
const extendedSymbolToTicker = (s: string) => s.split('-')[0];
const arkmSymbolToTicker = (s: string) => s.split('.')[0];
const reyaSymbolToTicker = (s: string) => s.replace('RUSDPERP', '');
const etherealSymbolToTicker = (s: string) => s.replace('USD', '');
const tradeXYZSymbolToTicker = (s: string) => s.includes(':') ? s.split(':')[1] : s;
const rwaMapper = (s: string) => {
  if (s.includes('XYZ100') || s.includes('NDX')) return 'NASDAQ';
  if (s.includes('GOOG')) return 'GOOGLE';
  if (s.includes('SPX')) return 'S&P 500';
  return s;
};

// ============================================================
// Exchange Collectors
// ============================================================

// ---- Hyperliquid ----
export async function collectHyperliquid(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  });
  const [meta, assetContexts] = data;
  return meta.universe
    .map((market: any, index: number) => {
      if (market.isDelisted) return null;
      const rate8H = parseFloat(assetContexts[index]?.funding || '0') * 8;
      const marketPrice = assetContexts[index]?.markPx ? parseFloat(assetContexts[index].markPx) : null;
      const openInterestTokens = assetContexts[index]?.openInterest ? parseFloat(assetContexts[index].openInterest) : null;
      return {
        ticker: market.name,
        marketPrice,
        fundingRateAPR: calculateFundingRatesFrom8H(rate8H),
        openInterest: openInterestTokens && marketPrice ? openInterestTokens * marketPrice : null,
        maxLeverage: market.maxLeverage || null,
        volume24h: assetContexts[index]?.dayNtlVlm ? parseFloat(assetContexts[index].dayNtlVlm) : null,
        spreadBidAsk: assetContexts[index]?.impactPxs && marketPrice
          ? ((parseFloat(assetContexts[index].impactPxs[1]) - parseFloat(assetContexts[index].impactPxs[0])) / marketPrice) * 100
          : null,
        marketPriceChangePercent24h: marketPrice && assetContexts[index]?.prevDayPx
          ? ((marketPrice - parseFloat(assetContexts[index].prevDayPx)) / parseFloat(assetContexts[index].prevDayPx)) * 100
          : null,
        marketType: getMarketType(market.name),
      } as UnifiedMarketData;
    })
    .filter((m: UnifiedMarketData | null): m is UnifiedMarketData => m !== null);
}

// ---- Paradex ----
export async function collectParadex(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://api.prod.paradex.trade/v1';
  const [metaData, summaryData] = await Promise.all([
    fetchJson(`${BASE}/markets`),
    fetchJson(`${BASE}/markets/summary?market=ALL`),
  ]);

  const fundingPeriods = new Map<string, number>();
  for (const market of (metaData.results || [])) {
    if (market.asset_kind === 'PERP') {
      fundingPeriods.set(market.symbol, market.funding_period_hours || 8);
    }
  }

  return (summaryData.results || [])
    .filter((m: any) => m.symbol?.includes('-PERP'))
    .map((m: any) => {
      const rate = parseFloat(m.funding_rate);
      const periodHours = fundingPeriods.get(m.symbol) || 8;
      const fundingRateAPR = rate * (24 / periodHours) * 365;
      const markPrice = m.mark_price ? parseFloat(m.mark_price) : null;
      return {
        ticker: paradexSymbolToTicker(m.symbol),
        marketPrice: markPrice,
        fundingRateAPR,
        openInterest: m.open_interest && markPrice ? parseFloat(m.open_interest) * markPrice : null,
        maxLeverage: null,
        volume24h: m.volume_24h ? parseFloat(m.volume_24h) : null,
        spreadBidAsk: m.ask && m.bid && m.last_traded_price
          ? Math.abs(parseFloat(m.ask) - parseFloat(m.bid)) / parseFloat(m.last_traded_price) * 100
          : null,
        marketPriceChangePercent24h: m.price_change_rate_24h ? parseFloat(m.price_change_rate_24h) * 100 : null,
        marketType: getMarketType(paradexSymbolToTicker(m.symbol)),
      } as UnifiedMarketData;
    });
}

// ---- Lighter ----
export async function collectLighter(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://mainnet.zklighter.elliot.ai/api/v1';
  const now = Math.floor(Date.now() / 1000);
  const start = now - 7200; // last 2h to get at least one funding entry

  // Fetch all active markets
  const obData = await fetchJson(`${BASE}/orderBooks`);
  const markets: { id: number; symbol: string }[] = (obData.order_books || [])
    .filter((m: any) => m.status === 'active')
    .map((m: any) => ({ id: m.market_id, symbol: m.symbol }));

  // Fetch latest funding for each market in parallel batches of 20
  const BATCH = 20;
  const results: UnifiedMarketData[] = [];

  for (let i = 0; i < markets.length; i += BATCH) {
    const batch = markets.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(
      batch.map(async (m) => {
        const url = `${BASE}/fundings?market_id=${m.id}&resolution=1h&start_timestamp=${start}&end_timestamp=${now}&count_back=0`;
        const data = await fetchJson(url);
        const fundings: any[] = data.fundings || [];
        if (fundings.length === 0) return null;
        const latest = fundings[fundings.length - 1];
        const rateHourly = parseFloat(latest.rate); // already hourly percent
        const ticker = m.symbol.split('-')[0].split('/')[0];
        return {
          ticker,
          marketPrice: null,
          fundingRateAPR: rateHourly * 24 * 365,
          openInterest: null,
          maxLeverage: null,
          volume24h: null,
          spreadBidAsk: null,
          marketPriceChangePercent24h: null,
          marketType: getMarketType(ticker),
        } as UnifiedMarketData;
      })
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }
  }

  return results;
}

// ---- EdgeX ----
export async function collectEdgeX(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://pro.edgex.exchange';
  const metaData = await fetchJson(`${BASE}/api/v1/public/meta/getMetaData`);
  if (metaData.code !== 'SUCCESS' || !metaData.data) return [];

  const contractsMap = new Map<string, any>();
  const coinsMap = new Map<string, string>();
  for (const c of metaData.data.contractList) contractsMap.set(c.contractId, c);
  for (const c of metaData.data.coinList) coinsMap.set(c.coinId, c.coinName);

  const enabledContracts = Array.from(contractsMap.entries())
    .filter(([, c]) => c.enableDisplay && c.enableTrade);

  const results: UnifiedMarketData[] = [];
  for (const [contractId, contract] of enabledContracts) {
    try {
      const frData = await fetchJson(`${BASE}/api/v1/public/funding/getLatestFundingRate?contractId=${contractId}`);
      if (frData.code !== 'SUCCESS' || !frData.data?.length) continue;
      const fr = frData.data[0];
      const rate = parseFloat(fr.fundingRate);
      const fundingRateAPR = rate * (24 / 4) * 365;
      const baseCoin = coinsMap.get(contract.baseCoinId);
      if (!baseCoin) continue;
      results.push({
        ticker: baseCoin,
        marketPrice: fr.indexPrice ? parseFloat(fr.indexPrice) : null,
        fundingRateAPR,
        openInterest: null,
        maxLeverage: parseFloat(contract.displayMaxLeverage),
        volume24h: null,
        spreadBidAsk: fr.impactAskPrice && fr.impactBidPrice && fr.indexPrice
          ? Math.abs(parseFloat(fr.impactAskPrice) - parseFloat(fr.impactBidPrice)) / parseFloat(fr.indexPrice) * 100
          : null,
        marketPriceChangePercent24h: null,
        marketType: getMarketType(baseCoin),
      });
      await new Promise(r => setTimeout(r, 200)); // rate limit
    } catch {}
  }
  return results;
}

// ---- Ethereal ----
export async function collectEthereal(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://api.ethereal.trade/v1';
  const productsData = await fetchJson(`${BASE}/product?order=asc&orderBy=createdAt`);
  const perpetuals = (productsData.data || []).filter((p: any) => p.engineType === 0);
  if (!perpetuals.length) return [];

  const productIds = perpetuals.map((p: any) => p.id).join(',');
  const pricesData = await fetchJson(`${BASE}/product/market-price?productIds=${productIds}`);
  const priceMap = new Map<string, any>();
  for (const pd of (pricesData.data || [])) priceMap.set(pd.productId, pd);

  return perpetuals.map((product: any) => {
    const priceData = priceMap.get(product.id);
    const rate1H = parseFloat(product.fundingRate1h);
    let marketPrice = null, spreadBidAsk = null, marketPriceChangePercent24h = null;
    if (priceData) {
      const oraclePrice = parseFloat(priceData.oraclePrice);
      const price24hAgo = parseFloat(priceData.price24hAgo);
      const bestBid = parseFloat(priceData.bestBidPrice);
      const bestAsk = parseFloat(priceData.bestAskPrice);
      marketPrice = oraclePrice;
      if (bestBid > 0 && bestAsk > 0) spreadBidAsk = (bestAsk - bestBid) / bestBid * 100;
      if (price24hAgo > 0) marketPriceChangePercent24h = (oraclePrice - price24hAgo) / price24hAgo * 100;
    }
    return {
      ticker: etherealSymbolToTicker(product.ticker),
      marketPrice,
      fundingRateAPR: rate1H * 24 * 365,
      openInterest: parseFloat(product.openInterest),
      maxLeverage: product.maxLeverage,
      volume24h: parseFloat(product.volume24h),
      spreadBidAsk,
      marketPriceChangePercent24h,
      marketType: getMarketType(etherealSymbolToTicker(product.ticker)),
    } as UnifiedMarketData;
  });
}

// ---- Extended ----
export async function collectExtended(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://api.starknet.extended.exchange/api/v1/info/markets', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; defiapi/1.0)' },
  });
  return (data.data || [])
    .filter((m: any) => m.active && m.status === 'ACTIVE')
    .map((m: any) => {
      const rate8H = parseFloat(m.marketStats.fundingRate) * 8;
      const baseCurrency = m.assetName || extendedSymbolToTicker(m.name);
      const markPrice = m.marketStats.markPrice ? parseFloat(m.marketStats.markPrice) : null;
      return {
        ticker: baseCurrency,
        marketPrice: markPrice,
        fundingRateAPR: calculateFundingRatesFrom8H(rate8H),
        openInterest: parseFloat(m.marketStats.openInterest),
        maxLeverage: m.tradingConfig?.maxLeverage ? parseFloat(m.tradingConfig.maxLeverage) : null,
        volume24h: m.marketStats?.dailyVolume ? parseFloat(m.marketStats.dailyVolume) : null,
        spreadBidAsk: m.marketStats?.askPrice && m.marketStats?.bidPrice && markPrice
          ? (parseFloat(m.marketStats.askPrice) - parseFloat(m.marketStats.bidPrice)) / markPrice * 100
          : null,
        marketPriceChangePercent24h: parseFloat(m.marketStats.dailyPriceChangePercentage) * 100,
        marketType: getMarketType(baseCurrency),
      } as UnifiedMarketData;
    });
}

// ---- Asterdex ----
export async function collectAsterdex(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://fapi.asterdex.com';
  const [premiumData, fundingInfoData, ticker24hrData] = await Promise.all([
    fetchJson(`${BASE}/fapi/v3/premiumIndex`).catch(() => []),
    fetchJson(`${BASE}/fapi/v3/fundingInfo`).catch(() => []),
    fetchJson(`${BASE}/fapi/v3/ticker/24hr`).catch(() => []),
  ]);

  const fundingInfoMap = new Map<string, any>();
  for (const info of fundingInfoData) fundingInfoMap.set(info.symbol, info);
  const tickerMap = new Map<string, any>();
  for (const t of ticker24hrData) tickerMap.set(t.symbol, t);

  const results: UnifiedMarketData[] = [];
  for (const premium of premiumData) {
    if ((!premium.symbol.endsWith('USDT') && !premium.symbol.endsWith('USD')) || premium.symbol.startsWith('SHIELD')) continue;
    const ticker = asterdexSymbolToTicker(premium.symbol);
    const fundingInfo = fundingInfoMap.get(premium.symbol);
    const ticker24hr = tickerMap.get(premium.symbol);
    const fundingRate = parseFloat(premium.lastFundingRate || '0');
    const intervalHours = fundingInfo?.fundingIntervalHours ?? 8;
    const markPrice = premium.markPrice ? parseFloat(premium.markPrice) : null;
    const indexPrice = premium.indexPrice ? parseFloat(premium.indexPrice) : null;
    results.push({
      ticker,
      marketPrice: markPrice,
      fundingRateAPR: fundingRate * (24 / intervalHours) * 365,
      openInterest: null,
      maxLeverage: null,
      volume24h: ticker24hr?.quoteVolume ? parseFloat(ticker24hr.quoteVolume) : null,
      spreadBidAsk: markPrice && indexPrice ? Math.abs(markPrice - indexPrice) / indexPrice * 100 : null,
      marketPriceChangePercent24h: ticker24hr?.priceChangePercent ? parseFloat(ticker24hr.priceChangePercent) : null,
      marketType: getMarketType(ticker),
    });
  }
  return results;
}

// ---- Variational ----
export async function collectVariational(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats');
  return (data.listings || []).map((listing: any) => {
    const longOI = parseFloat(listing.open_interest?.long_open_interest || '0');
    const shortOI = parseFloat(listing.open_interest?.short_open_interest || '0');
    return {
      ticker: listing.ticker,
      marketPrice: parseFloat(listing.mark_price || '0'),
      fundingRateAPR: parseFloat(listing.funding_rate || '0'),
      openInterest: longOI + shortOI,
      volume24h: parseFloat(listing.volume_24h || '0'),
      maxLeverage: null,
      spreadBidAsk: null,
      marketPriceChangePercent24h: null,
      marketType: 'crypto' as MarketType,
    };
  });
}

// ---- Reya ----
export async function collectReya(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://api.reya.xyz/v2';
  const [definitionsData, pricesData, summaryData] = await Promise.all([
    fetchJson(`${BASE}/marketDefinitions`),
    fetchJson(`${BASE}/prices`),
    fetchJson(`${BASE}/markets/summary`),
  ]);

  const definitions = new Map<string, any>();
  for (const d of (definitionsData || [])) definitions.set(d.symbol, d);
  const prices = new Map<string, any>();
  for (const p of (pricesData || [])) prices.set(p.symbol, p);

  return (summaryData || []).reduce((acc: UnifiedMarketData[], market: any) => {
    const hourlyRate = parseFloat(market.fundingRate);
    const priceData = prices.get(market.symbol);
    const marketPrice = priceData?.poolPrice ? parseFloat(priceData.poolPrice) : priceData?.oraclePrice ? parseFloat(priceData.oraclePrice) : null;
    const oiQty = parseFloat(market.oiQty);
    const openInterest = oiQty && marketPrice ? oiQty * marketPrice : null;
    if (!openInterest || openInterest === 0 || parseFloat(market.volume24h) === 0) return acc;
    const definition = definitions.get(market.symbol);
    acc.push({
      ticker: reyaSymbolToTicker(market.symbol),
      marketPrice,
      fundingRateAPR: calculateFundingRatesFromHourly(hourlyRate) / 100,
      openInterest,
      maxLeverage: definition?.maxLeverage || null,
      volume24h: market.volume24h ? parseFloat(market.volume24h) : null,
      spreadBidAsk: null,
      marketPriceChangePercent24h: market.pxChange24h ? parseFloat(market.pxChange24h) : null,
      marketType: 'crypto',
    });
    return acc;
  }, []);
}

// ---- Pacifica ----
export async function collectPacifica(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://api.pacifica.fi/api/v1/info/prices');
  if (!data.success) return [];
  return (data.data || []).map((market: any) => {
    const rate1H = parseFloat(market.funding);
    const currentPrice = parseFloat(market.mark);
    const yesterdayPrice = parseFloat(market.yesterday_price);
    return {
      ticker: market.symbol,
      marketPrice: currentPrice,
      fundingRateAPR: rate1H * 24 * 365,
      openInterest: parseFloat(market.open_interest),
      maxLeverage: null,
      volume24h: parseFloat(market.volume_24h),
      spreadBidAsk: null,
      marketPriceChangePercent24h: yesterdayPrice > 0 ? (currentPrice - yesterdayPrice) / yesterdayPrice * 100 : null,
      marketType: 'crypto' as MarketType,
    };
  });
}

// ---- Backpack ----
export async function collectBackpack(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://api.backpack.exchange';
  const [marketsData, tickersData, markPricesData, openInterestData] = await Promise.all([
    fetchJson(`${BASE}/api/v1/markets`).catch(() => []),
    fetchJson(`${BASE}/api/v1/tickers`).catch(() => []),
    fetchJson(`${BASE}/api/v1/markPrices`).catch(() => []),
    fetchJson(`${BASE}/api/v1/openInterest`).catch(() => []),
  ]);

  const tickerMap = new Map<string, any>();
  for (const t of tickersData) tickerMap.set(t.symbol, t);
  const markPriceMap = new Map<string, any>();
  for (const mp of markPricesData) markPriceMap.set(mp.symbol, mp);
  const oiMap = new Map<string, any>();
  for (const oi of openInterestData) oiMap.set(oi.symbol, oi);

  return (marketsData || [])
    .filter((m: any) => m.marketType === 'PERP' && m.visible)
    .map((market: any) => {
      const ticker = tickerMap.get(market.symbol);
      const markPrice = markPriceMap.get(market.symbol);
      const oi = oiMap.get(market.symbol);
      const fundingRateStr = markPrice?.fundingRate || '0';
      const fundingRatePerInterval = parseFloat(fundingRateStr);
      const fundingIntervalMs = market.fundingInterval || 3600000;
      const intervalsPerHour = 3600000 / fundingIntervalMs;
      const hourlyFundingRate = fundingRatePerInterval * intervalsPerHour;
      const marketPriceNum = markPrice?.markPrice ? parseFloat(markPrice.markPrice) : null;
      const oiNum = oi?.openInterest ? parseFloat(oi.openInterest) : null;
      const baseTicker = market.baseSymbol || market.symbol.split('_')[0];
      return {
        ticker: baseTicker,
        marketPrice: marketPriceNum,
        fundingRateAPR: calculateFundingRatesFromHourly(hourlyFundingRate),
        openInterest: oiNum && marketPriceNum ? oiNum * marketPriceNum : null,
        maxLeverage: market.filters?.leverage?.maxLeverage ? parseFloat(market.filters.leverage.maxLeverage) : null,
        volume24h: ticker?.quoteVolume ? parseFloat(ticker.quoteVolume) : null,
        spreadBidAsk: null,
        marketPriceChangePercent24h: ticker?.priceChangePercent ? parseFloat(ticker.priceChangePercent) : null,
        marketType: 'crypto' as MarketType,
      };
    });
}

// ---- Vest ----
export async function collectVest(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://server-prod.hz.vestmarkets.com/v2';
  const HEADERS = { xrestservermm: 'restserver0' };
  const [tickersData, tickers24hData] = await Promise.all([
    fetchJson(`${BASE}/ticker/latest`, { headers: HEADERS }).catch(() => ({ tickers: [] })),
    fetchJson(`${BASE}/ticker/24hr`, { headers: HEADERS }).catch(() => ({ tickers: [] })),
  ]);

  const allTickers = tickersData.tickers || [];
  const tickers24h: any[] = tickers24hData.tickers || [];

  return allTickers
    .filter((t: any) => t.status === 'TRADING' && t.symbol.includes('-') && tickers24h.some((t2: any) => t2.symbol === t.symbol))
    .map((vestTicker: any) => {
      const hourlyRate = parseFloat(vestTicker.oneHrFundingRate || '0');
      const baseCurrency = vestSymbolToTicker(vestTicker.symbol);
      const additionalData = tickers24h.find((t2: any) => t2.symbol === vestTicker.symbol);
      let marketType: MarketType = 'crypto';
      if (vestTicker.symbol.includes('-USD-')) {
        marketType = getMarketType(baseCurrency);
        if (marketType === 'crypto') marketType = 'stock';
      }
      return {
        ticker: rwaMapper(baseCurrency),
        marketPrice: vestTicker.markPrice ? parseFloat(vestTicker.markPrice) : null,
        fundingRateAPR: calculateFundingRatesFromHourly(hourlyRate),
        openInterest: null,
        maxLeverage: null,
        volume24h: additionalData?.quoteVolume ? parseFloat(additionalData.quoteVolume) : null,
        spreadBidAsk: vestTicker.markPrice && vestTicker.indexPrice
          ? Math.abs(parseFloat(vestTicker.markPrice) - parseFloat(vestTicker.indexPrice)) / parseFloat(vestTicker.indexPrice) * 100
          : null,
        marketPriceChangePercent24h: additionalData?.priceChangePercent ? parseFloat(additionalData.priceChangePercent) * 100 : null,
        marketType,
      };
    });
}

// ---- TradeXYZ ----
export async function collectTradeXYZ(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'xyz' }),
  });
  const [meta, assetContexts] = data;
  return meta.universe
    .map((market: any, index: number) => {
      if (market.isDelisted) return null;
      const rate8H = parseFloat(assetContexts[index]?.funding || '0') * 8;
      const marketPrice = assetContexts[index]?.markPx ? parseFloat(assetContexts[index].markPx) : null;
      const openInterestTokens = assetContexts[index]?.openInterest ? parseFloat(assetContexts[index].openInterest) : null;
      const ticker = tradeXYZSymbolToTicker(rwaMapper(market.name));
      return {
        ticker,
        marketPrice,
        fundingRateAPR: calculateFundingRatesFrom8H(rate8H),
        openInterest: openInterestTokens && marketPrice ? openInterestTokens * marketPrice : null,
        maxLeverage: market.maxLeverage || null,
        volume24h: assetContexts[index]?.dayNtlVlm ? parseFloat(assetContexts[index].dayNtlVlm) : null,
        spreadBidAsk: assetContexts[index]?.impactPxs && marketPrice
          ? (parseFloat(assetContexts[index].impactPxs[1]) - parseFloat(assetContexts[index].impactPxs[0])) / marketPrice * 100
          : null,
        marketPriceChangePercent24h: marketPrice && assetContexts[index]?.prevDayPx
          ? (marketPrice - parseFloat(assetContexts[index].prevDayPx)) / parseFloat(assetContexts[index].prevDayPx) * 100
          : null,
        marketType: getMarketType(ticker),
      } as UnifiedMarketData;
    })
    .filter((m: UnifiedMarketData | null): m is UnifiedMarketData => m !== null);
}

// ---- Drift ----
export async function collectDrift(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://data.api.drift.trade/contracts');
  const allContracts = Array.isArray(data) ? data : data.contracts;
  if (!allContracts) return [];
  return allContracts
    .filter((c: any) => c.product_type === 'PERP' && parseFloat(c.open_interest) > 0 && parseFloat(c.quote_volume) > 0)
    .map((c: any) => {
      const fundingRate = parseFloat(c.funding_rate) * 8 / 100;
      return {
        ticker: c.index_name,
        marketPrice: parseFloat(c.last_price) || 0,
        fundingRateAPR: calculateFundingRatesFrom8H(fundingRate),
        openInterest: parseFloat(c.open_interest) || 0,
        maxLeverage: null,
        volume24h: parseFloat(c.quote_volume) || 0,
        spreadBidAsk: null,
        marketPriceChangePercent24h: null,
        marketType: 'crypto' as MarketType,
      };
    });
}

// ---- Evedex ----
export async function collectEvedex(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://exchange-api.evedex.com/api/market/instrument?fields=metrics');
  return (data || [])
    .filter((inst: any) => inst.trading !== 'none' && inst.trading !== 'restricted' && inst.marketState === 'OPEN')
    .map((inst: any) => {
      const fundingRate8H = parseFloat(inst.fundingRate || '0') * -1;
      const markPrice = inst.markPrice || null;
      const ticker = (inst.name || inst.displayName || inst.id)
        .replace(/[-_]?PERP$/i, '').replace(/[-_]?USD[CT]?$/i, '').replace(/\/.*$/, '');
      return {
        ticker,
        marketPrice: markPrice,
        fundingRateAPR: calculateFundingRatesFrom8H(fundingRate8H),
        openInterest: inst.openInterest && markPrice ? inst.openInterest * markPrice : null,
        maxLeverage: inst.maxLeverage || null,
        volume24h: inst.volumeBase || null,
        spreadBidAsk: null,
        marketPriceChangePercent24h: inst.closePrice && inst.lastPrice
          ? (inst.lastPrice - inst.closePrice) / inst.closePrice * 100
          : null,
        marketType: 'crypto' as MarketType,
      };
    });
}

// ---- Apex ----
export async function collectApex(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://omni.apex.exchange/api';
  const configData = await fetchJson(`${BASE}/v3/symbols`);
  const availableSymbols = (configData.data?.contractConfig?.perpetualContract || [])
    .filter((c: any) => c.enableTrade && c.enableDisplay);

  const results: UnifiedMarketData[] = [];
  await Promise.allSettled(availableSymbols.map(async (symbolData: any) => {
    try {
      const tickerData = await fetchJson(`${BASE}/v3/ticker?symbol=${symbolData.crossSymbolName}`);
      const td = tickerData.data?.[0];
      if (!td) return;
      const hourlyRate = parseFloat(td.fundingRate);
      results.push({
        ticker: apexSymbolToTicker(symbolData.crossSymbolName),
        marketPrice: td.lastPrice ? parseFloat(td.lastPrice) : null,
        fundingRateAPR: calculateFundingRatesFromHourly(hourlyRate),
        openInterest: parseFloat(td.openInterest) || null,
        maxLeverage: symbolData.displayMaxLeverage ? parseFloat(symbolData.displayMaxLeverage) : null,
        volume24h: td.volume24h ? parseFloat(td.volume24h) : null,
        spreadBidAsk: null,
        marketPriceChangePercent24h: td.price24hPcnt ? parseFloat(td.price24hPcnt) * 100 : null,
        marketType: 'crypto' as MarketType,
      });
    } catch {}
  }));
  return results;
}

// ---- ARKM ----
export async function collectArkm(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://arkm.com/api/public/tickers');
  return (data || [])
    .filter((m: any) => m.productType === 'perpetual')
    .map((market: any) => {
      const rate8H = parseFloat(market.fundingRate || '0');
      return {
        ticker: arkmSymbolToTicker(market.baseSymbol),
        marketPrice: parseFloat(market.markPrice),
        fundingRateAPR: calculateFundingRatesFrom8H(rate8H),
        openInterest: parseFloat(market.openInterest),
        maxLeverage: null,
        volume24h: parseFloat(market.usdVolume24h),
        spreadBidAsk: null,
        marketPriceChangePercent24h: null,
        marketType: 'crypto' as MarketType,
      };
    });
}

// ---- dYdX ----
export async function collectDydx(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://indexer.dydx.trade/v4/perpetualMarkets');
  const marketsData = data.markets || {};
  return Object.values(marketsData).map((market: any) => {
    const hourlyRate = parseFloat(market.defaultFundingRate1H || '0');
    const baseTicker = market.ticker.split('-')[0];
    return {
      ticker: baseTicker,
      marketPrice: parseFloat(market.oraclePrice),
      fundingRateAPR: calculateFundingRatesFromHourly(hourlyRate),
      openInterest: parseFloat(market.openInterest),
      maxLeverage: market.initialMarginFraction ? 1 / parseFloat(market.initialMarginFraction) : null,
      volume24h: parseFloat(market.volume24H),
      spreadBidAsk: null,
      marketPriceChangePercent24h: parseFloat(market.priceChange24H) / parseFloat(market.oraclePrice) * 100,
      marketType: 'crypto' as MarketType,
    };
  });
}

// ---- Aevo ----
export async function collectAevo(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://api.aevo.xyz';
  const marketsData = await fetchJson(`${BASE}/markets?instrument_type=PERPETUAL`);
  if (!Array.isArray(marketsData)) return [];
  const perpetuals = marketsData.filter((m: any) => m.instrument_type === 'PERPETUAL' && m.is_active);

  const results: UnifiedMarketData[] = [];
  for (const market of perpetuals) {
    try {
      const [fundingData, statsData] = await Promise.all([
        fetchJson(`${BASE}/funding?instrument_name=${encodeURIComponent(market.instrument_name)}`).catch(() => null),
        fetchJson(`${BASE}/statistics?asset=${market.instrument_name.split('-')[0]}&instrument_type=PERPETUAL`).catch(() => null),
      ]);
      if (!fundingData) continue;
      const fundingRate = parseFloat(fundingData.funding_rate);
      const baseTicker = market.instrument_name.split('-')[0];
      results.push({
        ticker: baseTicker,
        marketPrice: parseFloat(market.mark_price),
        fundingRateAPR: calculateFundingRatesFrom8H(fundingRate),
        openInterest: statsData ? parseFloat(statsData.open_interest?.total) * parseFloat(market.mark_price) : null,
        maxLeverage: parseFloat(market.max_leverage),
        volume24h: statsData ? parseFloat(statsData.daily_volume) : null,
        spreadBidAsk: null,
        marketPriceChangePercent24h: statsData
          ? ((parseFloat(statsData.mark_price) - parseFloat(statsData.mark_price_24h_ago)) / parseFloat(statsData.mark_price_24h_ago)) * 100
          : null,
        marketType: 'crypto' as MarketType,
      });
      await new Promise(r => setTimeout(r, 150)); // rate limit
    } catch {}
  }
  return results;
}

// ---- 01 / Nord ----
export async function collectZeroOne(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://zo-mainnet.n1.xyz';
  const infoData = await fetchJson(`${BASE}/info`);
  const markets = infoData.markets || [];

  const results: UnifiedMarketData[] = [];
  await Promise.allSettled(markets.map(async (market: any) => {
    try {
      const stats = await fetchJson(`${BASE}/market/${market.marketId}/stats`);
      const fundingRate1H = stats.perpStats?.funding_rate || 0;
      const markPrice = stats.perpStats?.mark_price || null;
      const openInterest = stats.perpStats?.open_interest || null;
      const ticker = (market.symbol || market.name)
        .replace(/[-_]?PERP$/i, '').replace(/[-_]?USD[CT]?$/i, '');
      results.push({
        ticker,
        marketPrice: markPrice,
        fundingRateAPR: calculateFundingRatesFromHourly(fundingRate1H),
        openInterest: openInterest && markPrice ? openInterest * markPrice : null,
        maxLeverage: market.maxLeverage || null,
        volume24h: stats.volumeQuote24h || null,
        spreadBidAsk: null,
        marketPriceChangePercent24h: stats.prevClose24h && stats.close24h
          ? (stats.close24h - stats.prevClose24h) / stats.prevClose24h * 100
          : null,
        marketType: 'crypto' as MarketType,
      });
    } catch {}
  }));
  return results;
}

// ---- Nado ----
export async function collectNado(): Promise<UnifiedMarketData[]> {
  const data = await fetchJson('https://archive.prod.nado.xyz/v2/contracts');
  return Object.values(data)
    .filter((c: any) => c.product_type === 'perpetual')
    .map((c: any) => {
      const baseTicker = c.base_currency.replace(/-PERP$/i, '').replace(/_USDT0?$/i, '');
      const fundingRate24H = c.funding_rate || 0; // Nado funding_rate is 24h rate (divide by 24 for hourly)
      return {
        ticker: baseTicker,
        marketPrice: c.mark_price || c.last_price || null,
        fundingRateAPR: fundingRate24H * 365,
        openInterest: c.open_interest_usd || null,
        maxLeverage: null,
        volume24h: c.quote_volume || null,
        spreadBidAsk: null,
        marketPriceChangePercent24h: c.price_change_percent_24h || null,
        marketType: 'crypto' as MarketType,
      };
    });
}

// ---- GRVT ----
export async function collectGrvt(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://market-data.grvt.io/full/v1';
  const instrumentsData = await fetchJson(`${BASE}/instruments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: ['PERPETUAL'], is_active: true, limit: 10000 }),
  });

  const instruments = (instrumentsData.result || []).filter((i: any) => i.kind === 'PERPETUAL');
  const results: UnifiedMarketData[] = [];

  await Promise.allSettled(instruments.map(async (instrument: any) => {
    try {
      const tickerData = await fetchJson(`${BASE}/ticker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument: instrument.instrument }),
      });
      const ticker = tickerData.result;
      if (!ticker) return;
      const markPrice = ticker.mark_price ? parseFloat(ticker.mark_price) : null;
      const fundingRate = ticker.funding_rate
        ? parseFloat(ticker.funding_rate) * (24 / (instrument.funding_interval_hours ?? 8)) * 365 / 100
        : 0;
      const openInterest = ticker.open_interest && markPrice ? parseFloat(ticker.open_interest) * markPrice : null;
      const volume24h = ticker.buy_volume_24h_q && ticker.sell_volume_24h_q
        ? parseFloat(ticker.buy_volume_24h_q) + parseFloat(ticker.sell_volume_24h_q)
        : null;
      const spreadBidAsk = ticker.best_ask_price && ticker.best_bid_price && ticker.last_price
        ? Math.abs(parseFloat(ticker.best_ask_price) - parseFloat(ticker.best_bid_price)) / parseFloat(ticker.last_price) * 100
        : null;
      const symTicker = instrument.instrument.split('_')[0];
      results.push({
        ticker: symTicker,
        marketPrice: markPrice,
        fundingRateAPR: fundingRate,
        openInterest,
        maxLeverage: null,
        volume24h,
        spreadBidAsk,
        marketPriceChangePercent24h: null,
        marketType: getMarketType(instrument.base || symTicker),
      });
    } catch {}
  }));
  return results;
}

// ---- Astros ----
export async function collectAstros(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://api.astros.ag';
  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    Accept: 'application/json',
  };
  const pairsData = await fetchJson(`${BASE}/api/third/info/pairs`, { headers: HEADERS });
  if (pairsData.error || pairsData.code !== 200) return [];

  const results: UnifiedMarketData[] = [];
  await Promise.allSettled((pairsData.data || []).map(async (market: any) => {
    const symbol = market.symbol;
    try {
      const [fundingRes, tickerRes, oiRes] = await Promise.allSettled([
        fetchJson(`${BASE}/api/third/v1/market/funding/current?pairName=${symbol}`, { headers: HEADERS }),
        fetchJson(`${BASE}/api/third/info/ticker/24hr?pairName=${symbol}`, { headers: HEADERS }),
        fetchJson(`${BASE}/api/third/info/oi?pairName=${symbol}`, { headers: HEADERS }),
      ]);
      const fundingRateRaw = fundingRes.status === 'fulfilled' ? fundingRes.value?.data?.fundingRate : null;
      const hourlyRate = fundingRateRaw ? parseFloat(fundingRateRaw) : 0;
      const tickerData = tickerRes.status === 'fulfilled' ? tickerRes.value?.data : null;
      const oiData = oiRes.status === 'fulfilled' ? oiRes.value?.data : null;
      const openPrice = tickerData?.open ? parseFloat(tickerData.open) : null;
      const closePrice = tickerData?.close ? parseFloat(tickerData.close) : null;
      const priceChangePercent24h = openPrice && closePrice && openPrice > 0
        ? (closePrice - openPrice) / openPrice * 100 : null;
      const openInterest = oiData && oiData.length > 0 ? parseFloat(oiData[0].amount) : null;
      results.push({
        ticker: symbol.split('-')[0],
        marketPrice: closePrice,
        fundingRateAPR: calculateFundingRatesFromHourly(hourlyRate),
        openInterest,
        maxLeverage: market.maxLever || null,
        volume24h: tickerData?.amount ? parseFloat(tickerData.amount) : null,
        spreadBidAsk: null,
        marketPriceChangePercent24h: priceChangePercent24h,
        marketType: 'crypto' as MarketType,
      });
    } catch {}
  }));
  return results;
}

// ---- StandX ----
export async function collectStandX(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://perps.standx.com';
  const symbolsData = await fetchJson(`${BASE}/api/query_symbol_info`);
  const enabledSymbols = (symbolsData || []).filter((s: any) => s.status === 'trading');

  const results: UnifiedMarketData[] = [];
  for (const symbolInfo of enabledSymbols) {
    try {
      const market = await fetchJson(`${BASE}/api/query_symbol_market?symbol=${symbolInfo.symbol}`);
      const rate1H = parseFloat(market.funding_rate);
      const midPrice = parseFloat(market.mid_price);
      const markPrice = parseFloat(market.mark_price);
      const bid = market.bid1 ? parseFloat(market.bid1) : null;
      const ask = market.ask1 ? parseFloat(market.ask1) : null;
      const spreadBidAsk = bid && ask && midPrice > 0 ? (ask - bid) / midPrice * 100 : null;
      results.push({
        ticker: market.base,
        marketPrice: markPrice,
        fundingRateAPR: rate1H * 24 * 365,
        openInterest: parseFloat(market.open_interest_notional),
        maxLeverage: parseFloat(symbolInfo.max_leverage),
        volume24h: market.volume_quote_24h,
        spreadBidAsk,
        marketPriceChangePercent24h: null,
        marketType: 'crypto' as MarketType,
      });
    } catch {}
  }
  return results;
}

// ---- Hibachi ----
export async function collectHibachi(): Promise<UnifiedMarketData[]> {
  const BASE = 'https://data-api.hibachi.xyz';
  const exchangeInfo = await fetchJson(`${BASE}/market/exchange-info`);
  const liveContracts = (exchangeInfo.futureContracts || []).filter((c: any) => c.status === 'LIVE');

  const results: UnifiedMarketData[] = [];
  await Promise.allSettled(liveContracts.map(async (contract: any) => {
    const symbol = encodeURIComponent(contract.symbol);
    try {
      const [priceData, statsData, oiData] = await Promise.allSettled([
        fetchJson(`${BASE}/market/data/prices?symbol=${symbol}`),
        fetchJson(`${BASE}/market/data/stats?symbol=${symbol}`),
        fetchJson(`${BASE}/market/data/open-interest?symbol=${symbol}`),
      ]);
      if (priceData.status !== 'fulfilled') return;
      const pd = priceData.value;
      const sd = statsData.status === 'fulfilled' ? statsData.value : null;
      const od = oiData.status === 'fulfilled' ? oiData.value : null;
      const fundingRate8H = parseFloat(pd.fundingRateEstimation?.estimatedFundingRate || '0');
      const marketPrice = parseFloat(pd.markPrice);
      const oiQty = od ? parseFloat(od.totalQuantity) : null;
      const openInterest = oiQty && marketPrice ? oiQty * marketPrice : null;
      const volume24h = sd ? parseFloat(sd.volume24h) : null;
      let marketPriceChangePercent24h = null;
      if (sd) {
        const midPrice = (parseFloat(sd.high24h) + parseFloat(sd.low24h)) / 2;
        if (midPrice > 0) marketPriceChangePercent24h = (marketPrice - midPrice) / midPrice * 100;
      }
      const bidPrice = parseFloat(pd.bidPrice);
      const askPrice = parseFloat(pd.askPrice);
      const spreadBidAsk = bidPrice && askPrice && marketPrice ? (askPrice - bidPrice) / marketPrice * 100 : null;
      const maxLeverage = parseFloat(contract.initialMarginRate) > 0 ? Math.round(1 / parseFloat(contract.initialMarginRate)) : null;
      results.push({
        ticker: contract.symbol.split('/')[0],
        marketPrice,
        fundingRateAPR: calculateFundingRatesFrom8H(fundingRate8H),
        openInterest,
        maxLeverage,
        volume24h,
        spreadBidAsk,
        marketPriceChangePercent24h,
        marketType: 'crypto' as MarketType,
      });
    } catch {}
  }));
  return results;
}
