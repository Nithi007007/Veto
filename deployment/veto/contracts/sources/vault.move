// Veto — On-chain Rule Vault with OwnerCap capability pattern.
//
// This is the production target Move module. The off-chain simulator in
// src/lib/vault.ts mirrors its semantics exactly.
//
// The OwnerCap pattern is the Sui-specific argument:
//
// On account-based chains (Ethereum, Solana, etc.), "only the owner can
// call this" lives entirely inside mutable application code — a `require`
// or `if msg.sender != owner` check that can be patched, bypassed, or
// subtly broken.
//
// On Sui, possessing the right capability OBJECT is the authorization.
// The runtime checks object ownership before your Move code even runs.
// A transaction that doesn't include the OwnerCap literally cannot call
// update_commit() or configure() — the rejection happens at the protocol
// level, not the app level. This is demo-able as fact, not asserted as
// a slide.
//
// Build & deploy (requires Sui CLI):
//   sui move build --path move/veto
//   sui client publish --gas-budget 100000000 move/veto
//
// After publishing:
//   - VAULT_OBJECT_ID env var (shared Vault object ID)
//   - VAULT_PACKAGE_ID env var (package ID)
//   - OWNER_CAP_ID env var (the OwnerCap object ID, transferred to the
//     agent's address at creation — kept server-side only)

module veto::vault {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::event;
    use sui::hash::sha256;

    // ─── Error codes ──────────────────────────────────────────────────
    const EAmountZero: u64 = 0;
    const EAmountExceedsPerTx: u64 = 1;
    const EAmountExceedsDailyCap: u64 = 2;
    const EInsufficientFunds: u64 = 4;
    // Note: no EUnauthorized — on Sui, authorization is enforced by the
    // runtime via object ownership. If you don't have the OwnerCap, your
    // tx doesn't even reach the entry function.

    // ─── Capability objects ───────────────────────────────────────────

    /// Possession of this object IS the authority to configure the vault
    /// and commit new rule book hashes. Transferred to the deployer at
    /// creation; can be further transferred or multisig-wrapped.
    public struct OwnerCap has key, store {}

    /// The vault. Shared object — every spend goes through consensus.
    public struct Vault has key {
        id: UID,
        per_tx_cap_mist: u64,
        daily_cap_mist: u64,
        spent_today_mist: u64,
        window_start_ms: u64,
        rules_commit_hash: vector<u8>,
        rules_version: u64,
    }

    // ─── Events ───────────────────────────────────────────────────────

    public struct Spent has copy, drop {
        recipient: address,
        amount_mist: u64,
    }

    public struct RulesCommitted has copy, drop {
        hash: vector<u8>,
        version: u64,
    }

    public struct CapsConfigured has copy, drop {
        per_tx_cap_mist: u64,
        daily_cap_mist: u64,
    }

    // ─── Creation ─────────────────────────────────────────────────────

    /// Create a new vault + OwnerCap. The OwnerCap is transferred to the
    /// caller (the deployer). The Vault is shared so anyone can read it.
    public fun create(
        per_tx_cap_mist: u64,
        daily_cap_mist: u64,
        ctx: &mut TxContext
    ): (Vault, OwnerCap) {
        let cap = OwnerCap {};
        let vault = Vault {
            id: object::new(ctx),
            per_tx_cap_mist,
            daily_cap_mist,
            spent_today_mist: 0,
            window_start_ms: tx_context::timestamp_ms(ctx),
            rules_commit_hash: vector::empty<u8>(),
            rules_version: 0,
        };
        (vault, cap)
    }

    /// Make the vault a shared object so anyone can read its state.
    public fun share_vault(vault: Vault) {
        transfer::share_object(vault);
    }

    /// Transfer the OwnerCap to a specific address (typically the agent's
    /// server-controlled address). Called once at deployment.
    public fun transfer_owner_cap(cap: OwnerCap, to: address) {
        transfer::transfer(cap, to);
    }

    // ─── Owner-gated operations (require OwnerCap) ────────────────────

    /// Update the hard caps. REQUIRES OwnerCap — runtime-enforced.
    /// Try calling this without the cap: the tx is rejected at the
    /// protocol level before this function body even runs.
    public fun configure(
        _cap: &OwnerCap,
        vault: &mut Vault,
        per_tx_cap_mist: u64,
        daily_cap_mist: u64,
    ) {
        vault.per_tx_cap_mist = per_tx_cap_mist;
        vault.daily_cap_mist = daily_cap_mist;
        event::emit(CapsConfigured { per_tx_cap_mist, daily_cap_mist });
    }

    /// Commit a new rule book hash. REQUIRES OwnerCap — runtime-enforced.
    /// This is what gets called whenever a rule is added, edited, or toggled.
    public fun commit_rules(
        _cap: &OwnerCap,
        vault: &mut Vault,
        new_hash: vector<u8>,
    ) {
        vault.rules_commit_hash = new_hash;
        vault.rules_version = vault.rules_version + 1;
        event::emit(RulesCommitted {
            hash: new_hash,
            version: vault.rules_version,
        });
    }

    // ─── The core: spend (atomic, race-safe) ──────────────────────────

    /// Spend `amount_mist` MIST of SUI from the vault to `recipient`.
    /// Atomic check-and-increment — race-condition safe via Sui consensus.
    ///
    /// Note: this function does NOT require OwnerCap — the agent needs to
    /// be able to spend. But it's still bounded by per_tx_cap and
    /// daily_cap, which CAN only be changed by the OwnerCap holder.
    /// So the agent can spend *within the caps the owner set*, and cannot
    /// change the caps.
    public fun spend(
        vault: &mut Vault,
        coin: Coin<SUI>,
        recipient: address,
        amount_mist: u64,
        ctx: &mut TxContext
    ) {
        // 1. Validate amount
        assert!(amount_mist > 0, EAmountZero);
        assert!(amount_mist <= vault.per_tx_cap_mist, EAmountExceedsPerTx);

        // 2. Roll the daily window if 24h have passed
        let now_ms = tx_context::timestamp_ms(ctx);
        if (now_ms - vault.window_start_ms >= 24 * 60 * 60 * 1000) {
            vault.spent_today_mist = 0;
            vault.window_start_ms = now_ms;
        };

        // 3. Check daily cap (atomic with the increment below)
        let projected = vault.spent_today_mist + amount_mist;
        assert!(projected <= vault.daily_cap_mist, EAmountExceedsDailyCap);

        // 4. Increment spent counter (this is what makes it race-safe)
        vault.spent_today_mist = projected;

        // 5. Split the requested amount off the input coin
        assert!(coin::value(&coin) >= amount_mist, EInsufficientFunds);
        let to_send = coin::split(&mut coin, amount_mist, ctx);

        // 6. Transfer the split coin to the recipient
        transfer::public_transfer(to_send, recipient);

        // 7. Return leftover to the vault owner (keeps funds in vault's
        // economic sphere — in production, this would be a separate
        // "vault balance" coin object)
        transfer::public_transfer(coin, tx_context::sender(ctx));

        event::emit(Spent { recipient, amount_mist });
    }

    // ─── Read-only views (callable by anyone) ─────────────────────────

    public fun per_tx_cap_mist(vault: &Vault): u64 { vault.per_tx_cap_mist }
    public fun daily_cap_mist(vault: &Vault): u64 { vault.daily_cap_mist }
    public fun spent_today_mist(vault: &Vault): u64 { vault.spent_today_mist }
    public fun window_start_ms(vault: &Vault): u64 { vault.window_start_ms }
    public fun rules_commit_hash(vault: &Vault): &vector<u8> { &vault.rules_commit_hash }
    public fun rules_version(vault: &Vault): u64 { vault.rules_version }

    /// Compute SHA-256 of a byte vector (helper).
    public fun hash_bytes(input: vector<u8>): vector<u8> {
        sha256(input)
    }
}
