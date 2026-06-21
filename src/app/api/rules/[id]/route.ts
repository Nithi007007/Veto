/**
 * PATCH /api/rules/:id — toggle enabled state or update config
 * DELETE /api/rules/:id — remove a rule
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).max(80).optional(),
  config: z.record(z.any()).optional(),
});

function buildConfigString(type: string, config: any): string {
  switch (type) {
    case "MAX_AMOUNT_PER_TX":
      return JSON.stringify({ maxAmountSui: Number(config.maxAmountSui) });
    case "DAILY_SPEND_CAP":
      return JSON.stringify({ capSui: Number(config.capSui) });
    case "ALLOWED_RECIPIENT":
    case "DENYLIST_ADDRESS": {
      const arr = Array.isArray(config.addresses)
        ? config.addresses.filter((a: any) => typeof a === "string" && a.trim())
        : [];
      return JSON.stringify({ addresses: arr });
    }
    default:
      return JSON.stringify(config);
  }
}

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = PatchSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid patch body", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await db.rule.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  const update: any = {};
  if (typeof validation.data.enabled === "boolean") {
    update.enabled = validation.data.enabled;
  }
  if (typeof validation.data.name === "string") {
    update.name = validation.data.name;
  }
  if (validation.data.config) {
    update.config = buildConfigString(existing.type, validation.data.config);
  }

  const updated = await db.rule.update({ where: { id }, data: update });
  return NextResponse.json({ rule: updated });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  try {
    await db.rule.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
}
