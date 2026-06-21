/**
 * POST /api/agent/message
 *
 * Two-step flow (hallucination guard):
 *   Step 1 (this route): parse the LLM intent → store as AWAITING_CONFIRMATION → return parsed intent
 *   Step 2 (/api/agent/confirm): user explicitly confirms → policy engine + SUI execution
 *
 * Why two-step: LLMs hallucinate. User says "send ten SUI to alice" — LLM
 * might return "send 100 SUI to bob". The two-step flow forces the user to
 * see the parsed intent before any policy check or chain call. The
 * confirmation screen shows:
 *   - original message
 *   - parsed amount + recipient (with the actual address resolved from alias)
 *   - a diff highlighting anything that changed between message and intent
 *
 * This is the "human-in-the-loop" pattern, but applied specifically to
 * catch LLM parsing errors — not as a replacement for the policy engine
 * (which still runs after confirmation).
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

  // ── LLM parse ──
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

  // ── Resolve aliases to real addresses (for display + later policy check) ──
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
        failReason: `Could not resolve "${intent.recipient}" to a known alias or valid Sui address`,
      },
    });
    return NextResponse.json({
      id: updated.id,
      parsedIntent: {
        action: "transfer",
        amountSui: intent.amountSui,
        recipient: intent.recipient,
      },
      status: "FAILED",
      failReason: `Could not resolve "${intent.recipient}" to a known alias or valid Sui address`,
    });
  }

  // ── Stage as AWAITING_CONFIRMATION — the user must confirm before execution ──
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
    // The UI uses these to render the diff between user's words and parsed intent
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
 * Best-effort extraction of any number + unit from the raw message,
 * for diff display. Used to highlight when the LLM parsed a different
 * amount than what the user typed.
 */
function extractAmountFromMessage(message: string): number | null {
  // Look for patterns like "5 SUI", "0.5 sui", "ten SUI"
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
