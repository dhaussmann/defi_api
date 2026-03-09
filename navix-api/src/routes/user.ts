import { Hono } from "hono";
import { Env } from "../types/env";

export const userApp = new Hono<{ Bindings: Env }>();
userApp.get("/config/:chatId", async (c) => {
  try {
    const chatId = c.req.param("chatId");
    if (!chatId) {
      return c.json({ success: false, error: "Missing chat ID parameter" }, 400);
    }
    const results = await c.env.DB.prepare(
      "SELECT * FROM user_config WHERE telegram_chat_id = ?"
    ).bind(chatId).all();
    const data = results.results.map((row) => ({
      ...row,
      enabled_exchanges: typeof row.enabled_exchanges === "string" ? JSON.parse(row.enabled_exchanges) : row.enabled_exchanges,
      spot_strategies_enabled: Boolean(row.spot_strategies_enabled)
    }));
    return c.json({ success: true, data });
  } catch (error3) {
    console.error("Error retrieving user configuration:", error3);
    return c.json({ success: false, error: "Failed to retrieve user configuration" }, 500);
  }
});
userApp.post("/config", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.telegram_chat_id) {
      return c.json(
        { success: false, error: "Missing required field: telegram_chat_id" },
        400
      );
    }
    const now = ( new Date()).toISOString();
    const enabledExchanges = JSON.stringify(body.enabled_exchanges ?? []);
    const spotEnabled = body.spot_strategies_enabled ? 1 : 0;
    if (body.id) {
      const result2 = await c.env.DB.prepare(
        `UPDATE user_config SET
					name = ?, enabled_exchanges = ?, spot_strategies_enabled = ?,
					min_open_interest = ?, max_open_interest = ?,
					min_volume_24h = ?, max_volume_24h = ?, updated_at = ?
				WHERE id = ?
				RETURNING *`
      ).bind(
        body.name ?? null,
        enabledExchanges,
        spotEnabled,
        body.min_open_interest ?? 0,
        body.max_open_interest ?? null,
        body.min_volume_24h ?? 0,
        body.max_volume_24h ?? null,
        now,
        body.id
      ).first();
      if (!result2) {
        return c.json({ success: false, error: "Config not found" }, 404);
      }
      return c.json({
        success: true,
        data: {
          ...result2,
          enabled_exchanges: typeof result2.enabled_exchanges === "string" ? JSON.parse(result2.enabled_exchanges) : result2.enabled_exchanges,
          spot_strategies_enabled: Boolean(result2.spot_strategies_enabled)
        },
        message: "User configuration updated successfully"
      });
    }
    const result = await c.env.DB.prepare(
      `INSERT INTO user_config (
				name, telegram_chat_id, enabled_exchanges, spot_strategies_enabled,
				min_open_interest, max_open_interest, min_volume_24h, max_volume_24h,
				created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			RETURNING *`
    ).bind(
      body.name ?? null,
      body.telegram_chat_id,
      enabledExchanges,
      spotEnabled,
      body.min_open_interest ?? 0,
      body.max_open_interest ?? null,
      body.min_volume_24h ?? 0,
      body.max_volume_24h ?? null,
      now,
      now
    ).first();
    return c.json(
      {
        success: true,
        data: result ? {
          ...result,
          enabled_exchanges: typeof result.enabled_exchanges === "string" ? JSON.parse(result.enabled_exchanges) : result.enabled_exchanges,
          spot_strategies_enabled: Boolean(result.spot_strategies_enabled)
        } : null,
        message: "User configuration created successfully"
      },
      201
    );
  } catch (error3) {
    console.error("Error saving user configuration:", error3);
    return c.json({ success: false, error: "Failed to save user configuration" }, 500);
  }
});
userApp.delete("/config/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ success: false, error: "Missing config ID parameter" }, 400);
    }
    const existing = await c.env.DB.prepare("SELECT id FROM user_config WHERE id = ?").bind(id).first();
    if (!existing) {
      return c.json({ success: false, error: "User configuration not found" }, 404);
    }
    await c.env.DB.prepare("DELETE FROM user_config WHERE id = ?").bind(id).run();
    return c.json({
      success: true,
      data: null,
      message: "User configuration deleted successfully"
    });
  } catch (error3) {
    console.error("Error deleting user configuration:", error3);
    return c.json({ success: false, error: "Failed to delete user configuration" }, 500);
  }
});
