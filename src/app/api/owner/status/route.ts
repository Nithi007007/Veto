/**
 * GET /api/owner/status
 * Returns whether the current request has a valid owner session.
 * Used by the UI to show login state.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = requireOwner(req);
  return NextResponse.json({ authenticated: auth === null });
}
