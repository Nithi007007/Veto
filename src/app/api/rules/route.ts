/**
 * GET  /api/rules     — list all rules
 * POST /api/rules     — create a new rule
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

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
  // Normalize config based on rule type so the policy engine reads cleanly.
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
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
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

  return NextResponse.json({ rule }, { status: 201 });
}
