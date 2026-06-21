/**
 * Veto — Policy Engine
 *
 * The core of the project: a pure, synchronous, side-effect-free TypeScript
 * function that decides whether a proposed agent action is allowed.
 *
 * IMPORTANT: No LLM call happens inside this module. That sentence is the whole pitch.
 */

import type { Rule } from "@/lib/types";

export type ParsedIntent = {
  action: "transfer";
  amountSui: number;
  recipient: string;
};

export type PolicyContext = {
  /** Total SUI already spent today (sum of EXECUTED requests in last 24h). */
  spentTodaySui: number;
};

export type RuleResult = {
  rule: Rule;
  pass: boolean;
  reason: string;
};

export type PolicyDecision =
  | { decision: "APPROVED" }
  | { decision: "BLOCKED"; failedRule: string; reason: string };

/**
 * Parse the config field. With Postgres Json type, Prisma returns a parsed
 * object; with SQLite (legacy) it was a JSON string. Support both for
 * forward/backward compatibility.
 */
function parseConfig(rule: Rule): Record<string, any> {
  const c = rule.config as any;
  if (c == null) return {};
  if (typeof c === "string") {
    try {
      return JSON.parse(c);
    } catch {
      return {};
    }
  }
  if (typeof c === "object") return c;
  return {};
}

export function evaluateRule(
  rule: Rule,
  intent: ParsedIntent,
  context: PolicyContext
): RuleResult {
  const cfg = parseConfig(rule);

  switch (rule.type) {
    case "MAX_AMOUNT_PER_TX": {
      const max = Number(cfg.maxAmountSui ?? 0);
      const pass = intent.amountSui <= max;
      return {
        rule,
        pass,
        reason: pass
          ? `Within per-tx limit (${max} SUI)`
          : `Amount ${intent.amountSui} SUI exceeds per-transaction limit of ${max} SUI`,
      };
    }

    case "DAILY_SPEND_CAP": {
      const cap = Number(cfg.capSui ?? 0);
      const projected = context.spentTodaySui + intent.amountSui;
      const pass = projected <= cap;
      return {
        rule,
        pass,
        reason: pass
          ? `Within daily cap (projected ${projected.toFixed(2)} / ${cap} SUI)`
          : `Would bring today's total to ${projected.toFixed(2)} SUI, exceeding daily cap of ${cap} SUI`,
      };
    }

    case "DENYLIST_ADDRESS": {
      const denied: string[] = Array.isArray(cfg.addresses) ? cfg.addresses : [];
      const pass = !denied.includes(intent.recipient);
      return {
        rule,
        pass,
        reason: pass
          ? "Recipient not on denylist"
          : "Recipient address is on the denylist",
      };
    }

    case "ALLOWED_RECIPIENT": {
      const allowed: string[] = Array.isArray(cfg.addresses) ? cfg.addresses : [];
      const pass = allowed.includes(intent.recipient);
      return {
        rule,
        pass,
        reason: pass
          ? "Recipient is on the allowlist"
          : "Recipient is not on the allowlist (allowlist rule active)",
      };
    }

    default:
      return {
        rule,
        pass: false,
        reason: `Unknown rule type: ${rule.type}`,
      };
  }
}

/**
 * Run all enabled rules against the intent. Returns the first failure (if any),
 * or an APPROVED decision if every rule passes.
 *
 * Rule evaluation order is deterministic — they're evaluated in the order they
 * were inserted (Rule.id ordering), which makes the audit trail reproducible.
 *
 * FAIL-CLOSED: if there are zero enabled rules, the engine BLOCKS by default
 * with reason "no rules configured — fail-closed". This is the safe behavior
 * for a policy engine: an empty/misconfigured rule book must NOT mean "anything
 * goes." If you genuinely want to allow everything, add an explicit
 * MAX_AMOUNT_PER_TX rule with a very high cap.
 *
 * This is the answer to the test suite's edge-case probe: "approves with zero
 * enabled rules — confirm this is the behavior you actually want." It is NOT.
 * Fail-closed is.
 */
export function runPolicyEngine(
  intent: ParsedIntent,
  rules: Rule[],
  context: PolicyContext
): PolicyDecision {
  const enabledRules = rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (enabledRules.length === 0) {
    return {
      decision: "BLOCKED",
      failedRule: "fail_closed_no_rules",
      reason:
        "No enabled rules found. The policy engine fails closed when the rule book is empty — add at least one rule (e.g. a per-tx cap) to allow any transfer.",
    };
  }

  for (const rule of enabledRules) {
    const result = evaluateRule(rule, intent, context);
    if (!result.pass) {
      return {
        decision: "BLOCKED",
        failedRule: rule.name,
        reason: result.reason,
      };
    }
  }

  return { decision: "APPROVED" };
}
