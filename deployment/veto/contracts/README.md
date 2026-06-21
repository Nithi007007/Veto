# Veto — Smart Contracts (Sui Move)

The on-chain vault that **holds funds and enforces hard caps** atomically. Uses the **OwnerCap capability pattern** for protocol-level authorization.

## Structure

```
contracts/
├── Move.toml              ← Package config (depends on Sui framework)
├── sources/
│   └── vault.move         ← The vault module (OwnerCap + Vault + spend + commit_rules)
├── scripts/
│   └── deploy.sh          ← Deployment script (requires Sui CLI)
└── README.md              ← This file
```

## Key types

### `OwnerCap` — capability object

Possession of this object IS the authorization to call `commit_rules()` and `configure()`. The Sui runtime checks object ownership before the function body runs — a tx without the OwnerCap is rejected at the protocol level.

### `Vault` — shared object

Holds the per-tx cap, daily cap, spent-today counter, rule commit hash, and version. Shared via `share_vault()` so anyone can read it; only OwnerCap holders can mutate caps or commit rules.

## Entry functions

| Function | Auth | Description |
|----------|------|-------------|
| `create(per_tx_cap, daily_cap)` | None | Create vault + OwnerCap (called once at deploy) |
| `share_vault(vault)` | None | Make vault a shared object |
| `transfer_owner_cap(cap, to)` | None | Transfer OwnerCap to an address |
| `configure(cap, vault, per_tx, daily)` | OwnerCap | Update hard caps |
| `commit_rules(cap, vault, new_hash)` | OwnerCap | Write new rule book hash on-chain |
| `spend(vault, coin, recipient, amount)` | None | Atomic check-and-spend (race-safe via consensus) |

## Build & deploy

```bash
# Requires Sui CLI: https://docs.sui.io/guides/developer/getting-started/sui-install

# Build
sui move build --path .

# Publish to testnet
sui client publish --gas-budget 100000000 .

# Or use the deploy script:
./scripts/deploy.sh
```

After publishing, set these env vars in `backend/.env`:
- `PACKAGE_ID` — the package ID from publish output
- `VAULT_OBJECT_ID` — the shared Vault object ID
- `OWNER_CAP_ID` — the OwnerCap object ID (transferred to your deployer address)

## Why OwnerCap?

On account-based chains (Ethereum, Solana), "only the owner can do this" lives in mutable application code (`require(msg.sender == owner)`). On Sui, possessing the right object IS the authorization — the runtime enforces it before your code runs.

This is the Sui-specific argument for why Veto belongs on Sui: the authorization boundary is enforced by the chain itself, not by app code that could be patched or bypassed.
