export type ParsedIntent =
  | {
      action: "transfer";
      amountSui: number;
      recipient: string;
    }
  | {
      action: "unknown";
      reason: string;
    };

export async function parseIntent(input: string): Promise<ParsedIntent> {
  const text = input.trim().toLowerCase();

  // More flexible pattern:
  // send 1 sui to alice
  // transfer 0.5sui to 0xabc
  const regex =
    /(send|transfer)\s*([\d.]+)\s*sui\s*to\s*([a-z0-9@._-]+|0x[a-f0-9]+)/i;

  const match = text.match(regex);

  if (!match) {
    return {
      action: "unknown",
      reason:
        "Could not understand command. Use format: send 1 SUI to alice",
    };
  }

  const amount = Number(match[2]);

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      action: "unknown",
      reason: "Invalid SUI amount",
    };
  }

  return {
    action: "transfer",
    amountSui: amount,
    recipient: match[3],
  };
}