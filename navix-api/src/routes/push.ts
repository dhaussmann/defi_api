import { Hono } from "hono";
import { Env } from "../types/env";

export const pushApp = new Hono<{ Bindings: Env }>();
pushApp.post("/register", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.telegram_chat_id || !body.expo_push_token || !body.platform) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: telegram_chat_id, expo_push_token, platform"
        },
        400
      );
    }
    if (!body.expo_push_token.startsWith("ExponentPushToken[")) {
      return c.json(
        {
          success: false,
          error: "Invalid Expo push token format. Expected format: ExponentPushToken[xxx]"
        },
        400
      );
    }
    if (body.platform !== "ios" && body.platform !== "android") {
      return c.json(
        { success: false, error: "Invalid platform. Must be 'ios' or 'android'" },
        400
      );
    }
    const now = ( new Date()).toISOString();
    const existing = await c.env.DB.prepare(
      "SELECT id FROM push_tokens WHERE telegram_chat_id = ? AND expo_push_token = ?"
    ).bind(body.telegram_chat_id, body.expo_push_token).first();
    let token;
    if (existing) {
      token = await c.env.DB.prepare(
        `UPDATE push_tokens SET platform = ?, device_name = ?, is_active = 1, updated_at = ?
				WHERE id = ? RETURNING *`
      ).bind(body.platform, body.device_name ?? null, now, existing.id).first();
    } else {
      token = await c.env.DB.prepare(
        `INSERT INTO push_tokens (telegram_chat_id, expo_push_token, platform, device_name, is_active, created_at, updated_at)
				VALUES (?, ?, ?, ?, 1, ?, ?)
				RETURNING *`
      ).bind(
        body.telegram_chat_id,
        body.expo_push_token,
        body.platform,
        body.device_name ?? null,
        now,
        now
      ).first();
    }
    return c.json({
      success: true,
      data: token ? { ...token, is_active: Boolean(token.is_active) } : null,
      message: "Push token registered successfully"
    });
  } catch (error3) {
    console.error("Error registering push token:", error3);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});
pushApp.post("/unregister", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.telegram_chat_id || !body.expo_push_token) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: telegram_chat_id, expo_push_token"
        },
        400
      );
    }
    const result = await c.env.DB.prepare(
      "UPDATE push_tokens SET is_active = 0, updated_at = ? WHERE telegram_chat_id = ? AND expo_push_token = ?"
    ).bind(( new Date()).toISOString(), body.telegram_chat_id, body.expo_push_token).run();
    if (result.meta.changes === 0) {
      return c.json({ success: false, error: "Push token not found" }, 404);
    }
    return c.json({ success: true, message: "Push token unregistered successfully" });
  } catch (error3) {
    console.error("Error unregistering push token:", error3);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});
pushApp.post("/test", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.telegram_chat_id) {
      return c.json({ success: false, error: "Missing required field: telegram_chat_id" }, 400);
    }
    const tokens = await c.env.DB.prepare(
      "SELECT * FROM push_tokens WHERE telegram_chat_id = ? AND is_active = 1"
    ).bind(body.telegram_chat_id).all();
    if (tokens.results.length === 0) {
      return c.json({ success: false, error: "No push tokens registered for this user" }, 404);
    }
    const expoPushTokens = tokens.results.map((t) => t.expo_push_token);
    const expoAccessToken = c.env.EXPO_ACCESS_TOKEN;
    const messages = expoPushTokens.map((token) => ({
      to: token,
      title: "Test Notification",
      body: "This is a test notification from Too Many Cooks. Push notifications are working!",
      data: { type: "test" },
      sound: "default"
    }));
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}
      },
      body: JSON.stringify(messages)
    });
    const result = await response.json();
    const sent = result.data?.filter((r) => r.status === "ok").length ?? 0;
    const failed = result.data?.length ? result.data.length - sent : 0;
    return c.json({
      success: true,
      data: { sent, failed },
      message: `Test notification sent to ${sent} device(s)`
    });
  } catch (error3) {
    console.error("Error sending test notification:", error3);
    return c.json({ success: false, error: "Failed to send test notification" }, 500);
  }
});
pushApp.get("/check-strategies", async (c) => {
  try {
    const strategies = await c.env.DB.prepare(
      "SELECT * FROM user_strategies WHERE is_active = 1"
    ).all();
    let checked = 0;
    let notified = 0;
    let skipped = 0;
    let errors = 0;
    for (const strategy of strategies.results) {
      checked++;
      try {
        const recentNotif = await c.env.DB.prepare(
          "SELECT id FROM push_sent_notifications WHERE strategy_id = ? AND sent_at > datetime('now', '-24 hours')"
        ).bind(strategy.id).first();
        if (recentNotif) {
          skipped++;
          continue;
        }
        const shortData = await c.env.MARKET_KV.get(strategy.short_exchange, "json");
        const longData = await c.env.MARKET_KV.get(strategy.long_exchange, "json");
        if (!shortData || !longData) continue;
        const shortRate = shortData.find(
          (m) => m.ticker.toUpperCase() === strategy.symbol.toUpperCase()
        )?.fundingRateAPR;
        const longRate = longData.find(
          (m) => m.ticker.toUpperCase() === strategy.symbol.toUpperCase()
        )?.fundingRateAPR;
        if (shortRate === void 0 || longRate === void 0) continue;
        const currentApr = shortRate - longRate;
        if (currentApr < strategy.threshold_apr) {
          const tokens = await c.env.DB.prepare(
            "SELECT expo_push_token FROM push_tokens WHERE telegram_chat_id = ? AND is_active = 1"
          ).bind(strategy.telegram_chat_id).all();
          if (tokens.results.length === 0) continue;
          const messages = tokens.results.map((t) => ({
            to: t.expo_push_token,
            title: `Alert: ${strategy.symbol} APR dropped`,
            body: `${strategy.symbol} ${strategy.short_exchange}/${strategy.long_exchange}: ${(currentApr * 100).toFixed(2)}% APR (threshold: ${(strategy.threshold_apr * 100).toFixed(2)}%)`,
            data: { type: "strategy_alert", strategyId: strategy.id },
            sound: "default"
          }));
          const expoAccessToken = c.env.EXPO_ACCESS_TOKEN;
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...expoAccessToken ? { Authorization: `Bearer ${expoAccessToken}` } : {}
            },
            body: JSON.stringify(messages)
          });
          await c.env.DB.prepare(
            "INSERT INTO push_sent_notifications (strategy_id, apr_value) VALUES (?, ?)"
          ).bind(strategy.id, currentApr).run();
          notified++;
        }
      } catch (err) {
        errors++;
        console.error(`Error processing strategy ${strategy.id}:`, err);
      }
    }
    return c.json({
      success: true,
      data: { checked, notified, skipped, errors },
      message: `Checked ${checked} strategies, sent ${notified}, skipped ${skipped}, ${errors} errors`
    });
  } catch (error3) {
    console.error("Error in push check:", error3);
    return c.json({ success: false, error: "Push check failed" }, 500);
  }
});
