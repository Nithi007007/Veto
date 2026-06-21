/**
 * Veto — Sui integration
 */

import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI } from "@mysten/sui/utils";

const NETWORK = process.env.SUI_NETWORK ?? "testnet";

let _client: SuiClient | null = null;
let _keypair: Ed25519Keypair | null = null;

export function getSuiClient(): SuiClient {
  if (!_client) {
    _client = new SuiClient({
      url: getFullnodeUrl(NETWORK as any),
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

export function getAgentAddress() {
  return getAgentKeypair().getPublicKey().toSuiAddress();
}

export async function getAgentBalanceSui() {
  const client = getSuiClient();

  const balance = await client.getBalance({
    owner: getAgentAddress(),
  });

  return Number(balance.totalBalance) / Number(MIST_PER_SUI);
}

export type TransferResult = {
  digest: string;
  status: "success" | "failure";
  errorMessage?: string;
};

export async function executeTransfer(
  recipient: string,
  amountSui: number
): Promise<TransferResult> {
  const client = getSuiClient();
  const keypair = getAgentKeypair();

  try {
    console.log("Agent:", getAgentAddress());

    const balance = await client.getBalance({
      owner: getAgentAddress(),
    });

    console.log("Balance:", balance);

    const tx = new Transaction();

    const mist = BigInt(
      Math.round(amountSui * Number(MIST_PER_SUI))
    );

    const [coin] = tx.splitCoins(tx.gas, [mist]);

    tx.transferObjects([coin], recipient);

    tx.setSender(getAgentAddress());

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: {
        showEffects: true,
        showBalanceChanges: true,
        showObjectChanges: true,
        showEvents: true,
      },
    });

    console.log(
      "TX RESULT:",
      JSON.stringify(result, null, 2)
    );

    if (result.effects?.status.status === "success") {
      return {
        digest: result.digest,
        status: "success",
      };
    }

    return {
      digest: result.digest,
      status: "failure",
      errorMessage:
        result.effects?.status.error ??
        "Transaction executed but failed",
    };
  } catch (e: any) {
    console.error("TRANSFER ERROR");
    console.error(e);

    return {
      digest: "",
      status: "failure",
      errorMessage: e?.message ?? String(e),
    };
  }
}

export function explorerTxUrl(digest: string) {
  return `https://testnet.suivision.xyz/txblock/${digest}`;
}

export function explorerAddressUrl(address: string) {
  return `https://testnet.suivision.xyz/address/${address}`;
}