/**
 * Shared Veto types — DB row shapes (after parsing JSON config back to objects).
 */

export type RuleType =
  | "MAX_AMOUNT_PER_TX"
  | "DAILY_SPEND_CAP"
  | "ALLOWED_RECIPIENT"
  | "DENYLIST_ADDRESS";

export type RuleConfig =
  | { type: "MAX_AMOUNT_PER_TX"; maxAmountSui: number }
  | { type: "DAILY_SPEND_CAP"; capSui: number }
  | { type: "ALLOWED_RECIPIENT"; addresses: string[] }
  | { type: "DENYLIST_ADDRESS"; addresses: string[] };

export type Rule = {
  id: string;
  name: string;
  type: RuleType;
  // Postgres Json type returns a parsed object; legacy SQLite returned a JSON string.
  // Treat as unknown and parse defensively at use sites.
  config: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RequestStatus =
  | "PENDING"
  | "APPROVED"
  | "BLOCKED"
  | "EXECUTED"
  | "FAILED";

export type AgentRequest = {
  id: string;
  rawMessage: string;
  parsedIntent: string | null;
  amountSui: number | null;
  recipient: string | null;
  status: RequestStatus;
  failedRule: string | null;
  failReason: string | null;
  txDigest: string | null;
  createdAt: Date;
};

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  MAX_AMOUNT_PER_TX: "Max per transaction",
  DAILY_SPEND_CAP: "Daily spend cap",
  ALLOWED_RECIPIENT: "Allowed recipients",
  DENYLIST_ADDRESS: "Denylist addresses",
};

export const RULE_TYPE_DESCRIPTIONS: Record<RuleType, string> = {
  MAX_AMOUNT_PER_TX: "Block any single transaction above this SUI amount.",
  DAILY_SPEND_CAP: "Block transactions that would push today's total spend over this cap.",
  ALLOWED_RECIPIENT: "Only allow transfers to addresses in this list (allowlist).",
  DENYLIST_ADDRESS: "Block transfers to any address in this list (denylist).",
};
