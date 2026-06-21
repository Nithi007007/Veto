/**
 * GET /api/wallet — read-only display of the agent's own wallet
 */

import { NextResponse } from "next/server";
import { getAgentAddress, getAgentBalanceSui } from "@/lib/sui";

export const runtime = "nodejs";

export async function GET() {
  try {
    const address = getAgentAddress();
    const balanceSui = await getAgentBalanceSui();
    return NextResponse.json({
      address,
      balanceSui,
      network: process.env.SUI_NETWORK ?? "testnet",
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Wallet unavailable" },
      { status: 500 }
    );
  }
}
