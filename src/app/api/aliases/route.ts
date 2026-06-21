/**
 * GET /api/aliases — list of known recipient aliases (for the chat UI)
 */

import { NextResponse } from "next/server";
import { ALIAS_LIST } from "@/lib/aliases";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ aliases: ALIAS_LIST });
}
