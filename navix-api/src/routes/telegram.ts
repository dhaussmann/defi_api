import { Hono } from "hono";
import { Env } from "../types/env";

const XP_CHANNEL_ID = "-1003324953637";
export const telegramApp = new Hono<{ Bindings: Env }>();
export async function verifyLoginWidgetAuth(authData, botToken) {
  const { hash, ...data } = authData;
  const dataCheckString = Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.digest("SHA-256", encoder.encode(botToken));
  const signingKey = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", signingKey, encoder.encode(dataCheckString));
  const calculatedHash = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return calculatedHash === hash;
}
telegramApp.post("/auth/verify", async (c) => {
  try {
    const authData = await c.req.json();
    if (!authData.id || !authData.first_name || !authData.auth_date || !authData.hash) {
      return c.json({ success: false, error: "Missing required authentication fields" }, 400);
    }
    const botToken = c.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return c.json({ success: false, error: "Telegram bot not configured" }, 503);
    }
    const isValid = await verifyLoginWidgetAuth(authData, botToken);
    if (!isValid) {
      return c.json({ success: false, error: "Authentication failed" }, 401);
    }
    return c.json({
      success: true,
      user: {
        id: String(authData.id),
        firstName: authData.first_name,
        lastName: authData.last_name,
        username: authData.username,
        photoUrl: authData.photo_url,
        authDate: new Date(authData.auth_date * 1e3)
      }
    });
  } catch (error3) {
    console.error("Error verifying Telegram auth:", error3);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});
telegramApp.post("/strategies", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.telegram_chat_id || !body.symbol || !body.short_exchange || !body.long_exchange) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: telegram_chat_id, symbol, short_exchange, long_exchange"
        },
        400
      );
    }
    const countResult = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM user_strategies WHERE telegram_chat_id = ? AND is_active = 1"
    ).bind(body.telegram_chat_id).first();
    const profile3 = await c.env.DB.prepare(
      "SELECT subscription_tier, subscription_expires_at FROM profiles WHERE telegram_chat_id = ?"
    ).bind(body.telegram_chat_id).first();
    const tier = profile3?.subscription_tier ?? "free";
    const isExpired = profile3?.subscription_expires_at && new Date(profile3.subscription_expires_at) <  new Date();
    const effectiveTier = isExpired ? "free" : tier;
    const limit = effectiveTier === "free" ? 5 : 999;
    if ((countResult?.count ?? 0) >= limit) {
      return c.json(
        {
          success: false,
          error: `You have reached the limit of ${limit} alerts. Upgrade to Premium for unlimited alerts.`
        },
        429
      );
    }
    const strategy = await c.env.DB.prepare(
      `INSERT INTO user_strategies (telegram_chat_id, symbol, short_exchange, long_exchange, threshold_apr, is_active)
			VALUES (?, ?, ?, ?, ?, 1)
			RETURNING *`
    ).bind(
      body.telegram_chat_id,
      body.symbol,
      body.short_exchange,
      body.long_exchange,
      body.threshold_apr ?? 0
    ).first();
    if (!strategy) {
      return c.json({ success: false, error: "Failed to create strategy" }, 500);
    }
    return c.json(
      {
        success: true,
        data: { ...strategy, is_active: Boolean(strategy.is_active) }
      },
      201
    );
  } catch (error3) {
    console.error("Error creating strategy:", error3);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});
telegramApp.get("/strategies/:chatId", async (c) => {
  try {
    const chatId = c.req.param("chatId");
    const strategies = await c.env.DB.prepare(
      "SELECT * FROM user_strategies WHERE telegram_chat_id = ? AND is_active = 1 ORDER BY created_at DESC"
    ).bind(chatId).all();
    const enriched = await Promise.all(
      strategies.results.map(async (strategy) => {
        let currentApr;
        try {
          const shortData = await c.env.MARKET_KV.get(
            strategy.short_exchange,
            "json"
          );
          const longData = await c.env.MARKET_KV.get(
            strategy.long_exchange,
            "json"
          );
          const shortRate = shortData?.find(
            (m) => m.ticker.toUpperCase() === strategy.symbol.toUpperCase()
          )?.fundingRateAPR;
          const longRate = longData?.find(
            (m) => m.ticker.toUpperCase() === strategy.symbol.toUpperCase()
          )?.fundingRateAPR;
          if (shortRate !== void 0 && longRate !== void 0) {
            currentApr = shortRate - longRate;
          }
        } catch {
        }
        return {
          ...strategy,
          is_active: Boolean(strategy.is_active),
          current_apr: currentApr
        };
      })
    );
    return c.json({ success: true, data: enriched, count: enriched.length });
  } catch (error3) {
    console.error("Error fetching strategies:", error3);
    return c.json({ success: false, error: "Failed to fetch strategies" }, 500);
  }
});
telegramApp.get("/strategies/:chatId/status", async (c) => {
  const chatId = c.req.param("chatId");
  try {
    const strategies = await c.env.DB.prepare(
      "SELECT * FROM user_strategies WHERE telegram_chat_id = ? AND is_active = 1"
    ).bind(chatId).all();
    const enriched = await Promise.all(
      strategies.results.map(async (strategy) => {
        let currentApr;
        try {
          const shortData = await c.env.MARKET_KV.get(
            strategy.short_exchange,
            "json"
          );
          const longData = await c.env.MARKET_KV.get(
            strategy.long_exchange,
            "json"
          );
          const shortRate = shortData?.find(
            (m) => m.ticker.toUpperCase() === strategy.symbol.toUpperCase()
          )?.fundingRateAPR;
          const longRate = longData?.find(
            (m) => m.ticker.toUpperCase() === strategy.symbol.toUpperCase()
          )?.fundingRateAPR;
          if (shortRate !== void 0 && longRate !== void 0) {
            currentApr = shortRate - longRate;
          }
        } catch {
        }
        return {
          ...strategy,
          is_active: Boolean(strategy.is_active),
          current_apr: currentApr
        };
      })
    );
    return c.json({ success: true, data: enriched, count: enriched.length });
  } catch (error3) {
    console.error("Error fetching strategy status:", error3);
    return c.json({ success: false, error: "Failed to fetch strategy status" }, 500);
  }
});
telegramApp.patch("/strategies/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const updates = [];
    const values = [];
    if (body.threshold_apr !== void 0) {
      updates.push("threshold_apr = ?");
      values.push(body.threshold_apr);
    }
    if (body.is_active !== void 0) {
      updates.push("is_active = ?");
      values.push(body.is_active ? 1 : 0);
    }
    if (updates.length === 0) {
      return c.json({ success: false, error: "No fields to update" }, 400);
    }
    values.push(id);
    const result = await c.env.DB.prepare(
      `UPDATE user_strategies SET ${updates.join(", ")} WHERE id = ? RETURNING *`
    ).bind(...values).first();
    if (!result) {
      return c.json({ success: false, error: "Strategy not found or update failed" }, 404);
    }
    return c.json({
      success: true,
      data: { ...result, is_active: Boolean(result.is_active) }
    });
  } catch (error3) {
    console.error("Error updating strategy:", error3);
    return c.json({ success: false, error: "Failed to update strategy" }, 500);
  }
});
telegramApp.delete("/strategies/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      "UPDATE user_strategies SET is_active = 0 WHERE id = ? AND is_active = 1"
    ).bind(id).run();
    if (result.meta.changes === 0) {
      return c.json({ success: false, error: "Strategy not found or already deleted" }, 404);
    }
    return c.json({ success: true, message: "Strategy deleted successfully" });
  } catch (error3) {
    console.error("Error deleting strategy:", error3);
    return c.json({ success: false, error: "Failed to delete strategy" }, 500);
  }
});
telegramApp.get("/bot-info", async (c) => {
  try {
    const botToken = c.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return c.json({ success: false, error: "Telegram bot not configured" }, 503);
    }
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const data = await response.json();
    if (!data.ok) {
      return c.json({ success: false, error: "Failed to retrieve bot information" }, 500);
    }
    return c.json({ success: true, data: data.result });
  } catch (error3) {
    console.error("Error getting bot info:", error3);
    return c.json({ success: false, error: "Failed to get bot information" }, 500);
  }
});
telegramApp.get("/validate-chat/:id", async (c) => {
  try {
    const chatId = c.req.param("id");
    const botToken = c.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return c.json({ success: false, error: "Telegram bot not configured" }, 503);
    }
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendChatAction?chat_id=${chatId}&action=typing`
    );
    const data = await response.json();
    return c.json({ success: true, data: { valid: data.ok } });
  } catch (error3) {
    console.error("Error validating chat ID:", error3);
    return c.json({ success: false, error: "Failed to validate chat ID" }, 500);
  }
});
telegramApp.post("/test-notification", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.strategy_id) {
      return c.json({ success: false, error: "Missing required field: strategy_id" }, 400);
    }
    const strategy = await c.env.DB.prepare("SELECT * FROM user_strategies WHERE id = ?").bind(body.strategy_id).first();
    if (!strategy) {
      return c.json({ success: false, error: "Strategy not found" }, 404);
    }
    const botToken = c.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return c.json({ success: false, error: "Telegram bot not configured" }, 503);
    }
    const message = `Test notification for ${strategy.symbol} (${strategy.short_exchange}/${strategy.long_exchange})`;
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: strategy.telegram_chat_id,
        text: message,
        parse_mode: "HTML"
      })
    });
    const result = await response.json();
    return c.json({
      success: true,
      data: { sent: result.ok },
      message: result.ok ? "Test notification sent successfully" : "Test notification not sent"
    });
  } catch (error3) {
    console.error("Error sending test notification:", error3);
    return c.json({ success: false, error: "Failed to send test notification" }, 500);
  }
});
telegramApp.get("/check-strategies", async (c) => {
  try {
    const strategies = await c.env.DB.prepare(
      "SELECT * FROM user_strategies WHERE is_active = 1"
    ).all();
    const botToken = c.env.TELEGRAM_BOT_TOKEN;
    let checked = 0;
    let notified = 0;
    let errors = 0;
    for (const strategy of strategies.results) {
      checked++;
      try {
        const recentNotif = await c.env.DB.prepare(
          "SELECT id FROM sent_notifications WHERE strategy_id = ? AND sent_at > datetime('now', '-4 hours')"
        ).bind(strategy.id).first();
        if (recentNotif) continue;
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
        if (currentApr < strategy.threshold_apr && botToken) {
          const text = `<b>Alert: ${strategy.symbol}</b>
${strategy.short_exchange}/${strategy.long_exchange}: ${(currentApr * 100).toFixed(2)}% APR
Threshold: ${(strategy.threshold_apr * 100).toFixed(2)}%`;
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: strategy.telegram_chat_id,
              text,
              parse_mode: "HTML"
            })
          });
          await c.env.DB.prepare(
            "INSERT INTO sent_notifications (strategy_id, apr_value) VALUES (?, ?)"
          ).bind(strategy.id, currentApr).run();
          notified++;
        }
      } catch (err) {
        errors++;
        console.error(`Error checking strategy ${strategy.id}:`, err);
      }
    }
    return c.json({
      success: true,
      data: { checked, notified, errors },
      message: `Checked ${checked}, notified ${notified}, errors ${errors}`
    });
  } catch (error3) {
    console.error("Error in strategy check:", error3);
    return c.json({ success: false, error: "Strategy check failed" }, 500);
  }
});
telegramApp.post("/xp-request", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.telegram_username || !body.xp_amount || body.price === void 0 || !body.action) {
      return c.json(
        {
          success: false,
          error: "Missing required fields: telegram_username, xp_amount, price, action"
        },
        400
      );
    }
    if (body.action !== "sell" && body.action !== "buy") {
      return c.json({ success: false, error: "Invalid action. Must be 'sell' or 'buy'" }, 400);
    }
    const totalValue = body.xp_amount * body.price;
    const record = await c.env.DB.prepare(
      `INSERT INTO xp_requests (telegram_username, xp_amount, price, action, total_value)
			VALUES (?, ?, ?, ?, ?)
			RETURNING *`
    ).bind(body.telegram_username, body.xp_amount, body.price, body.action, totalValue).first();
    const botToken = c.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      const emoji = body.action === "sell" ? "\u{1F534}" : "\u{1F7E2}";
      const message = `${emoji} <b>New XP ${body.action.toUpperCase()} Request</b>

User: @${body.telegram_username}
Amount: ${body.xp_amount.toLocaleString()} XP
Price: $${body.price}
Total: $${totalValue.toFixed(2)}`;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: XP_CHANNEL_ID,
          text: message,
          parse_mode: "HTML"
        })
      });
    }
    return c.json({
      success: true,
      data: { sent: true, record },
      message: "Your request has been submitted."
    });
  } catch (error3) {
    console.error("Error processing XP request:", error3);
    return c.json({ success: false, error: "Failed to process request" }, 500);
  }
});
