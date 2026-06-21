/**
 * Veto — Owner authentication (Hono-compatible)
 *
 * Two layers: app-level (cookie + token) and chain-level (OwnerCap on Sui).
 * Uses Hono's cookie helpers for cross-origin cookie management.
 */

import { createHmac } from "crypto";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const OWNER_COOKIE_NAME = "veto_owner_session";

function getCookieSecret(): string {
  return process.env.OWNER_COOKIE_SECRET || process.env.OWNER_PASSWORD || "dev-cookie-secret";
}

export function getOwnerPassword(): string | null {
  return process.env.OWNER_PASSWORD ?? null;
}

export function getOwnerToken(): string | null {
  return process.env.OWNER_TOKEN ?? null;
}

function createSessionCookie(expiresInSeconds: number = 60 * 60 * 8): string {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  const payload = String(expiresAt);
  const hmac = createHmac("sha256", getCookieSecret()).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

function verifySessionCookie(value: string | null): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expiresAt = Number(payload);
  if (!expiresAt || isNaN(expiresAt)) return false;
  if (Date.now() > expiresAt) return false;
  const expected = createHmac("sha256", getCookieSecret()).update(payload).digest("hex");
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function setOwnerSessionCookie(c: Context) {
  const value = createSessionCookie();
  setCookie(c, OWNER_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "None",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export function clearOwnerSessionCookie(c: Context) {
  deleteCookie(c, OWNER_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "None",
    secure: true,
    path: "/",
  });
}

/**
 * Check if the request has a valid owner session.
 * Accepts EITHER a valid cookie OR an x-owner-token header.
 * Returns true if authorized, false if not.
 */
export function isOwnerAuthorized(c: Context): boolean {
  // 1. Cookie check
  const cookieValue = getCookie(c, OWNER_COOKIE_NAME);
  if (verifySessionCookie(cookieValue)) return true;

  // 2. Token check (for API clients / curl)
  const expectedToken = getOwnerToken();
  if (expectedToken) {
    const provided =
      c.req.header("x-owner-token") ||
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (provided === expectedToken) return true;
  }

  return false;
}
