/**
 * POST /api/agent/message
 *
 * Two-step flow (hallucination guard):
 * Step 1: parse user input deterministically → store as AWAITING_CONFIRMATION
 * Step 2: /api/agent/confirm executes after user approval
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseIntent } from "@/lib/llm";
import { resolveAlias } from "@/lib/aliases";

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
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = MessageSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: "Must include { message: string }" },
      { status: 400 }
    );
  }

  const rawMessage = validation.data.message;

  // Always log request first
  const request = await db.agentRequest.create({
    data: {
      rawMessage,
      status: "PENDING",
    },
  });

  // ── Deterministic parse (NO LLM) ──
  const intent = await parseIntent(rawMessage);

  // If parser cannot understand input
  if (intent.action !== "transfer") {
    const updated = await db.agentRequest.update({
      where: { id: request.id },
      data: {
        status: "FAILED",
      },
    });

    return NextResponse.json({
      id: updated.id,
      parsedIntent: null,
      status: "FAILED",
    });
  }

  // ── Resolve recipient alias → address ──
  const resolvedRecipient = resolveAlias(intent.recipient);

  const wasAlias =
    resolvedRecipient !== null && resolvedRecipient !== intent.recipient;

  if (!resolvedRecipient) {
    const updated = await db.agentRequest.update({
      where: { id: request.id },
      data: {
        status: "FAILED",
        amountSui: intent.amountSui,
        recipient: intent.recipient,
        failReason:
          `Unknown recipient: "${intent.recipient}"`,
      },
    });

    return NextResponse.json({
      id: updated.id,
      parsedIntent: intent,
      status: "FAILED",
      failReason: `Unknown recipient: "${intent.recipient}"`,
    });
  }

  // ── Normalize final intent ──
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

  return NextResponse.json({
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
}

/**
 * Lightweight heuristic extractor for UI diff display
 */
function extractAmountFromMessage(message: string): number | null {
  const lower = message.toLowerCase();

  const wordNumbers: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    twenty: 20,
    fifty: 50,
    hundred: 100,
    thousand: 1000,
  };

  for (const [word, num] of Object.entries(wordNumbers)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(lower)) {
      return num;
    }
  }

  const match = lower.match(/(\d+(?:\.\d+)?)\s*sui/);
  if (match) return Number(match[1]);

  const numMatch = lower.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) return Number(numMatch[1]);

  return null;
}