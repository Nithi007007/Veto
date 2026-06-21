/**
 * Redis client (Upstash) for rate limiting.
 * Falls back to no-op if REDIS_URL is not set (for local dev).
 */

import Redis from "ioredis";

let _redis: Redis | null = null;
let _connected = false;

export function getRedis(): Redis | null {
  if (_redis) return _redis;

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Upstash REST API: use the REST URL + token as a regular Redis URL
  // Actually, Upstash provides a Redis-compatible URL too. Check both.
  const directUrl = process.env.REDIS_URL;

  if (directUrl) {
    _redis = new Redis(directUrl);
  } else if (redisUrl && redisToken) {
    // Upstash REST — convert to rediss:// format
    // The UPSTASH_REDIS_REST_URL is like https://xxx-xxx.upstash.io
    // We need rediss://xxx-xxx.upstash.io:6379
    const host = redisUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    _redis = new Redis(`rediss://${host}:6379`, {
      password: redisToken,
      tls: {},
    });
  } else {
    // No Redis configured — rate limiting disabled in local dev
    return null;
  }

  _redis.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
  });

  _redis.on("connect", () => {
    _connected = true;
    console.log("[Redis] Connected");
  });

  return _redis;
}

export async function rateLimitCheck(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // No Redis = no rate limiting (local dev)

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return count <= limit;
  } catch (e) {
    console.error("[Redis] Rate limit check failed, allowing request:", (e as Error).message);
    return true; // Fail open — don't block on Redis errors
  }
}
