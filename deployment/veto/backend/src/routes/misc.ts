/**
 * Misc routes: requests (activity feed), wallet, aliases, seed.
 */

import { Hono } from "hono";
import { db } from "../lib/db.js";
import { getAgentAddress, getAgentBalanceSui } from "../lib/sui.js";
import { ALIAS_LIST } from "../lib/aliases.js";
import { commitRulesToVault, getLatestCommit } from "../lib/vault.js";

const app = new Hono();

// GET /requests — activity feed
app.get("/requests", async (c) => {
  const limitParam = c.req.query("limit");
  const limit = Math.min(Number(limitParam) || 20, 100);
  const requests = await db.agentRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return c.json({ requests });
});

// GET /wallet — read-only wallet info
app.get("/wallet", async (c) => {
  try {
    const address = getAgentAddress();
    const balanceSui = await getAgentBalanceSui();
    return c.json({ address, balanceSui, network: process.env.NETWORK ?? "testnet" });
  } catch (e: any) {
    return c.json({ error: e?.message || "Wallet unavailable" }, 500);
  }
});

// GET /aliases — named address book
app.get("/aliases", (c) => {
  return c.json({ aliases: ALIAS_LIST });
});

// POST /seed — seed default rules + initial vault commit (idempotent)
app.post("/seed", async (c) => {
  const SEED_RULES = [
    { name: "Per-transaction cap", type: "MAX_AMOUNT_PER_TX", config: { maxAmountSui: 5 } },
    { name: "Daily spend cap", type: "DAILY_SPEND_CAP", config: { capSui: 20 } },
    {
      name: "Known-bad address blocklist",
      type: "DENYLIST_ADDRESS",
      config: { addresses: ["0x0000000000000000000000000000000000000000000000000000000000000bad"] },
    },
  ];

  const existing = await db.rule.count();
  if (existing > 0) {
    const commit = await getLatestCommit();
    if (!commit) {
      const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
      await commitRulesToVault(allRules);
    }
    return c.json({ ok: true, message: `Seed skipped — ${existing} rule(s) already exist` });
  }

  for (const rule of SEED_RULES) {
    await db.rule.create({ data: rule });
  }

  const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
  const commit = await commitRulesToVault(allRules);

  return c.json({ ok: true, message: `Seeded ${SEED_RULES.length} default rules + initial vault commit (v${commit.version})` });
});

export { app as miscRoutes };
