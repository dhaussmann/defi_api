import { Hono } from "hono";
import { Env } from "../types/env";

export const healthApp = new Hono<{ Bindings: Env }>();
healthApp.get(
  "/",
  (c) => c.json({ status: "OK", timestamp: ( new Date()).toISOString() })
);
healthApp.get("/full", async (c) => {
  const checks = {};
  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.d1 = true;
  } catch {
    checks.d1 = false;
  }
  try {
    await c.env.MARKET_KV.get("__health__");
    checks.kv = true;
  } catch {
    checks.kv = false;
  }
  const allHealthy = Object.values(checks).every(Boolean);
  return c.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      dependencies: checks,
      timestamp: ( new Date()).toISOString()
    },
    allHealthy ? 200 : 503
  );
});
