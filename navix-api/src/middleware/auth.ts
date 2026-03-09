import { Context, Next } from "hono";
import { Env } from "../types/env";

export function requireInternalApiKey() {
	return async (c: Context<{ Bindings: Env }>, next: Next) => {
		const apiKey = c.req.header("x-internal-api-key");
		const expectedKey = c.env.INTERNAL_API_KEY;

		if (!expectedKey) {
			return c.json({ success: false, error: "Internal API key not configured" }, 500);
		}

		if (!apiKey || apiKey !== expectedKey) {
			return c.json({ success: false, error: "Invalid or missing internal API key" }, 401);
		}

		await next();
	};
}
