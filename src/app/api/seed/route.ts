/**
 * POST /api/seed — seed default rules so the demo isn't an empty rule book.
 * Idempotent: only inserts if no rules exist.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const SEED_RULES = [
  {
    name: "Per-transaction cap",
    type: "MAX_AMOUNT_PER_TX",
    config: JSON.stringify({ maxAmountSui: 5 }),
  },
  {
    name: "Daily spend cap",
    type: "DAILY_SPEND_CAP",
    config: JSON.stringify({ capSui: 20 }),
  },
  {
    name: "Known-bad address blocklist",
    type: "DENYLIST_ADDRESS",
    config: JSON.stringify({
      addresses: ["0x0000000000000000000000000000000000000000000000000000000000000bad"],
    }),
  },
];

export async function POST() {
  const existing = await db.rule.count();
  if (existing > 0) {
    return NextResponse.json({
      ok: true,
      message: `Seed skipped — ${existing} rule(s) already exist`,
    });
  }

  for (const rule of SEED_RULES) {
    await db.rule.create({ data: rule });
  }

  return NextResponse.json({
    ok: true,
    message: `Seeded ${SEED_RULES.length} default rules`,
  });
}
