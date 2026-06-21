/**
 * Rate limiting middleware (Redis-based, 10 req/min per IP on /api/agent/*)
 */

import type { Context, Next } from "hono";
import { rateLimitCheck } from "../lib/redis.js";

const RATE_LIMIT = 10; // requests
const RATE_WINDOW = 60; // seconds

export async function rateLimitMiddleware(c: Context, next: Next) {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const key = `ratelimit:agent:${ip}`;

  const allowed = await rateLimitCheck(key, RATE_LIMIT, RATE_WINDOW);

  if (!allowed) {
    return c.json(
      {
        error: "Rate limit exceeded",
        message: `Too many requests. Limit: ${RATE_LIMIT} per ${RATE_WINDOW}s. Try again in a minute.`,
      },
      429
    );
  }

  await next();
}
