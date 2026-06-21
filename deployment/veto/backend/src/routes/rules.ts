/**
 * Rules routes: CRUD + vault re-commit on every change.
 * POST/PATCH/DELETE require owner auth.
 */

import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { isOwnerAuthorized } from "../lib/auth.js";
import {
  commitRulesToVault,
  getVaultState,
  getLatestCommit,
  detectTampering,
} from "../lib/vault.js";

const app = new Hono();

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

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).max(80).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

function buildConfigObject(type: string, config: any): Record<string, any> {
  switch (type) {
    case "MAX_AMOUNT_PER_TX":
      return { maxAmountSui: Number(config.maxAmountSui) };
    case "DAILY_SPEND_CAP":
      return { capSui: Number(config.capSui) };
    case "ALLOWED_RECIPIENT":
    case "DENYLIST_ADDRESS": {
      const arr = Array.isArray(config.addresses)
        ? config.addresses.filter((a: any) => typeof a === "string" && a.trim())
        : [];
      return { addresses: arr };
    }
    default:
      return config;
  }
}

// GET / — list rules + vault state + commit + tamper flag
app.get("/", async (c) => {
  const rules = await db.rule.findMany({ orderBy: { createdAt: "asc" } });
  const vault = await getVaultState();
  const commit = await getLatestCommit();
  const tamper = await detectTampering();
  return c.json({ rules, vault, commit, tamper });
});

// POST / — create rule (owner-only)
app.post("/", async (c) => {
  if (!isOwnerAuthorized(c)) {
    return c.json({ error: "Unauthorized — owner session or token required" }, 401);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validation = CreateRuleSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: "Invalid rule", details: validation.error.flatten() }, 400);
  }

  const { name, type, config } = validation.data;
  const configObj = buildConfigObject(type, config);
  const rule = await db.rule.create({ data: { name, type, config: configObj } });

  const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
  const commit = await commitRulesToVault(allRules);

  return c.json({ rule, commit }, 201);
});

// PATCH /:id — toggle/edit (owner-only)
app.patch("/:id", async (c) => {
  if (!isOwnerAuthorized(c)) {
    return c.json({ error: "Unauthorized — owner session or token required" }, 401);
  }

  const id = c.req.param("id");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validation = PatchSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: "Invalid patch body", details: validation.error.flatten() }, 400);
  }

  const existing = await db.rule.findUnique({ where: { id } });
  if (!existing) return c.json({ error: "Rule not found" }, 404);

  const update: any = {};
  if (typeof validation.data.enabled === "boolean") update.enabled = validation.data.enabled;
  if (typeof validation.data.name === "string") update.name = validation.data.name;
  if (validation.data.config) update.config = buildConfigObject(existing.type, validation.data.config);

  const updated = await db.rule.update({ where: { id }, data: update });
  const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
  const commit = await commitRulesToVault(allRules);

  return c.json({ rule: updated, commit });
});

// DELETE /:id — delete (owner-only)
app.delete("/:id", async (c) => {
  if (!isOwnerAuthorized(c)) {
    return c.json({ error: "Unauthorized — owner session or token required" }, 401);
  }

  const id = c.req.param("id");
  try {
    await db.rule.delete({ where: { id } });
    const allRules = (await db.rule.findMany({ orderBy: { createdAt: "asc" } })) as any;
    const commit = await commitRulesToVault(allRules);
    return c.json({ ok: true, commit });
  } catch {
    return c.json({ error: "Rule not found" }, 404);
  }
});

export { app as rulesRoutes };
