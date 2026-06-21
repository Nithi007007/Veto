/**
 * Veto — On-chain Vault simulator + commit logic + tamper detection.
 *
 * Mirrors the semantics of contracts/sources/vault.move exactly.
 * In v1: runs off-chain. In production: the same code calls vault::spend()
 * on-chain and the chain enforcement becomes authoritative.
 */

import { createHash } from "crypto";
import { db } from "./db.js";
import type { Rule } from "./types.js";

export type VaultConfig = {
  perTxCapMist: bigint;
  dailyCapMist: bigint;
};

export type VaultCommit = {
  id: string;
  commitHash: string;
  version: number;
  txDigest: string | null;
  createdAt: Date;
};

const DEFAULT_VAULT_CONFIG: VaultConfig = {
  perTxCapMist: 5n * 1_000_000_000n,
  dailyCapMist: 20n * 1_000_000_000n,
};

export async function getVaultState() {
  const latestCommit = await db.ruleBookCommit.findFirst({
    orderBy: { version: "desc" },
  });

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const executedToday = await db.agentRequest.aggregate({
    where: { status: "EXECUTED", createdAt: { gte: twentyFourHoursAgo } },
    _sum: { amountSui: true },
  });
  const spentTodaySui = executedToday._sum.amountSui ?? 0;
  const spentTodayMist = BigInt(Math.round(spentTodaySui * 1_000_000_000));

  return {
    config: {
      perTxCapMist: DEFAULT_VAULT_CONFIG.perTxCapMist.toString(),
      dailyCapMist: DEFAULT_VAULT_CONFIG.dailyCapMist.toString(),
    },
    spentTodayMist: spentTodayMist.toString(),
    windowStartMs: latestCommit?.createdAt?.getTime() ?? Date.now(),
    rulesCommitHash: latestCommit?.commitHash ?? "",
    rulesVersion: latestCommit?.version ?? 0,
  };
}

export async function getLatestCommit(): Promise<VaultCommit | null> {
  const row = await db.ruleBookCommit.findFirst({
    orderBy: { version: "desc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    commitHash: row.commitHash,
    version: row.version,
    txDigest: row.txDigest,
    createdAt: row.createdAt,
  };
}

export async function detectTampering() {
  const rules = (await db.rule.findMany({
    orderBy: { createdAt: "asc" },
  })) as any;
  const currentHash = computeRulesHash(rules);

  const latestCommit = await db.ruleBookCommit.findFirst({
    orderBy: { version: "desc" },
  });
  const committedHash = latestCommit?.commitHash ?? "";
  const lastCommittedAt = latestCommit?.createdAt ?? null;

  const tampered = committedHash !== "" && currentHash !== committedHash;

  return { tampered, currentHash, committedHash, lastCommittedAt };
}

export function computeRulesHash(rules: Rule[]): string {
  const sorted = [...rules].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const enabled = sorted.filter((r) => r.enabled);
  const canonical = enabled.map((r) => ({
    name: r.name,
    type: r.type,
    config:
      typeof r.config === "string"
        ? (() => {
            try {
              return JSON.parse(r.config || "{}");
            } catch {
              return {};
            }
          })()
        : r.config ?? {},
  }));
  return "0x" + createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function commitRulesToVault(rules: Rule[]) {
  const t0 = Date.now();
  const hash = computeRulesHash(rules);
  const latest = await db.ruleBookCommit.findFirst({
    orderBy: { version: "desc" },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  const row = await db.ruleBookCommit.create({
    data: { commitHash: hash, version: nextVersion, txDigest: null },
  });

  return {
    id: row.id,
    commitHash: row.commitHash,
    version: row.version,
    txDigest: row.txDigest,
    createdAt: row.createdAt,
    commitDurationMs: Date.now() - t0,
  };
}

export type VaultSpendResult =
  | { ok: true; digest: string; spentTodayMist: bigint }
  | { ok: false; code: string; reason: string };

export const VAULT_ERROR_CODES = {
  EAmountZero: "EAmountZero",
  EAmountExceedsPerTx: "EAmountExceedsPerTx",
  EAmountExceedsDailyCap: "EAmountExceedsDailyCap",
  EInsufficientFunds: "EInsufficientFunds",
} as const;

export async function preflightVaultSpend(amountMist: bigint): Promise<VaultSpendResult> {
  if (amountMist === 0n) {
    return { ok: false, code: VAULT_ERROR_CODES.EAmountZero, reason: "Amount must be greater than zero" };
  }

  const state = await getVaultState();
  const perTxCap = BigInt(state.config.perTxCapMist);
  const dailyCap = BigInt(state.config.dailyCapMist);
  const spentToday = BigInt(state.spentTodayMist);

  if (amountMist > perTxCap) {
    return {
      ok: false,
      code: VAULT_ERROR_CODES.EAmountExceedsPerTx,
      reason: `Amount ${(Number(amountMist) / 1e9).toFixed(4)} SUI exceeds on-chain per-tx cap of ${(Number(perTxCap) / 1e9).toFixed(2)} SUI`,
    };
  }

  const projected = spentToday + amountMist;
  if (projected > dailyCap) {
    return {
      ok: false,
      code: VAULT_ERROR_CODES.EAmountExceedsDailyCap,
      reason: `Would bring today's total to ${(Number(projected) / 1e9).toFixed(4)} SUI, exceeding on-chain daily cap of ${(Number(dailyCap) / 1e9).toFixed(2)} SUI`,
    };
  }

  return { ok: true, digest: "", spentTodayMist: projected };
}
