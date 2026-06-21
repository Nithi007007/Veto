/**
 * Veto — Sui integration
 * Server-side only. The agent's keypair is loaded from env and never sent to the client.
 *
 * Uses @mysten/sui v2 (2.19.0). Types are handled properly.
 *
 * One `as any` remains on `client.core` in tx.build() — this is an SDK type
 * gap where JSONRpcCoreClient extends CoreClient but doesn't formally satisfy
 * ClientWithCoreApi. The runtime is correct; the types don't align across
 * the SDK's internal interface layering.
 *
 * Architecture: we sign with the keypair, then execute via the client's
 * executeTransactionBlock method. This avoids the type mismatch between
 * the Signer interface (which expects ClientWithCoreApi) and SuiJsonRpcClient.
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI } from "@mysten/sui/utils";

const NETWORK = process.env.NETWORK ?? "testnet";

let _client: SuiJsonRpcClient | null = null;
let _keypair: Ed25519Keypair | null = null;

/**
 * Get the Sui client singleton.
 *
 * SuiJsonRpcClient in SDK v2 requires both `url` and `network` per
 * SuiJsonRpcClientOptions. The `network` field is a string union:
 * 'mainnet' | 'testnet' | 'devnet' | 'localnet' | (string & {}).
 */
export function getSuiClient(): SuiJsonRpcClient {
  if (!_client) {
    const rpcUrl = process.env.RPC_URL || getJsonRpcFullnodeUrl(NETWORK as any);
    _client = new SuiJsonRpcClient({ url: rpcUrl, network: NETWORK });
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

/**
 * Execute a real SUI transfer from the agent wallet.
 *
 * Two-step process (avoids type mismatch between Signer and Client interfaces):
 *   1. Build the transaction + sign it with the keypair
 *   2. Execute the signed transaction via client.executeTransactionBlock
 *
 * The result is a SuiTransactionBlockResponse with a `digest` field and
 * an `effects` object containing the status.
 */
export async function executeTransfer(
  recipient: string,
  amountSui: number
): Promise<TransferResult> {
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
    // 1. Build the transaction
    const tx = new Transaction();
    const mistAmount = BigInt(Math.round(amountSui * Number(MIST_PER_SUI)));
    const [coin] = tx.splitCoins(tx.gas, [mistAmount]);
    tx.transferObjects([coin], recipient);
    tx.setSender(getAgentAddress());

    // 2. Build the transaction bytes
    // SuiJsonRpcClient has a .core property (JSONRpcCoreClient) that satisfies
    // the ClientWithCoreApi interface expected by Transaction.build().
    const txBytes = await tx.build({ client: client.core as any });

    // 3. Sign with the keypair
    const { signature } = await kp.signTransaction(txBytes);

    // 4. Execute via the client
    const result = await client.executeTransactionBlock({
      transactionBlock: txBytes,
      signature,
      options: { showEffects: true },
    });

    const digest: string = result.digest;
    const effects = result.effects;
    const status = effects?.status;

    if (status?.status === "success") {
      return { digest, status: "success" };
    }
    return {
      digest,
      status: "failure",
      errorMessage: status?.error || "Transaction executed but failed",
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
