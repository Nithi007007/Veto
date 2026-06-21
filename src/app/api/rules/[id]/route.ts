/**
 * PATCH /api/rules/:id — toggle enabled state or update config (Owner only) → triggers vault commit
 * DELETE /api/rules/:id — remove a rule (Owner only) → triggers vault commit
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { commitRulesToVault } from "@/lib/vault";

export const runtime = "nodejs";

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).max(80).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

function buildConfigValue(type: string, config: any): unknown {
  let obj: Record<string, any>;
  switch (type) {
    case "MAX_AMOUNT_PER_TX":
      obj = { maxAmountSui: Number(config.maxAmountSui) };
      break;
    case "DAILY_SPEND_CAP":
      obj = { capSui: Number(config.capSui) };
      break;
    case "ALLOWED_RECIPIENT":
    case "DENYLIST_ADDRESS": {
      const arr = Array.isArray(config.addresses)
        ? config.addresses.filter((a: any) => typeof a === "string" && a.trim())
        : [];
      obj = { addresses: arr };
      break;
    }
    default:
      obj = config;
  }
  // SQLite provider expects a string; Postgres Json expects an object.
  const isSqlite = (process.env.DATABASE_URL || "").startsWith("file:");
  return isSqlite ? JSON.stringify(obj) : obj;
}

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = requireOwner(req);
  if (auth) return auth;

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
    update.config = buildConfigValue(existing.type, validation.data.config);
  }

  const updated = await db.rule.update({ where: { id }, data: update });

  // Re-commit the rule set
  const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
  const commit = await commitRulesToVault(allRules);

  return NextResponse.json({ rule: updated, commit });
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = requireOwner(req);
  if (auth) return auth;

  const { id } = await params;
  try {
    await db.rule.delete({ where: { id } });
    // Re-commit after deletion
    const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
    const commit = await commitRulesToVault(allRules);
    return NextResponse.json({ ok: true, commit });
  } catch {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }
}
