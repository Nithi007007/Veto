/**
 * GET  /api/rules     — list all rules + current vault state
 * POST /api/rules     — create a new rule (Owner only) → triggers vault commit
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { commitRulesToVault, getVaultState, getLatestCommit, detectTampering } from "@/lib/vault";

export const runtime = "nodejs";

const RuleTypeSchema = z.enum([
  "MAX_AMOUNT_PER_TX",
  "DAILY_SPEND_CAP",
  "ALLOWED_RECIPIENT",
  "DENYLIST_ADDRESS",
]);

const CreateRuleSchema = z.object({
  name: z.string().min(1).max(80),
  type: RuleTypeSchema,
  config: z.record(z.string(), z.unknown()),
});

function buildConfigValue(type: string, config: any): unknown {
  // Build the normalized config object, then return it in a form Prisma will accept.
  // - Postgres (Json column): pass the object directly
  // - SQLite (String column): JSON.stringify the object
  // We detect at runtime by checking if the env URL is a file: URL.
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

export async function GET() {
  const rules = await db.rule.findMany({
    orderBy: { createdAt: "asc" },
  });
  const vault = await getVaultState();
  const commit = await getLatestCommit();
  // T4: tamper detection — recompute local hash, compare to last commit
  const tamper = await detectTampering();
  return NextResponse.json({ rules, vault, commit, tamper });
}

export async function POST(req: NextRequest) {
  // Owner-only
  const auth = requireOwner(req);
  if (auth) return auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = CreateRuleSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid rule", details: validation.error.flatten() },
      { status: 400 }
    );
  }

  const { name, type, config } = validation.data;
  const configValue = buildConfigValue(type, config);

  const rule = await db.rule.create({
    data: { name, type, config: configValue as any },
  });

  // Commit the new rule set to the vault (on-chain in prod, simulated here)
  // commitDurationMs is measured and returned so the UI can show
  // "committed in X.Xs" — turning "fast" into a real number.
  const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
  const commit = await commitRulesToVault(allRules);

  return NextResponse.json({ rule, commit }, { status: 201 });
}
