/**
 * POST /api/seed — seed default rules so the demo isn't an empty rule book.
 * Idempotent: only inserts if no rules exist. Also creates the initial vault commit.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commitRulesToVault, getLatestCommit } from "@/lib/vault";

export const runtime = "nodejs";

const SEED_RULES = [
  {
    name: "Per-transaction cap",
    type: "MAX_AMOUNT_PER_TX",
    config: { maxAmountSui: 5 },
  },
  {
    name: "Daily spend cap",
    type: "DAILY_SPEND_CAP",
    config: { capSui: 20 },
  },
  {
    name: "Known-bad address blocklist",
    type: "DENYLIST_ADDRESS",
    config: {
      addresses: ["0x0000000000000000000000000000000000000000000000000000000000000bad"],
    },
  },
];

// SQLite provider expects config as a JSON string; Postgres Json expects an object.
function configForProvider(obj: Record<string, any>): unknown {
  const isSqlite = (process.env.DATABASE_URL || "").startsWith("file:");
  return isSqlite ? JSON.stringify(obj) : obj;
}

export async function POST() {
  const existing = await db.rule.count();
  if (existing > 0) {
    // Make sure there's a vault commit even if rules already exist
    const commit = await getLatestCommit();
    if (!commit) {
      const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
      await commitRulesToVault(allRules);
    }
    return NextResponse.json({
      ok: true,
      message: `Seed skipped — ${existing} rule(s) already exist`,
    });
  }

  for (const rule of SEED_RULES) {
    await db.rule.create({
      data: {
        name: rule.name,
        type: rule.type,
        config: configForProvider(rule.config) as any,
      },
    });
  }

  // Create the initial vault commit
  const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
  const commit = await commitRulesToVault(allRules);

  return NextResponse.json({
    ok: true,
    message: `Seeded ${SEED_RULES.length} default rules + initial vault commit (v${commit.version})`,
  });
}
