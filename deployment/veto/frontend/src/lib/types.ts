/**
 * Shared types for the frontend.
 */

export type Rule = {
  id: string;
  name: string;
  type: "MAX_AMOUNT_PER_TX" | "DAILY_SPEND_CAP" | "ALLOWED_RECIPIENT" | "DENYLIST_ADDRESS";
  config: unknown;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RequestStatus =
  | "PENDING" | "APPROVED" | "BLOCKED" | "EXECUTED" | "FAILED" | "AWAITING_CONFIRMATION";

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
  confirmedAt: string | null;
  createdAt: string;
};

export type WalletInfo = { address: string; balanceSui: number; network: string };

export type VaultState = {
  config: { perTxCapMist: string; dailyCapMist: string };
  spentTodayMist: string;
  windowStartMs: number;
  rulesCommitHash: string;
  rulesVersion: number;
};

export type VaultCommit = {
  id: string; commitHash: string; version: number;
  txDigest: string | null; createdAt: string;
};

export type TamperState = {
  tampered: boolean; currentHash: string;
  committedHash: string; lastCommittedAt: string | null;
};
