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

app.use("*", logger());

// ─── Rate limiting on agent endpoints ──────────────────────
app.use("/api/agent/*", rateLimitMiddleware);

// ─── Routes ────────────────────────────────────────────────
app.route("/api/agent", agentRoutes);
app.route("/api/rules", rulesRoutes);
app.route("/api/owner", ownerRoutes);
app.route("/api", miscRoutes);

// ─── Health check (used by Render) ─────────────────────────
app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    network: process.env.NETWORK || "testnet",
  })
);

// ─── Start server ──────────────────────────────────────────
const port = parseInt(process.env.PORT || "10000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║  Veto backend running on port ${info.port}     ║`);
  console.log(`  ║  Network: ${process.env.NETWORK || "testnet"}               ║`);
  console.log(`  ║  Health:  http://localhost:${info.port}/health  ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});

export default app;
