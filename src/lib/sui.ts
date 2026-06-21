/**
 * Veto — Sui integration
 *
 * Server-side only. The agent's testnet keypair is loaded from env and never
 * sent to the client. All execution happens here.
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI } from "@mysten/sui/utils";

const NETWORK = process.env.SUI_NETWORK ?? "testnet";

let _client: SuiJsonRpcClient | null = null;
let _keypair: Ed25519Keypair | null = null;

export function getSuiClient(): SuiJsonRpcClient {
  if (!_client) {
    _client = new SuiJsonRpcClient({
      url: getJsonRpcFullnodeUrl(NETWORK as any),
    });
  }
  return _client;
}

export function getAgentKeypair(): Ed25519Keypair {
  if (!_keypair) {
    const secret = process.env.SUI_AGENT_SECRET_KEY;
    if (!secret) {
      throw new Error("SUI_AGENT_SECRET_KEY env var is not set");
    }
    _keypair = Ed25519Keypair.fromSecretKey(secret);
  }
  return _keypair;
}

export function getAgentAddress(): string {
  return getAgentKeypair().getPublicKey().toSuiAddress();
}

/**
 * Returns the agent wallet's SUI balance in whole SUI (not MIST).
 */
export async function getAgentBalanceSui(): Promise<number> {
  const client = getSuiClient();
  const addr = getAgentAddress();
  const bal = await client.getBalance({ owner: addr });
  return Number(bal.totalBalance) / Number(MIST_PER_SUI);
}

export type TransferResult = {
  digest: string;
  status: "success" | "failure";
  errorMessage?: string;
};

/**
 * Execute a real SUI transfer of `amountSui` from the agent wallet to `recipient`.
 *
 * Uses the agent's own gas coin, splits off the requested amount, and transfers
 * it. Returns the transaction digest on success, or an error message on failure.
 *
 * This is the ONLY function in the entire app that signs anything. It is only
 * called AFTER the policy engine has approved the action.
 */
export async function executeTransfer(
  recipient: string,
  amountSui: number
): Promise<TransferResult> {
  const client = getSuiClient();
  const kp = getAgentKeypair();

  // Sanity check: amount must be positive and the agent must have enough
  const balanceSui = await getAgentBalanceSui();
  if (balanceSui < amountSui + 0.01) {
    // +0.01 SUI cushion for gas
    return {
      digest: "",
      status: "failure",
      errorMessage: `Agent wallet has insufficient balance (${balanceSui.toFixed(
        4
      )} SUI, needed ${amountSui.toFixed(4)} + gas)`,
    };
  }

  try {
    const tx = new Transaction();
    const mistAmount = BigInt(Math.round(amountSui * Number(MIST_PER_SUI)));
    const [coin] = tx.splitCoins(tx.gas, [mistAmount]);
    tx.transferObjects([coin], recipient);

    const result = await kp.signAndExecuteTransaction({
      transaction: tx,
      client: client as any,
    });

    const effects: any = (result as any).effects;
    const status = effects?.status?.status;

    if (status === "success") {
      return { digest: result.digest, status: "success" };
    }
    return {
      digest: result.digest,
      status: "failure",
      errorMessage: effects?.status?.error || "Transaction executed but failed",
    };
  } catch (e: any) {
    return {
      digest: "",
      status: "failure",
      errorMessage: e?.message || "Unknown Sui execution error",
    };
  }
}

/**
 * Build the Sui Explorer URL for a transaction digest.
 * Currently uses Suivision (the most popular Sui explorer).
 */
export function explorerTxUrl(digest: string): string {
  return `https://testnet.suivision.xyz/txblock/${digest}`;
}

/**
 * Build the Sui Explorer URL for an address.
 */
export function explorerAddressUrl(address: string): string {
  return `https://testnet.suivision.xyz/address/${address}`;
}
