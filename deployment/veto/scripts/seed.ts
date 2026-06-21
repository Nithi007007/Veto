/**
 * Veto — Database seed script
 * Run: npx tsx scripts/seed.ts
 *
 * Seeds 3 default rules + initial vault commit.
 * Idempotent: only inserts if no rules exist.
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const db = new PrismaClient();

const SEED_RULES = [
  { name: "Per-transaction cap", type: "MAX_AMOUNT_PER_TX", config: { maxAmountSui: 5 } },
  { name: "Daily spend cap", type: "DAILY_SPEND_CAP", config: { capSui: 20 } },
  {
    name: "Known-bad address blocklist",
    type: "DENYLIST_ADDRESS",
    config: { addresses: ["0x0000000000000000000000000000000000000000000000000000000000000bad"] },
  },
];

function computeRulesHash(rules: any[]): string {
  const sorted = [...rules].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const enabled = sorted.filter((r) => r.enabled);
  const canonical = enabled.map((r) => ({ name: r.name, type: r.type, config: r.config }));
  return "0x" + createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function main() {
  console.log("Seeding Veto database...\n");

  const existing = await db.rule.count();
  if (existing > 0) {
    console.log(`⚠️  ${existing} rule(s) already exist — skipping seed.`);
    return;
  }

  for (const rule of SEED_RULES) {
    await db.rule.create({ data: rule });
    console.log(`  ✓ Created rule: ${rule.name}`);
  }

  // Create initial vault commit
  const allRules = await db.rule.findMany({ orderBy: { createdAt: "asc" } });
  const hash = computeRulesHash(allRules);
  await db.ruleBookCommit.create({
    data: { commitHash: hash, version: 1, txDigest: null },
  });
  console.log(`\n✓ Initial vault commit created (v1, hash: ${hash.slice(0, 18)}…)`);

  console.log("\n✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
