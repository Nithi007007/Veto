/**
 * Veto — LLM intent parser (using Anthropic Claude API)
 *
 * One job: turn free-text user input into a structured ParsedIntent, or flag
 * it as unparseable. The model's output is treated as untrusted — it goes
 * through zod validation before being used anywhere downstream.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const SYSTEM_PROMPT = `You convert a user's plain-English request into a structured JSON action for a Sui wallet agent.

Output ONLY valid JSON, nothing else. No markdown, no commentary, no code fences. Just the JSON object.

The JSON must match exactly one of these shapes:
{"action":"transfer","amountSui":<positive number>,"recipient":"<address or alias>"}
{"action":"unknown","reason":"<short explanation>"}

Rules:
- "amountSui" must be a positive number. If the user says "0.5 SUI" use 0.5. If "5 SUI" use 5.
- "recipient" can be a 0x-prefixed Sui address OR one of these known aliases: self, alice, treasury. Pass through whichever the user said. Do not invent addresses.
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

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  return t.trim();
}

function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

export async function parseIntent(message: string): Promise<LlmIntentResult> {
  let raw = "";

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        action: "unknown",
        reason: "ANTHROPIC_API_KEY not configured on the server",
      };
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    });

    // Extract text from response (type-narrow to TextBlock)
    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    raw = textBlock?.text ?? "";
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
    return { action: "unknown", reason: "LLM did not return valid JSON" };
  }

  const validation = IntentSchema.safeParse(parsed);
  if (!validation.success) {
    return { action: "unknown", reason: "LLM output failed schema validation" };
  }

  const v = validation.data;
  if (v.action === "transfer") {
    if (typeof v.amountSui !== "number" || typeof v.recipient !== "string") {
      return { action: "unknown", reason: "Missing amount or recipient" };
    }
    return { action: "transfer", amountSui: v.amountSui, recipient: v.recipient };
  }

  return { action: "unknown", reason: v.reason || "Could not parse the instruction" };
}
