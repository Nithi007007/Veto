/**
 * Named address aliases — lets the demo say "send 5 SUI to alice"
 * instead of pasting hex on camera.
 *
 * To replace these with your own testnet addresses, edit the values below.
 * Add new aliases here and they become immediately usable from the chat.
 */

export const ALIASES: Record<string, string> = {
  // Agent's own address — useful for self-transfer demos
  self: "0xe21fa541fc2da38ef0c26741f83673b5699d0a61e176b3c37405f669720e20cc",
  // "alice" placeholder — replace with a real second testnet address you control
  alice: "0x0000000000000000000000000000000000000000000000000000000000000bad",
  // Treasury placeholder — replace with another testnet address
  treasury: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

/**
 * Resolve an alias or address to a valid Sui address.
 * - If the input is already a 0x-prefixed address, return it as-is.
 * - If it's a known alias (case-insensitive), return the resolved address.
 * - Otherwise return null (unresolvable).
 */
export function resolveAlias(input: string): string | null {
  const trimmed = input.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower in ALIASES) {
    return ALIASES[lower];
  }
  return null;
}

export const ALIAS_LIST = Object.entries(ALIASES).map(([name, address]) => ({
  name,
  address,
}));
