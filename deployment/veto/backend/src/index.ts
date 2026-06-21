/**
 * Veto Backend — Hono API Server Entry Point
 *
 * Runs on Render (free tier) via @hono/node-server.
 * Exposes all /api/* routes that the frontend calls.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { agentRoutes } from "./routes/agent.js";
import { rulesRoutes } from "./routes/rules.js";
import { ownerRoutes } from "./routes/owner.js";
import { miscRoutes } from "./routes/misc.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";

const app = new Hono();

// ─── Production logging ────────────────────────────────────
// Hono's built-in logger: logs method + path + status + duration.
// In production, suppress health-check logs to avoid spamming Render logs.
app.use("*", logger((msg) => {
  const isHealthCheck = msg.includes("GET /health");
  if (process.env.NODE_ENV === "production" && isHealthCheck) return;
  console.log(`[veto] ${msg}`);
}));

// ─── CORS ──────────────────────────────────────────────────
// Cross-origin: frontend (Vercel) → backend (Render) needs
// credentials=true for cookies to work.
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim());

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return null;
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-owner-token", "Authorization"],
    credentials: true,
    maxAge: 86400,
  })
);

// ─── Rate limiting on agent endpoints ──────────────────────
app.use("/api/agent/*", rateLimitMiddleware);

// ─── Routes ────────────────────────────────────────────────
app.route("/api/agent", agentRoutes);
app.route("/api/rules", rulesRoutes);
app.route("/api/owner", ownerRoutes);
app.route("/api", miscRoutes);

// ─── Health check (used by Render) ─────────────────────────
// Render hits this endpoint every 10s. If it returns non-200,
// Render restarts the service. Keep it fast + dependency-free.
app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    network: process.env.NETWORK || "testnet",
    uptime: process.uptime(),
    env: process.env.NODE_ENV || "development",
  })
);

// ─── 404 handler ───────────────────────────────────────────
app.notFound((c) => {
  console.warn(`[veto] 404: ${c.req.method} ${c.req.path}`);
  return c.json({ error: "Not found", path: c.req.path }, 404);
});

// ─── Error handler ────────────────────────────────────────
app.onError((err, c) => {
  console.error(`[veto] ERROR on ${c.req.method} ${c.req.path}:`, err.message);
  console.error(err.stack);
  return c.json(
    {
      error: "Internal server error",
      message: process.env.NODE_ENV === "production" ? "Something went wrong" : err.message,
    },
    500
  );
});

// ─── Start server ──────────────────────────────────────────
const port = parseInt(process.env.PORT || "10000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║  Veto backend running on port ${info.port}          ║`);
  console.log(`  ║  Network: ${(process.env.NETWORK || "testnet").padEnd(38)}║`);
  console.log(`  ║  Environment: ${(process.env.NODE_ENV || "development").padEnd(33)}║`);
  console.log(`  ║  Health:  http://localhost:${info.port}/health        ║`);
  console.log(`  ╚══════════════════════════════════════════════╝\n`);
});

// ─── Graceful shutdown ─────────────────────────────────────
process.on("SIGTERM", () => {
  console.log("[veto] SIGTERM received, shutting down gracefully...");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("[veto] SIGINT received, shutting down gracefully...");
  process.exit(0);
});

export default app;
