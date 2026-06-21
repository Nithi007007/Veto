/**
 * Veto — LLM intent parser
 *
 * One job: turn free-text user input into a structured ParsedIntent, or flag
 * it as unparseable. The model's output is treated as untrusted — it goes
 * through zod validation before being used anywhere downstream.
 */

import ZAI from "z-ai-web-dev-sdk";
import { z } from "zod";
import { ALIAS_LIST } from "@/lib/aliases";

const aliasNames = ALIAS_LIST.map((a) => a.name).join(", ");

const SYSTEM_PROMPT = `You convert a user's plain-English request into a structured JSON action for a Sui wallet agent.

Output ONLY valid JSON, nothing else. No markdown, no commentary, no code fences. Just the JSON object.

The JSON must match exactly one of these shapes:
{"action":"transfer","amountSui":<positive number>,"recipient":"<address or alias>"}
{"action":"unknown","reason":"<short explanation>"}

Rules:
- "amountSui" must be a positive number. If the user says "0.5 SUI" use 0.5. If "5 SUI" use 5.
- "recipient" can be a 0x-prefixed Sui address OR one of these known aliases: ${aliasNames}. Pass through whichever the user said. Do not invent addresses.
- If the user requests anything other than a SUI transfer (e.g. NFT, swap, staking), return {"action":"unknown","reason":"..."}.
- If the user does not specify an amount, return {"action":"unknown","reason":"amount not specified"}.
- If the user does not specify a recipient, return {"action":"unknown","reason":"recipient not specified"}.
- Treat anything you cannot confidently parse as "unknown" — never guess an address.`;

const IntentSchema = z.object({
  action: z.enum(["transfer", "unknown"]),
  amountSui: z.number().positive().optional(),
  recipient: z.string().optional(),
  reason: z.string().optional(),
});

export type LlmIntentResult =
  | { action: "transfer"; amountSui: number; recipient: string }
  | { action: "unknown"; reason: string };

/**
 * Strip markdown code fences if the model adds them despite instructions.
 */
function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  return t.trim();
}

/**
 * Extract the first JSON object from a string that may have extra text around it.
 */
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parse a user's plain-English message into a structured intent.
 *
 * Falls back to "unknown" on any error — never throws. The caller is responsible
 * for surfacing the "unknown" status to the user.
 */
export async function parseIntent(message: string): Promise<LlmIntentResult> {
  let raw = "";
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      thinking: { type: "disabled" },
    });
    raw = completion.choices[0]?.message?.content ?? "";
  } catch (e: any) {
    return {
      action: "unknown",
      reason: `LLM call failed: ${e?.message || "unknown error"}`,
    };
  }

  const cleaned = stripFences(raw);
  const jsonStr = extractJson(cleaned) ?? cleaned;

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      action: "unknown",
      reason: "LLM did not return valid JSON",
    };
  }

  const validation = IntentSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      action: "unknown",
      reason: "LLM output failed schema validation",
    };
  }

  const v = validation.data;
  if (v.action === "transfer") {
    if (typeof v.amountSui !== "number" || typeof v.recipient !== "string") {
      return { action: "unknown", reason: "Missing amount or recipient" };
    }
    return {
      action: "transfer",
      amountSui: v.amountSui,
      recipient: v.recipient,
    };
  }

  return {
    action: "unknown",
    reason: v.reason || "Could not parse the instruction",
  };
}
