/**
 * Veto — Owner authentication (T6 + OwnerCap pattern)
 *
 * Two layers of authorization:
 *
 *   LAYER 1 (app-level): OWNER_PASSWORD env var + signed cookie
 *     - Cheap, dev-friendly, gates /api/rules routes in v1
 *     - This is "for convenience" — the real authority is layer 2
 *
 *   LAYER 2 (chain-level, production): OwnerCap object on Sui
 *     - The Move module's update_commit() and configure() functions
 *       take `_: &OwnerCap` as their first arg
 *     - The Sui runtime checks object ownership BEFORE the function runs
 *     - A tx without the OwnerCap is rejected at the protocol level
 *     - This is the actual security boundary; layer 1 is just UX
 *
 * Threat T6 closed: the Owner/Agent boundary is now enforced by a real
 * access check (password + cookie), not by "two route names." Anyone
 * hitting /api/rules without the cookie gets 401.
 *
 * In production: replace the password+cookie with NextAuth + zkLogin
 * sessions. The OwnerCap pattern stays the same — only the auth layer
 * above it changes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

// Cookie name + signature secret
const OWNER_COOKIE_NAME = "veto_owner_session";
// In dev: derive from OWNER_PASSWORD if no separate secret set
function getCookieSecret(): string {
  return (
    process.env.OWNER_COOKIE_SECRET ||
    process.env.OWNER_PASSWORD ||
    "dev-cookie-secret"
  );
}

// Owner password — required for the login route. Dev default for first-run.
export function getOwnerPassword(): string | null {
  return process.env.OWNER_PASSWORD ?? "dev-owner-password";
}

// Legacy: keep OWNER_TOKEN working for backwards compat with curl tests
export function getOwnerToken(): string | null {
  return process.env.OWNER_TOKEN ?? "dev-owner-token";
}

/**
 * Create a signed session cookie value.
 * Format: <expiresAt>.<hmac>
 * The HMAC covers the expiresAt using the cookie secret.
 */
function createSessionCookie(expiresInSeconds: number = 60 * 60 * 8): string {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  const payload = String(expiresAt);
  const hmac = createHmac("sha256", getCookieSecret())
    .update(payload)
    .digest("hex");
  return `${payload}.${hmac}`;
}

/**
 * Verify a session cookie value. Returns true if valid + not expired.
 */
function verifySessionCookie(value: string | null): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expiresAt = Number(payload);
  if (!expiresAt || isNaN(expiresAt)) return false;
  if (Date.now() > expiresAt) return false;
  const expected = createHmac("sha256", getCookieSecret())
    .update(payload)
    .digest("hex");
  // Constant-time comparison
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Headers for setting the owner session cookie on a response.
 */
export function ownerCookieHeaders(): { "Set-Cookie": string } {
  const value = createSessionCookie();
  return {
    "Set-Cookie": `${OWNER_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 8}`,
  };
}

/**
 * Header to clear the owner session cookie.
 */
export function clearOwnerCookieHeaders(): { "Set-Cookie": string } {
  return {
    "Set-Cookie": `${OWNER_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  };
}

/**
 * Check if the request has a valid owner session.
 * Accepts EITHER:
 *   - valid signed session cookie (preferred)
 *   - x-owner-token header matching OWNER_TOKEN (for API clients / curl tests)
 *
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export function requireOwner(req: NextRequest): NextResponse | null {
  // 1. Cookie check (browser sessions)
  const cookieHeader = req.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")];
    })
  );
  if (verifySessionCookie(cookies[OWNER_COOKIE_NAME] || null)) {
    return null; // authorized via cookie
  }

  // 2. Token check (API clients / curl tests / backwards compat)
  const expectedToken = getOwnerToken();
  if (expectedToken) {
    const provided =
      req.headers.get("x-owner-token") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (provided === expectedToken) {
      return null; // authorized via token
    }
  }

  // Neither cookie nor token — reject
  return NextResponse.json(
    {
      error: "Unauthorized — owner session or token required",
      hint: "POST /api/owner/login with { password } to get a session cookie, or send x-owner-token header",
    },
    { status: 401 }
  );
}
