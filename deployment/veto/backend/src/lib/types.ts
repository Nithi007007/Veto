/**
 * Shared types for Veto backend.
 */

export type RuleType =
  | "MAX_AMOUNT_PER_TX"
  | "DAILY_SPEND_CAP"
  | "ALLOWED_RECIPIENT"
  | "DENYLIST_ADDRESS";

export type Rule = {
  id: string;
  name: string;
  type: RuleType;
  config: unknown; // Prisma Json returns parsed object
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RequestStatus =
  | "PENDING"
  | "APPROVED"
  | "BLOCKED"
  | "EXECUTED"
  | "FAILED"
  | "AWAITING_CONFIRMATION";

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  MAX_AMOUNT_PER_TX: "Max per transaction",
  DAILY_SPEND_CAP: "Daily spend cap",
  ALLOWED_RECIPIENT: "Allowed recipients",
  DENYLIST_ADDRESS: "Denylist addresses",
};
