/**
 * POST /api/agent/message
 *
 * The core pipeline. One route ties everything together:
 *   1. LLM parses the raw message into a structured intent
 *   2. zod validates the intent shape
 *   3. aliases are resolved to real addresses
 *   4. policy engine evaluates the intent against all enabled rules
 *   5. if APPROVED → execute a real signed Sui testnet transfer
 *   6. persist AgentRequest row with full audit data
 *   7. return the result
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseIntent } from "@/lib/llm";
import { runPolicyEngine, type ParsedIntent } from "@/lib/policy-engine";
import { resolveAlias } from "@/lib/aliases";
import { executeTransfer, getAgentAddress } from "@/lib/sui";

export const runtime = "nodejs";
export const maxDuration = 60;

const MessageSchema = z.object({
  message: z.string().min(1).max(500),
});

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = MessageSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Must include { message: string }" },
      { status: 400 }
    );
  }

  const rawMessage = validation.data.message;

  // Create the request row first as PENDING — every attempt gets logged.
  const request = await db.agentRequest.create({
    data: {
      rawMessage,
      status: "PENDING",
    },
  });

  // ── 1. LLM parse ──
  const intent = await parseIntent(rawMessage);

  if (intent.action === "unknown") {
    const updated = await db.agentRequest.update({
      where: { id: request.id },
      data: {
        status: "FAILED",
        failReason: intent.reason,
      },
    });
    return NextResponse.json({
      id: updated.id,
      parsedIntent: null,
      status: "FAILED",
      failReason: intent.reason,
    });
  }

  // ── 2. Resolve aliases to real addresses ──
  const resolvedRecipient = resolveAlias(intent.recipient);
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
    return NextResponse.json({
      id: updated.id,
      parsedIntent: { action: "transfer", amountSui: intent.amountSui, recipient: intent.recipient },
      status: "FAILED",
      failReason: `Could not resolve "${intent.recipient}" to a known alias or valid Sui address`,
    });
  }

  const parsedIntent: ParsedIntent = {
    action: "transfer",
    amountSui: intent.amountSui,
    recipient: resolvedRecipient,
  };

  // ── 3. Compute daily spend context ──
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const executedToday = await db.agentRequest.aggregate({
    where: {
      status: "EXECUTED",
      createdAt: { gte: twentyFourHoursAgo },
    },
    _sum: { amountSui: true },
  });
  const spentTodaySui = executedToday._sum.amountSui ?? 0;

  // ── 4. Load enabled rules and run policy engine ──
  const rules = await db.rule.findMany();
  const decision = runPolicyEngine(parsedIntent, rules as any, { spentTodaySui });

  if (decision.decision === "BLOCKED") {
    const updated = await db.agentRequest.update({
      where: { id: request.id },
      data: {
        status: "BLOCKED",
        parsedIntent: JSON.stringify(parsedIntent),
        amountSui: intent.amountSui,
        recipient: resolvedRecipient,
        failedRule: decision.failedRule,
        failReason: decision.reason,
      },
    });
    return NextResponse.json({
      id: updated.id,
      parsedIntent,
      status: "BLOCKED",
      failedRule: decision.failedRule,
      failReason: decision.reason,
    });
  }

  // ── 5. APPROVED → execute the real Sui testnet transfer ──
  const agentAddress = getAgentAddress();
  const txResult = await executeTransfer(resolvedRecipient, intent.amountSui);

  if (txResult.status === "success") {
    const updated = await db.agentRequest.update({
      where: { id: request.id },
      data: {
        status: "EXECUTED",
        parsedIntent: JSON.stringify(parsedIntent),
        amountSui: intent.amountSui,
        recipient: resolvedRecipient,
        txDigest: txResult.digest,
      },
    });
    return NextResponse.json({
      id: updated.id,
      parsedIntent,
      status: "EXECUTED",
      txDigest: txResult.digest,
      agentAddress,
    });
  }

  // Execution failed — log the failure reason but preserve the approval.
  const updated = await db.agentRequest.update({
    where: { id: request.id },
    data: {
      status: "FAILED",
      parsedIntent: JSON.stringify(parsedIntent),
      amountSui: intent.amountSui,
      recipient: resolvedRecipient,
      failReason: txResult.errorMessage || "Sui execution failed",
      ...(txResult.digest ? { txDigest: txResult.digest } : {}),
    },
  });
  return NextResponse.json({
    id: updated.id,
    parsedIntent,
    status: "FAILED",
    failReason: txResult.errorMessage || "Sui execution failed",
    agentAddress,
  });
}
