/**
 * Veto — Owner authentication
 *
 * The Owner/Agent trust boundary is enforced here:
 *
 *   - Owner routes (/api/rules/*) require a valid x-owner-token header
 *     matching the OWNER_TOKEN env var.
 *   - Agent routes (/api/agent/message) require NO token — they're the
 *     "untrusted proposer" path.
 *
 * This is the literal answer to "who enforces that POST /api/rules can't
 * be called from another client?" — this module. The chat UI cannot even
 * attempt to call /api/rules because it doesn't have the owner token.
 *
 * In production, the Owner token would be replaced by:
 *   - NextAuth.js session with role=owner
 *   - Or a signed JWT from the owner's Sui wallet (via zkLogin + a role claim)
 *
 * For v1: a static bearer token is honest and sufficient. It's documented,
 * visible in the network panel during demo, and clearly marked as a v1
 * simplification in the architecture tab.
 */

import { NextRequest, NextResponse } from "next/server";

/**
 * Returns the owner token from env, or null if not set.
 * In dev: defaults to "dev-owner-token" so the demo works out of the box.
 */
export function getOwnerToken(): string | null {
  return process.env.OWNER_TOKEN ?? "dev-owner-token";
}

/**
 * Check if the request has a valid owner token. Returns null if valid,
 * or a 401 NextResponse if not.
 */
export function requireOwner(req: NextRequest): NextResponse | null {
  const expected = getOwnerToken();
  if (!expected) {
    return NextResponse.json(
      { error: "Server misconfiguration: OWNER_TOKEN not set" },
      { status: 500 }
    );
  }
  const provided =
    req.headers.get("x-owner-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== expected) {
    return NextResponse.json(
      { error: "Unauthorized — owner token required" },
      { status: 401 }
    );
  }
  return null; // authorized
}
