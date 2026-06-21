/**
 * POST /api/owner/logout
 * Clears the owner session cookie.
 */

import { NextResponse } from "next/server";
import { clearOwnerCookieHeaders } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { ok: true, message: "Logged out" },
    { headers: clearOwnerCookieHeaders() }
  );
}
