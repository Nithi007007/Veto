/**
 * Veto — Sui integration
 * Server-side only. The agent's keypair is loaded from env and never sent to the client.
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI } from "@mysten/sui/utils";

const NETWORK = process.env.NETWORK ?? "testnet";

let _client: SuiJsonRpcClient | null = null;
let _keypair: Ed25519Keypair | null = null;

export function getSuiClient(): SuiJsonRpcClient {
  if (!_client) {
    const rpcUrl = process.env.RPC_URL || getJsonRpcFullnodeUrl(NETWORK as any);
    _client = new SuiJsonRpcClient({ url: rpcUrl });
  }
  return _client;
}

export function getAgentKeypair(): Ed25519Keypair {
  if (!_keypair) {
    const secret = process.env.PRIVATE_KEY;
    if (!secret) throw new Error("PRIVATE_KEY env var is not set");
    _keypair = Ed25519Keypair.fromSecretKey(secret);
  }
  return _keypair;
}

export function getAgentAddress(): string {
  return getAgentKeypair().getPublicKey().toSuiAddress();
}

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

export async function executeTransfer(recipient: string, amountSui: number): Promise<TransferResult> {
  const client = getSuiClient();
  const kp = getAgentKeypair();

  const balanceSui = await getAgentBalanceSui();
  if (balanceSui < amountSui + 0.01) {
    return {
      digest: "",
      status: "failure",
      errorMessage: `Agent wallet has insufficient balance (${balanceSui.toFixed(4)} SUI, needed ${amountSui.toFixed(4)} + gas)`,
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

export function explorerTxUrl(digest: string): string {
  return `https://testnet.suivision.xyz/txblock/${digest}`;
}

export function explorerAddressUrl(address: string): string {
  return `https://testnet.suivision.xyz/address/${address}`;
}
