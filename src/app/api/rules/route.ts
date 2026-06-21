/**
 * GET  /api/rules     — list all rules + current vault state
 * POST /api/rules     — create a new rule (Owner only) → triggers vault commit
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { commitRulesToVault, getVaultState, getLatestCommit } from "@/lib/vault";

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
  config: z.record(z.any()),
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

export async function GET() {
  const rules = await db.rule.findMany({
    orderBy: { createdAt: "asc" },
  });
  const vault = await getVaultState();
  const commit = await getLatestCommit();
  return NextResponse.json({ rules, vault, commit });
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
  const configStr = buildConfigString(type, config);

  const rule = await db.rule.create({
    data: { name, type, config: configStr },
  });

  // Commit the new rule set to the vault (on-chain in prod, simulated here)
  const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
  const commit = await commitRulesToVault(allRules);

  return NextResponse.json({ rule, commit }, { status: 201 });
}
