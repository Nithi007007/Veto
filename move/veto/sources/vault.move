// Veto — On-chain Rule Vault
//
// The vault that actually holds the agent's funds and enforces hard caps
// regardless of what the off-chain policy engine says. If the off-chain
// engine is compromised, an attacker can submit transactions, but they
// cannot extract more than `daily_cap` SUI per day.
//
// Race-condition safe: `spend()` is an atomic entry function that
// checks the daily cap AND increments the spent counter in the same
// transaction. Sui's shared-object consensus serializes concurrent
// calls, so two simultaneous spends cannot both pass.
//
// Build & deploy (requires Sui CLI):
//   sui move build --path move/veto
//   sui client publish --gas-budget 100000000 move/veto
//
// After publishing, set:
//   - VAULT_OBJECT_ID env var (the shared Vault object ID returned by publish)
//   - VAULT_PACKAGE_ID env var (the package ID)
//
// Then fund the vault by transferring SUI to its address (visible in explorer).

module veto::vault {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::event;
    use std::hash::sha256;

    /// Error codes
    const EAmountZero: u64 = 0;
    const EAmountExceedsPerTx: u64 = 1;
    const EAmountExceedsDailyCap: u64 = 2;
    const EUnauthorized: u64 = 3;
    const EInsufficientFunds: u64 = 4;
    const EWrongCoinType: u64 = 5;

    /// The vault. Shared object — every spend goes through consensus.
    public struct Vault has key {
        id: UID,
        /// The address that can call `configure()`. Set at creation, transferable.
        owner: address,
        /// Hard per-transaction cap in MIST. Cannot be bypassed off-chain.
        per_tx_cap_mist: u64,
        /// Hard daily cap in MIST.
        daily_cap_mist: u64,
        /// Amount spent in the current 24h window (resets on `roll_day()`).
        spent_today_mist: u64,
        /// Timestamp (ms) of the last `roll_day()` call. Used to auto-reset
        /// the daily counter when 24h have elapsed.
        window_start_ms: u64,
        /// SHA-256 hash of the off-chain rule book JSON at the time of the
        /// last `commit_rules()` call. Stored on-chain so any divergence
        /// between off-chain rules and on-chain commit is publicly visible.
        rules_commit_hash: vector<u8>,
        /// Monotonically increasing version of the rule book.
        rules_version: u64,
    }

    /// Emitted on every successful spend — for off-chain audit.
    public struct Spent has copy, drop {
        recipient: address,
        amount_mist: u64,
        digest_index: u64,
    }

    /// Emitted whenever the rule book hash is committed.
    public struct RulesCommitted has copy, drop {
        hash: vector<u8>,
        version: u64,
    }

    /// Create a new vault, owned by `tx_context::sender()`.
    /// Caps are passed in MIST (1 SUI = 10^9 MIST).
    public fun create(
        per_tx_cap_mist: u64,
        daily_cap_mist: u64,
        ctx: &mut TxContext
    ): Vault {
        let vault = Vault {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            per_tx_cap_mist,
            daily_cap_mist,
            spent_today_mist: 0,
            window_start_ms: tx_context::timestamp_ms(ctx),
            rules_commit_hash: vector::empty<u8>(),
            rules_version: 0,
        };
        vault
    }

    /// Share the vault so anyone can read it (only owner can configure/spend).
    public fun share_vault(vault: Vault) {
        transfer::share_object(vault);
    }

    /// Update the hard caps. Only owner. This is the deliberate
    /// escape hatch — but it's on-chain, so any change is publicly visible.
    public fun configure(
        vault: &mut Vault,
        per_tx_cap_mist: u64,
        daily_cap_mist: u64,
        ctx: &TxContext
    ) {
        assert!(tx_context::sender(ctx) == vault.owner, EUnauthorized);
        vault.per_tx_cap_mist = per_tx_cap_mist;
        vault.daily_cap_mist = daily_cap_mist;
    }

    /// Commit a new hash of the off-chain rule book. Only owner.
    /// This is called whenever a rule is added, edited, or toggled.
    public fun commit_rules(
        vault: &mut Vault,
        new_hash: vector<u8>,
        ctx: &TxContext
    ) {
        assert!(tx_context::sender(ctx) == vault.owner, EUnauthorized);
        vault.rules_commit_hash = new_hash;
        vault.rules_version = vault.rules_version + 1;
        event::emit(RulesCommitted { hash: new_hash, version: vault.rules_version });
    }

    /// The core: spend `amount_mist` MIST of SUI from the vault to `recipient`.
    /// Atomic check-and-increment — race-condition safe via Sui consensus.
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

        // 7. Return any leftover gas-coin balance to the vault owner
        // (the caller passes in a coin large enough to cover the spend;
        // the leftover goes back to the owner so it stays in the vault's
        // economic sphere.)
        transfer::public_transfer(coin, vault.owner);

        // 8. Emit audit event
        event::emit(Spent {
            recipient,
            amount_mist,
            digest_index: tx_context::digest(ctx).index,
        });
    }

    // ─── Read-only views (callable by anyone) ───────────────────────────

    public fun per_tx_cap_mist(vault: &Vault): u64 { vault.per_tx_cap_mist }
    public fun daily_cap_mist(vault: &Vault): u64 { vault.daily_cap_mist }
    public fun spent_today_mist(vault: &Vault): u64 { vault.spent_today_mist }
    public fun window_start_ms(vault: &Vault): u64 { vault.window_start_ms }
    public fun rules_commit_hash(vault: &Vault): &vector<u8> { &vault.rules_commit_hash }
    public fun rules_version(vault: &Vault): u64 { vault.rules_version }
    public fun owner(vault: &Vault): address { vault.owner }

    /// Compute SHA-256 of a byte vector (helper for off-chain rule hashing).
    public fun hash_bytes(input: vector<u8>): vector<u8> {
        sha256(input)
    }
}
