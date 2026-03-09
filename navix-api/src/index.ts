import { Hono } from "hono";
import { cors } from "hono/cors";
import { Env } from "./types/env";

import { healthApp } from "./routes/health";
import { databaseApp } from "./routes/database";
import { telegramApp } from "./routes/telegram";
import { pushApp } from "./routes/push";
import { userApp } from "./routes/user";
import { internalApp } from "./routes/internal";
import { exchangesApp } from "./routes/exchanges";

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use("*", async (c, next) => {
	const origins = c.env.CORS_ORIGINS?.split(",") ?? ["http://localhost:3000"];

	const corsMiddleware = cors({
		origin: (origin: string) => {
			if (!origin) return "*";
			if (origins.includes("*") || origins.includes(origin)) return origin;
			if (/^https:\/\/.*-.*\.vercel\.app$/.test(origin)) return origin;
			if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
			return "";
		},
		credentials: true,
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"X-Telegram-Init-Data",
			"X-Internal-Api-Key",
		],
	});

	return corsMiddleware(c, next);
});

// Routes
app.route("/health", healthApp);
app.route("/api/db", databaseApp);
app.route("/api/telegram", telegramApp);
app.route("/api/push", pushApp);
app.route("/api/user", userApp);
app.route("/api/internal", internalApp);
app.route("/api", exchangesApp);

// Root redirect
app.get("/", (c) => c.redirect("/health"));

export default app;
