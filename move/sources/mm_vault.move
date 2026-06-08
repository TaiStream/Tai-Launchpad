/// Module: mm_vault
///
/// A rate-bounded, revocable agentic market-making fund. Depositors pool SUI for
/// shares; a manager agent runs a DeepBook MM strategy over the pool through a
/// price-bounded order path; NAV is struck at settlement. See
/// docs/superpowers/specs/2026-06-08-mm-liquidity-vault-design.md and the plan
/// docs/superpowers/plans/2026-06-09-mm-vault.md.
///
/// THIS IS TASK 1 of that plan: the vault scaffold + inflation-attack-safe share
/// math. Deposits/withdrawals (Task 2), NAV strike (Task 3), and the DeepBook
/// manager path (Tasks 4-7) are not here yet. Roadmap / post-audit — not
/// deployed, not for the hackathon.
module tai::mm_vault {
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::event;

    /// Virtual offset (OpenZeppelin ERC-4626 style) that makes the first-depositor
    /// share-inflation attack economically infeasible: to round a victim's deposit
    /// to zero shares, an attacker must donate on the order of VIRTUAL_ASSETS times
    /// the victim's deposit. Set to 1 SUI so the cost is ~1e9× the deposit in MIST.
    /// Tradeoff: introduces a negligible amount of phantom assets/shares in the
    /// price; redemptions are diluted only at the dust level.
    const VIRTUAL_SHARES: u128 = 1_000_000_000;
    const VIRTUAL_ASSETS: u128 = 1_000_000_000;

    const ENotOwner: u64 = 1;

    public fun e_not_owner(): u64 { ENotOwner }

    /// Shared fund object. SUI-denominated for v1.
    public struct Vault has key {
        id: UID,
        /// Idle SUI not currently deployed to the strategy.
        reserve: Balance<SUI>,
        /// Total shares outstanding (internal accounting unit; positions below).
        total_shares: u128,
        /// Settlement epoch counter.
        epoch: u64,
        /// Manager fee on positive NAV delta, in bps.
        fee_bps: u64,
        /// Max deviation (bps) an order's price may have from the reference.
        price_band_bps: u64,
        /// The appointed manager runtime, if any.
        manager: Option<address>,
        /// The vault-owned DeepBook BalanceManager (wired in Task 4).
        balance_manager_id: Option<ID>,
    }

    /// Sovereign control object for a vault (appoint/revoke manager, force-unwind).
    public struct VaultOwnerCap has key, store {
        id: UID,
        vault_id: ID,
    }

    /// A depositor's claim on the vault, transferable. Minted on deposit (Task 2).
    public struct VaultPosition has key, store {
        id: UID,
        vault_id: ID,
        shares: u128,
    }

    public struct VaultCreated has copy, drop {
        vault_id: ID,
        fee_bps: u64,
        price_band_bps: u64,
    }

    /// Open a vault. Returns the sovereign owner cap; shares the Vault object.
    public fun create_vault(
        fee_bps: u64,
        price_band_bps: u64,
        ctx: &mut TxContext,
    ): VaultOwnerCap {
        let vault = Vault {
            id: object::new(ctx),
            reserve: balance::zero<SUI>(),
            total_shares: 0,
            epoch: 0,
            fee_bps,
            price_band_bps,
            manager: option::none(),
            balance_manager_id: option::none(),
        };
        let vault_id = object::id(&vault);
        event::emit(VaultCreated { vault_id, fee_bps, price_band_bps });
        transfer::share_object(vault);
        VaultOwnerCap { id: object::new(ctx), vault_id }
    }

    // ============================ share math (pure) ============================

    /// Shares minted for depositing `amount` MIST when the vault holds `nav` MIST
    /// against `total_shares`. Virtual offset blocks the first-depositor attack.
    public fun shares_for(amount: u64, total_shares: u128, nav: u64): u128 {
        ((amount as u128) * (total_shares + VIRTUAL_SHARES))
            / ((nav as u128) + VIRTUAL_ASSETS)
    }

    /// MIST redeemable for burning `shares` (inverse of `shares_for`).
    public fun assets_for(shares: u128, total_shares: u128, nav: u64): u64 {
        ((shares * ((nav as u128) + VIRTUAL_ASSETS))
            / (total_shares + VIRTUAL_SHARES)) as u64
    }

    // ============================ accessors ====================================

    public fun vault_total_shares(v: &Vault): u128 { v.total_shares }
    public fun vault_reserve_value(v: &Vault): u64 { balance::value(&v.reserve) }
    public fun vault_fee_bps(v: &Vault): u64 { v.fee_bps }
    public fun vault_price_band_bps(v: &Vault): u64 { v.price_band_bps }
    public fun owner_cap_vault_id(c: &VaultOwnerCap): ID { c.vault_id }
    public fun virtual_shares(): u128 { VIRTUAL_SHARES }
}
