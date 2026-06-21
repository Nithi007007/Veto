/**
 * Agent routes: /api/agent/message + /api/agent/confirm
 * The core two-step flow.
 */

import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { parseIntent } from "../lib/llm.js";
import { resolveAlias } from "../lib/aliases.js";
import { runPolicyEngine, type ParsedIntent } from "../lib/policy-engine.js";
import { executeTransfer, getAgentAddress } from "../lib/sui.js";
import { preflightVaultSpend } from "../lib/vault.js";
import { createHash } from "crypto";

const app = new Hono();

const MessageSchema = z.object({ message: z.string().min(1).max(500) });
const ConfirmSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["confirm", "reject"]),
});
const IDEMPOTENCY_WINDOW_MS = 60 * 1000;

// ─── POST /message — Step 1: LLM parse → AWAITING_CONFIRMATION ───
app.post("/message", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validation = MessageSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: "Must include { message: string }" }, 400);
  }

  const rawMessage = validation.data.message;
  const request = await db.agentRequest.create({ data: { rawMessage, status: "PENDING" } });
  const intent = await parseIntent(rawMessage);

  if (intent.action === "unknown") {
    const updated = await db.agentRequest.update({
      where: { id: request.id },
      data: { status: "FAILED", failReason: intent.reason },
    });
    return c.json({ id: updated.id, parsedIntent: null, status: "FAILED", failReason: intent.reason });
  }

  const resolvedRecipient = resolveAlias(intent.recipient);
  const wasAlias = resolvedRecipient !== null && resolvedRecipient !== intent.recipient;

  if (!resolvedRecipient) {
    const updated = await db.agentRequest.update({
      where: { id: request.id },
      data: {
        status: "FAILED",
        amountSui: intent.amountSui,
        recipient: intent.recipient,
        failReason: `Could not resolve "${intent.recipient}" to a known alias or valid Sui address`,
      },
    });
    return c.json({
      id: updated.id,
      parsedIntent: { action: "transfer", amountSui: intent.amountSui, recipient: intent.recipient },
      status: "FAILED",
      failReason: `Could not resolve "${intent.recipient}" to a known alias or valid Sui address`,
    });
  }

  const parsedIntent = {
    action: "transfer" as const,
    amountSui: intent.amountSui,
    recipient: resolvedRecipient,
    recipientAlias: wasAlias ? intent.recipient : null,
    rawRecipient: intent.recipient,
  };

  const updated = await db.agentRequest.update({
    where: { id: request.id },
    data: {
      status: "AWAITING_CONFIRMATION",
      parsedIntent: JSON.stringify(parsedIntent),
      amountSui: intent.amountSui,
      recipient: resolvedRecipient,
    },
  });

  return c.json({
    id: updated.id,
    parsedIntent,
    rawMessage,
    status: "AWAITING_CONFIRMATION",
    diff: {
      amountMentioned: extractAmountFromMessage(rawMessage),
      amountParsed: intent.amountSui,
      recipientMentioned: intent.recipient,
      recipientResolved: resolvedRecipient,
      recipientWasAlias: wasAlias,
    },
  });
});

// ─── POST /confirm — Step 2: idempotency + vault + policy + execute ───
app.post("/confirm", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const validation = ConfirmSchema.safeParse(body);
  if (!validation.success) {
    return c.json({ error: "Must include { id, decision: 'confirm'|'reject' }" }, 400);
  }

  const { id, decision } = validation.data;
  const staged = await db.agentRequest.findUnique({ where: { id } });

  if (!staged) return c.json({ error: "Request not found" }, 404);
  if (staged.status !== "AWAITING_CONFIRMATION") {
    return c.json({ error: `Request is in status ${staged.status}, not AWAITING_CONFIRMATION` }, 400);
  }

  // REJECT path
  if (decision === "reject") {
    const updated = await db.agentRequest.update({
      where: { id },
      data: {
        status: "BLOCKED",
        failedRule: "user_rejected",
        failReason: "User rejected the parsed intent during confirmation step",
        confirmedAt: new Date(),
      },
    });
    return c.json({ id: updated.id, status: "BLOCKED", failedRule: "user_rejected", failReason: "User rejected" });
  }

  // CONFIRM path
  if (!staged.parsedIntent || staged.amountSui === null || !staged.recipient) {
    const updated = await db.agentRequest.update({
      where: { id },
      data: { status: "FAILED", failReason: "Missing parsed intent data" },
    });
    return c.json({ id: updated.id, status: "FAILED", failReason: "Missing parsed intent data" });
  }

  // T5: Idempotency check
  const idempotencyKey = createHash("sha256")
    .update(`${staged.rawMessage}|${staged.amountSui}|${staged.recipient}`)
    .digest("hex");
  const idempotencyWindowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  const recentDuplicate = await db.agentRequest.findFirst({
    where: {
      status: "EXECUTED",
      amountSui: staged.amountSui,
      recipient: staged.recipient,
      rawMessage: staged.rawMessage,
      confirmedAt: { gte: idempotencyWindowStart },
      id: { not: id },
    },
    select: { id: true, confirmedAt: true },
  });
  if (recentDuplicate) {
    const updated = await db.agentRequest.update({
      where: { id },
      data: {
        status: "BLOCKED",
        failedRule: "idempotency_check",
        failReason: `Duplicate of request ${recentDuplicate.id}. Idempotency window: 60s.`,
        confirmedAt: new Date(),
      },
    });
    return c.json({ id: updated.id, status: "BLOCKED", failedRule: "idempotency_check", failReason: "Duplicate within 60s idempotency window" });
  }

  const parsedIntent: ParsedIntent = { action: "transfer", amountSui: staged.amountSui, recipient: staged.recipient };

  // On-chain vault pre-flight
  const amountMist = BigInt(Math.round(staged.amountSui * 1_000_000_000));
  const vaultCheck = await preflightVaultSpend(amountMist);
  if (!vaultCheck.ok) {
    const updated = await db.agentRequest.update({
      where: { id },
      data: {
        status: "BLOCKED",
        failedRule: `on_chain_vault:${vaultCheck.code}`,
        failReason: vaultCheck.reason,
        confirmedAt: new Date(),
      },
    });
    return c.json({ id: updated.id, status: "BLOCKED", failedRule: `on_chain_vault:${vaultCheck.code}`, failReason: vaultCheck.reason });
  }

  // Off-chain policy engine
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const executedToday = await db.agentRequest.aggregate({
    where: { status: "EXECUTED", createdAt: { gte: twentyFourHoursAgo } },
    _sum: { amountSui: true },
  });
  const spentTodaySui = executedToday._sum.amountSui ?? 0;
  const rules = await db.rule.findMany();
  const policyDecision = runPolicyEngine(parsedIntent, rules as any, { spentTodaySui });

  if (policyDecision.decision === "BLOCKED") {
    const updated = await db.agentRequest.update({
      where: { id },
      data: {
        status: "BLOCKED",
        failedRule: policyDecision.failedRule,
        failReason: policyDecision.reason,
        confirmedAt: new Date(),
      },
    });
    return c.json({ id: updated.id, status: "BLOCKED", failedRule: policyDecision.failedRule, failReason: policyDecision.reason });
  }

  // Execute
  const agentAddress = getAgentAddress();
  const txResult = await executeTransfer(staged.recipient, staged.amountSui);

  if (txResult.status === "success") {
    const updated = await db.agentRequest.update({
      where: { id },
      data: { status: "EXECUTED", txDigest: txResult.digest, confirmedAt: new Date() },
    });
    return c.json({ id: updated.id, status: "EXECUTED", txDigest: txResult.digest, agentAddress, idempotencyKey });
  }

  const updated = await db.agentRequest.update({
    where: { id },
    data: {
      status: "FAILED",
      failReason: txResult.errorMessage || "Sui execution failed",
      ...(txResult.digest ? { txDigest: txResult.digest } : {}),
      confirmedAt: new Date(),
    },
  });
  return c.json({ id: updated.id, status: "FAILED", failReason: txResult.errorMessage || "Sui execution failed", agentAddress });
});

function extractAmountFromMessage(message: string): number | null {
  const lower = message.toLowerCase();
  const wordNumbers: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  for (const [word, num] of Object.entries(wordNumbers)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(lower)) return num;
  }
  const match = lower.match(/(\d+(?:\.\d+)?)\s*sui/);
  if (match) return Number(match[1]);
  const numMatch = lower.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) return Number(numMatch[1]);
  return null;
}

export { app as agentRoutes };
