/**
 * POST /api/agent/confirm
 *
 * Step 2 of the two-step flow. After the user reviews the parsed intent
 * (returned by /api/agent/message), they explicitly confirm or reject.
 *
 * On confirm:
 *   1. Load the staged AgentRequest (status must be AWAITING_CONFIRMATION)
 *   2. Run the on-chain vault pre-flight (per_tx_cap, daily_cap)
 *   3. Run the off-chain policy engine (allowlist, denylist, etc.)
 *   4. If both pass → execute the real SUI testnet transfer
 *   5. Update the request row with the final status + txDigest
 *
 * On reject:
 *   - Update status to BLOCKED with failedRule="user_rejected"
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { runPolicyEngine, type ParsedIntent } from "@/lib/policy-engine";
import { executeTransfer, getAgentAddress } from "@/lib/sui";
import {
  preflightVaultSpend,
  VAULT_ERROR_CODES,
} from "@/lib/vault";

export const runtime = "nodejs";
export const maxDuration = 60;

const ConfirmSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["confirm", "reject"]),
});

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = ConfirmSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Must include { id, decision: 'confirm'|'reject' }" },
      { status: 400 }
    );
  }

  const { id, decision } = validation.data;

  // Load the staged request
  const staged = await db.agentRequest.findUnique({ where: { id } });
  if (!staged) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (staged.status !== "AWAITING_CONFIRMATION") {
    return NextResponse.json(
      { error: `Request is in status ${staged.status}, not AWAITING_CONFIRMATION` },
      { status: 400 }
    );
  }

  // ── REJECT path ──
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
    return NextResponse.json({
      id: updated.id,
      status: "BLOCKED",
      failedRule: "user_rejected",
      failReason: "User rejected the parsed intent during confirmation step",
    });
  }

  // ── CONFIRM path ──
  if (!staged.parsedIntent || staged.amountSui === null || !staged.recipient) {
    const updated = await db.agentRequest.update({
      where: { id },
      data: {
        status: "FAILED",
        failReason: "Missing parsed intent data",
      },
    });
    return NextResponse.json({
      id: updated.id,
      status: "FAILED",
      failReason: "Missing parsed intent data",
    });
  }

  const parsedIntent: ParsedIntent = {
    action: "transfer",
    amountSui: staged.amountSui,
    recipient: staged.recipient,
  };

  // ── 1. On-chain vault pre-flight (per_tx_cap, daily_cap) ──
  const amountMist = BigInt(
    Math.round(staged.amountSui * 1_000_000_000)
  );
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
    return NextResponse.json({
      id: updated.id,
      status: "BLOCKED",
      failedRule: `on_chain_vault:${vaultCheck.code}`,
      failReason: vaultCheck.reason,
    });
  }

  // ── 2. Compute daily spend context (from DB, post-vault check) ──
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

  // ── 3. Load enabled rules and run off-chain policy engine ──
  const rules = await db.rule.findMany();
  const decision2 = runPolicyEngine(parsedIntent, rules as any, { spentTodaySui });

  if (decision2.decision === "BLOCKED") {
    const updated = await db.agentRequest.update({
      where: { id },
      data: {
        status: "BLOCKED",
        failedRule: decision2.failedRule,
        failReason: decision2.reason,
        confirmedAt: new Date(),
      },
    });
    return NextResponse.json({
      id: updated.id,
      status: "BLOCKED",
      failedRule: decision2.failedRule,
      failReason: decision2.reason,
    });
  }

  // ── 4. APPROVED → execute the real SUI testnet transfer ──
  const agentAddress = getAgentAddress();
  const txResult = await executeTransfer(staged.recipient, staged.amountSui);

  if (txResult.status === "success") {
    const updated = await db.agentRequest.update({
      where: { id },
      data: {
        status: "EXECUTED",
        txDigest: txResult.digest,
        confirmedAt: new Date(),
      },
    });
    return NextResponse.json({
      id: updated.id,
      status: "EXECUTED",
      txDigest: txResult.digest,
      agentAddress,
    });
  }

  // Execution failed
  const updated = await db.agentRequest.update({
    where: { id },
    data: {
      status: "FAILED",
      failReason: txResult.errorMessage || "Sui execution failed",
      ...(txResult.digest ? { txDigest: txResult.digest } : {}),
      confirmedAt: new Date(),
    },
  });
  return NextResponse.json({
    id: updated.id,
    status: "FAILED",
    failReason: txResult.errorMessage || "Sui execution failed",
    agentAddress,
  });
}
