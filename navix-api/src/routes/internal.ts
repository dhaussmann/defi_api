import { Hono } from "hono";
import { Env } from "../types/env";
import { requireInternalApiKey } from "../middleware/auth";
import { EXCHANGES } from "../config/exchanges";
import { EXCHANGE_FEES, bpsToPercent } from "../config/exchangeFees";

export const internalApp = new Hono<{ Bindings: Env }>();
internalApp.use("*", requireInternalApiKey());
const MAX_BATCH_SIZE = 50;
const INTERNAL_CONCURRENCY = 3;
const SUPPORTED_EXECUTION_COST_EXCHANGES = EXCHANGES.filter(
  (e) => EXCHANGE_FEES[e.key]
).map((e) => e.key);
async function processConcurrently(tasks, concurrency) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const currentIndex = index++;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
internalApp.post("/execution-cost/batch", async (c) => {
  const body = await c.req.json();
  if (!body?.requests || !Array.isArray(body.requests)) {
    return c.json(
      { success: false, error: "Missing or invalid 'requests' array" },
      400
    );
  }
  if (body.requests.length > MAX_BATCH_SIZE) {
    return c.json(
      {
        success: false,
        error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}`
      },
      400
    );
  }
  const tasks = body.requests.map(
    (item) => async () => {
      if (!item.exchange || !item.ticker || !Array.isArray(item.tradeSizes)) {
        return {
          result: null,
          error: {
            exchange: item.exchange ?? "unknown",
            ticker: item.ticker ?? "unknown",
            error: "Invalid request item"
          }
        };
      }
      if (!SUPPORTED_EXECUTION_COST_EXCHANGES.includes(item.exchange)) {
        return {
          result: null,
          error: {
            exchange: item.exchange,
            ticker: item.ticker,
            error: `Exchange not supported: ${item.exchange}`
          }
        };
      }
      try {
        const exchange = EXCHANGES.find((e) => e.key === item.exchange);
        if (!exchange) {
          return {
            result: null,
            error: {
              exchange: item.exchange,
              ticker: item.ticker,
              error: "Exchange not found"
            }
          };
        }
        const fees = EXCHANGE_FEES[item.exchange];
        const takerFeePct = fees ? bpsToPercent(fees.takerFeeBps) : 0.06;
        const sizes = {};
        for (const size of item.tradeSizes) {
          sizes[size] = {
            buyTotalCostPct: takerFeePct,
            sellTotalCostPct: takerFeePct,
            buySlippagePct: 0,
            sellSlippagePct: 0
          };
        }
        return {
          result: {
            exchange: item.exchange,
            ticker: item.ticker.toUpperCase(),
            sizes
          },
          error: null
        };
      } catch (err) {
        return {
          result: null,
          error: {
            exchange: item.exchange,
            ticker: item.ticker,
            error: err instanceof Error ? err.message : String(err)
          }
        };
      }
    }
  );
  const settled = await processConcurrently(tasks, INTERNAL_CONCURRENCY);
  const results = settled.map((s) => s.result);
  const errors = settled.map((s) => s.error);
  const successCount = results.filter(Boolean).length;
  const errorCount = errors.filter(Boolean).length;
  return c.json({
    success: true,
    data: { results, errors, successCount, errorCount }
  });
});
internalApp.get("/execution-cost/supported", (c) => {
  return c.json({ success: true, data: SUPPORTED_EXECUTION_COST_EXCHANGES });
});
