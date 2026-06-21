/**
 * Named address aliases — lets the demo say "send 5 SUI to alice"
 * instead of pasting hex addresses on camera.
 *
 * EDIT THESE with your own testnet addresses before deploying.
 */

export const ALIASES: Record<string, string> = {
  self: "0x0000000000000000000000000000000000000000000000000000000000000001",
  alice: "0x0000000000000000000000000000000000000000000000000000000000000002",
  treasury: "0x0000000000000000000000000000000000000000000000000000000000000003",
};

export function resolveAlias(input: string): string | null {
  const trimmed = input.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower in ALIASES) return ALIASES[lower];
  return null;
}

export const ALIAS_LIST = Object.entries(ALIASES).map(([name, address]) => ({ name, address }));
