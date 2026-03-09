import { Hono } from "hono";
import { Env } from "../types/env";
import { EXCHANGES } from "../config/exchanges";
import { serviceFactory } from "../services/exchanges/ServiceFactory";

export const exchangesApp = new Hono<{ Bindings: Env }>();
exchangesApp.get(
  "/exchanges",
  (c) => c.json({
    success: true,
    data: EXCHANGES.map((e) => e.key),
    count: EXCHANGES.length
  })
);
EXCHANGES.forEach((exchange) => {
  exchangesApp.get(`/${exchange.key}/markets`, async (c) => {
    try {
      const service = serviceFactory.getService(exchange);
      const markets = await service.getMarkets();
      return c.json({ success: true, data: markets });
    } catch (error3) {
      console.error(`Exchange ${exchange.key} markets error:`, error3);
      return c.json(
        {
          success: false,
          data: [],
          error: `Failed to fetch markets for ${exchange.key}`
        },
        500
      );
    }
  });
});
