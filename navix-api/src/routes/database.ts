import { Hono } from "hono";
import { Env } from "../types/env";
import { UnifiedMarketData } from "../types/marketTypes";

export const databaseApp = new Hono<{ Bindings: Env }>();
databaseApp.get("/health", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({
      success: true,
      message: "Database connection is healthy",
      databases: { d1: true }
    });
  } catch {
    return c.json(
      {
        success: false,
        error: "Database connection failed",
        databases: { d1: false }
      },
      503
    );
  }
});
databaseApp.get("/:exchange/market-data", async (c) => {
  try {
    const exchange = c.req.param("exchange");
    const tickersParam = c.req.query("tickers");
    const periodParam = c.req.query("period");
    const tickers = tickersParam ? tickersParam.split(",").map((t) => t.trim()) : [];
    const period = periodParam ? Math.min(Math.max(Number(periodParam), 1), 90) : 7;
    const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) {
      return c.json(
        { success: false, error: "Analytics Engine not configured" },
        500
      );
    }
    const tickerFilter = tickers.length > 0 ? `AND blob2 IN (${tickers.map((t) => `'${t.toUpperCase()}'`).join(",")})` : "";
    const sql = `
			SELECT
				blob1 AS exchange,
				blob2 AS ticker,
				double1 AS funding_rate_apr,
				double2 AS open_interest,
				double3 AS volume_24h,
				double4 AS market_price,
				timestamp
			FROM FUNDING_RATES
			WHERE blob1 = '${exchange}'
				${tickerFilter}
				AND timestamp >= NOW() - INTERVAL '${period}' DAY
			ORDER BY timestamp ASC
		`;
    const aeToken = c.env.ANALYTICS_ENGINE_API_TOKEN;
    if (!aeToken) {
      return c.json(
        { success: false, error: "Analytics Engine API token not configured" },
        500
      );
    }
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: `Bearer ${aeToken}`
        },
        body: sql
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Analytics Engine query error:", errorText);
      return c.json(
        {
          success: false,
          data: { exchange, supabaseTickerMarketDataHistory: [] },
          error: "Failed to fetch historical data"
        },
        500
      );
    }
    const result = await response.json();
    const byTicker =  new Map();
    for (const row of result.data ?? []) {
      const existing = byTicker.get(row.ticker) ?? [];
      existing.push(row);
      byTicker.set(row.ticker, existing);
    }
    const tickerHistories = Array.from(byTicker.entries()).map(
      ([ticker, data]) => {
        const avgFundingRatesAPR = data.reduce((sum, d) => sum + d.funding_rate_apr, 0) / data.length;
        return {
          ticker,
          supabaseMarketData: data,
          avgFundingRatesAPR
        };
      }
    );
    return c.json({
      success: true,
      data: {
        exchange,
        supabaseTickerMarketDataHistory: tickerHistories
      }
    });
  } catch (error3) {
    console.error("Error fetching market data:", error3);
    return c.json(
      {
        success: false,
        data: {
          exchange: c.req.param("exchange"),
          supabaseTickerMarketDataHistory: []
        },
        error: "Failed to fetch market data from database"
      },
      500
    );
  }
});
databaseApp.get("/:exchange/market-data/latest", async (c) => {
  try {
    const exchange = c.req.param("exchange");
    const tickersParam = c.req.query("tickers");
    const tickers = tickersParam ? tickersParam.split(",").map((t) => t.trim().toUpperCase()) : [];
    const data = await c.env.MARKET_KV.get(exchange, "json");
    if (!data) {
      return c.json({ success: true, data: [], count: 0 });
    }
    const filtered = tickers.length > 0 ? data.filter((m) => tickers.includes(m.ticker.toUpperCase())) : data;
    const transformed = filtered.map((m) => ({
      exchange,
      ticker: m.ticker,
      funding_rate_apr: m.fundingRateAPR,
      open_interest: m.openInterest,
      volume_24h: m.volume24h,
      market_price: m.marketPrice,
      market_price_change_percent_24h: m.marketPriceChangePercent24h,
      spread_bid_ask: m.spreadBidAsk,
      max_leverage: m.maxLeverage,
      market_type: m.marketType,
      timestamp: ( new Date()).toISOString()
    }));
    return c.json({
      success: true,
      data: transformed,
      count: transformed.length
    });
  } catch (error3) {
    console.error("Error fetching latest market data:", error3);
    return c.json(
      { success: false, data: [], error: "Failed to fetch latest market data" },
      500
    );
  }
});
databaseApp.get("/best-strategies", async (c) => {
  try {
    const countParam = c.req.query("count");
    const exchangeNamesParam = c.req.query("exchangeNames");
    const periodParam = c.req.query("period");
    const minVolume24hParam = c.req.query("minVolume24h");
    const minOpenInterestParam = c.req.query("minOpenInterest");
    const spotMode = c.req.query("spotMode") === "true";
    const marketTypesParam = c.req.query("marketTypes");
    if (!countParam || !exchangeNamesParam || !periodParam) {
      return c.json(
        {
          success: false,
          error: "Missing required params: count, exchangeNames, period"
        },
        400
      );
    }
    const count3 = Math.min(Number(countParam), 1e4);
    const exchangeNames = exchangeNamesParam.split(",").map((e) => e.trim());
    const minVolume24h = minVolume24hParam ? Number(minVolume24hParam) : 0;
    const minOpenInterest = minOpenInterestParam ? Number(minOpenInterestParam) : 0;
    const marketTypes = marketTypesParam ? marketTypesParam.split(",").map((t) => t.trim()) : void 0;
    const minExchanges = spotMode ? 1 : 2;
    if (exchangeNames.length < minExchanges) {
      return c.json(
        {
          success: false,
          data: [],
          error: `exchangeNames must contain at least ${minExchanges} exchange(s)`
        },
        400
      );
    }
    const exchangeData =  new Map();
    await Promise.all(
      exchangeNames.map(async (name) => {
        const data = await c.env.MARKET_KV.get(name, "json");
        if (data) {
          exchangeData.set(
            name,
            data
          );
        }
      })
    );
    if (spotMode) {
      const strategies2 = [];
      for (const [exchange, markets] of exchangeData) {
        for (const market of markets) {
          if (market.fundingRateAPR <= 0) continue;
          if (minVolume24h && (market.volume24h ?? 0) < minVolume24h) continue;
          if (minOpenInterest && (market.openInterest ?? 0) < minOpenInterest)
            continue;
          if (marketTypes && !marketTypes.includes(market.marketType)) continue;
          strategies2.push({
            ticker: market.ticker,
            avgFundingRateAPRDiff: market.fundingRateAPR,
            shortExchangeData: {
              exchange,
              ticker: market.ticker,
              funding_rate_apr: market.fundingRateAPR,
              open_interest: market.openInterest,
              volume_24h: market.volume24h,
              market_price: market.marketPrice,
              market_type: market.marketType
            }
          });
        }
      }
      strategies2.sort(
        (a, b) => b.avgFundingRateAPRDiff - a.avgFundingRateAPRDiff
      );
      return c.json({
        success: true,
        data: strategies2.slice(0, count3),
        count: Math.min(strategies2.length, count3)
      });
    }
    const tickerRates =  new Map();
    for (const [exchange, markets] of exchangeData) {
      for (const market of markets) {
        if (minVolume24h && (market.volume24h ?? 0) < minVolume24h) continue;
        if (minOpenInterest && (market.openInterest ?? 0) < minOpenInterest)
          continue;
        if (marketTypes && !marketTypes.includes(market.marketType)) continue;
        const existing = tickerRates.get(market.ticker.toUpperCase()) ?? [];
        existing.push({
          exchange,
          rate: market.fundingRateAPR,
          openInterest: market.openInterest,
          volume24h: market.volume24h,
          marketPrice: market.marketPrice,
          marketType: market.marketType
        });
        tickerRates.set(market.ticker.toUpperCase(), existing);
      }
    }
    const strategies = [];
    for (const [ticker, rates] of tickerRates) {
      if (rates.length < 2) continue;
      const sorted = [...rates].sort((a, b) => b.rate - a.rate);
      const short = sorted[0];
      const long = sorted[sorted.length - 1];
      if (short.exchange === long.exchange) continue;
      const diff = short.rate - long.rate;
      if (diff <= 0) continue;
      strategies.push({
        ticker,
        avgFundingRateAPRDiff: diff,
        shortExchangeData: {
          exchange: short.exchange,
          ticker,
          funding_rate_apr: short.rate,
          open_interest: short.openInterest,
          volume_24h: short.volume24h,
          market_price: short.marketPrice,
          market_type: short.marketType
        },
        longExchangeData: {
          exchange: long.exchange,
          ticker,
          funding_rate_apr: long.rate,
          open_interest: long.openInterest,
          volume_24h: long.volume24h,
          market_price: long.marketPrice,
          market_type: long.marketType
        }
      });
    }
    strategies.sort(
      (a, b) => b.avgFundingRateAPRDiff - a.avgFundingRateAPRDiff
    );
    return c.json({
      success: true,
      data: strategies.slice(0, count3),
      count: Math.min(strategies.length, count3)
    });
  } catch (error3) {
    console.error("Error fetching best strategies:", error3);
    return c.json(
      { success: false, data: [], error: "Failed to fetch best strategies" },
      500
    );
  }
});
databaseApp.get("/strategy", async (c) => {
  try {
    const longExchange = c.req.query("longExchange");
    const shortExchange = c.req.query("shortExchange");
    const ticker = c.req.query("ticker");
    const periodParam = c.req.query("period");
    if (!longExchange || !shortExchange || !ticker) {
      return c.json(
        {
          success: false,
          error: "Missing required params: longExchange, shortExchange, ticker"
        },
        400
      );
    }
    const period = periodParam ? Math.min(Math.max(Number(periodParam), 1), 90) : 7;
    const shortData = await c.env.MARKET_KV.get(
      shortExchange,
      "json"
    );
    const longData = await c.env.MARKET_KV.get(
      longExchange,
      "json"
    );
    const shortMarket = shortData?.find(
      (m) => m.ticker.toUpperCase() === ticker.toUpperCase()
    );
    const longMarket = longData?.find(
      (m) => m.ticker.toUpperCase() === ticker.toUpperCase()
    );
    if (!shortMarket) {
      return c.json(
        {
          success: false,
          data: null,
          error: `Ticker ${ticker} not found on ${shortExchange}`
        },
        404
      );
    }
    const accountId = c.env.CLOUDFLARE_ACCOUNT_ID;
    let fundingRateAPRDiffHistory = [];
    const aeToken = c.env.ANALYTICS_ENGINE_API_TOKEN;
    if (accountId && aeToken) {
      try {
        const sql = `
					SELECT blob1 AS exchange, blob2 AS ticker, double1 AS funding_rate_apr, timestamp
					FROM FUNDING_RATES
					WHERE blob2 = '${ticker.toUpperCase()}'
						AND (blob1 = '${shortExchange}' OR blob1 = '${longExchange}')
						AND timestamp >= NOW() - INTERVAL '${period}' DAY
					ORDER BY timestamp ASC
				`;
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
          {
            method: "POST",
            headers: {
              "Content-Type": "text/plain",
              Authorization: `Bearer ${aeToken}`
            },
            body: sql
          }
        );
        if (response.ok) {
          const result = await response.json();
          const byTimestamp =  new Map();
          for (const row of result.data ?? []) {
            const ts = row.timestamp;
            const existing = byTimestamp.get(ts) ?? {};
            if (row.exchange === shortExchange)
              existing.short = row.funding_rate_apr;
            if (row.exchange === longExchange)
              existing.long = row.funding_rate_apr;
            byTimestamp.set(ts, existing);
          }
          fundingRateAPRDiffHistory = Array.from(byTimestamp.entries()).filter(([, v]) => v.short !== void 0 && v.long !== void 0).map(([timestamp, v]) => ({
            timestamp,
            fundingRateAPRDiff: (v.short ?? 0) - (v.long ?? 0)
          }));
        }
      } catch (err) {
        console.error("Error fetching AE history:", err);
      }
    }
    const avgDiff = fundingRateAPRDiffHistory.length > 0 ? fundingRateAPRDiffHistory.reduce(
      (s, d) => s + d.fundingRateAPRDiff,
      0
    ) / fundingRateAPRDiffHistory.length : shortMarket.fundingRateAPR - (longMarket?.fundingRateAPR ?? 0);
    return c.json({
      success: true,
      data: {
        ticker,
        avgFundingRateAPRDiff: avgDiff,
        fundingRateAPRDiffHistory,
        shortExchangeData: {
          exchange: shortExchange,
          ticker,
          funding_rate_apr: shortMarket.fundingRateAPR,
          open_interest: shortMarket.openInterest,
          volume_24h: shortMarket.volume24h,
          market_price: shortMarket.marketPrice,
          market_type: shortMarket.marketType,
          timestamp: ( new Date()).toISOString()
        },
        longExchangeData: longMarket ? {
          exchange: longExchange,
          ticker,
          funding_rate_apr: longMarket.fundingRateAPR,
          open_interest: longMarket.openInterest,
          volume_24h: longMarket.volume24h,
          market_price: longMarket.marketPrice,
          market_type: longMarket.marketType,
          timestamp: ( new Date()).toISOString()
        } : void 0
      }
    });
  } catch (error3) {
    console.error("Error fetching strategy:", error3);
    return c.json(
      { success: false, data: null, error: "Failed to fetch strategy" },
      500
    );
  }
});
