/**
 * POST /api/owner/login
 * Body: { password: string }
 *
 * Verifies the password against OWNER_PASSWORD env var, sets a signed
 * HttpOnly session cookie if valid. Returns 401 on mismatch.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOwnerPassword, ownerCookieHeaders } from "@/lib/auth";

export const runtime = "nodejs";

const LoginSchema = z.object({
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = LoginSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Must include { password: string }" },
      { status: 400 }
    );
  }

  const expected = getOwnerPassword();
  if (!expected) {
    return NextResponse.json(
      { error: "Server misconfiguration: OWNER_PASSWORD not set" },
      { status: 500 }
    );
  }

  // Constant-time comparison
  const provided = validation.data.password;
  if (provided.length !== expected.length) {
    return NextResponse.json(
      { error: "Invalid password" },
      { status: 401 }
    );
  }
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // Set cookie + return success
  return NextResponse.json(
    { ok: true, message: "Owner session established" },
    { headers: ownerCookieHeaders() }
  );
}
