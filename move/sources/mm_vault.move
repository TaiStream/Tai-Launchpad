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
    use sui::coin::{Self, Coin};
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
    const ENotFlat: u64 = 2;       // deposits/withdrawals/strike require an unwound vault
    const EWrongVault: u64 = 3;    // position/cap belongs to a different vault
    const EZeroShares: u64 = 4;    // deposit too small to mint a share

    public fun e_not_owner(): u64 { ENotOwner }
    public fun e_not_flat(): u64 { ENotFlat }
    public fun e_wrong_vault(): u64 { EWrongVault }

    /// Shared fund object. SUI-denominated for v1.
    public struct Vault has key {
        id: UID,
        /// Idle SUI not currently deployed to the strategy.
        reserve: Balance<SUI>,
        /// Total shares outstanding (internal accounting unit; positions below).
        total_shares: u128,
        /// Settlement epoch counter.
        epoch: u64,
        /// SUI moved out of the reserve into the strategy (BalanceManager). When
        /// non-zero the vault is "deployed" and deposits/withdrawals are paused
        /// (NAV == reserve only holds when flat). Set on deploy (Task 5).
        deployed: u64,
        /// Reserve value at the last settlement — the NAV watermark for fees.
        last_strike_nav: u64,
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
            deployed: 0,
            last_strike_nav: 0,
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

    // ============================ deposit / withdraw / strike ==================

    public struct Deposited has copy, drop { vault_id: ID, depositor: address, amount: u64, shares: u128 }
    public struct Withdrawn has copy, drop { vault_id: ID, shares: u128, amount: u64 }
    public struct Struck has copy, drop { vault_id: ID, epoch: u64, nav: u64, delta: u64, gain: bool }

    /// Deposit SUI for a transferable `VaultPosition`. Allowed only at flat
    /// (unwound) points, where NAV == reserve is clean. Shares are priced at the
    /// pre-deposit NAV.
    public fun deposit(vault: &mut Vault, payment: Coin<SUI>, ctx: &mut TxContext): VaultPosition {
        assert!(vault.deployed == 0, ENotFlat);
        let amount = coin::value(&payment);
        let nav = balance::value(&vault.reserve);
        let shares = shares_for(amount, vault.total_shares, nav);
        assert!(shares > 0, EZeroShares);
        balance::join(&mut vault.reserve, coin::into_balance(payment));
        vault.total_shares = vault.total_shares + shares;
        let vault_id = object::id(vault);
        event::emit(Deposited { vault_id, depositor: ctx.sender(), amount, shares });
        VaultPosition { id: object::new(ctx), vault_id, shares }
    }

    /// Redeem a full position for its pro-rata SUI. Flat-only. The virtual offset
    /// guarantees the payout never exceeds the reserve (dust stays behind).
    public fun withdraw(vault: &mut Vault, position: VaultPosition, ctx: &mut TxContext): Coin<SUI> {
        assert!(vault.deployed == 0, ENotFlat);
        let VaultPosition { id, vault_id, shares } = position;
        assert!(vault_id == object::id(vault), EWrongVault);
        object::delete(id);
        let nav = balance::value(&vault.reserve);
        let amount = assets_for(shares, vault.total_shares, nav);
        vault.total_shares = vault.total_shares - shares;
        event::emit(Withdrawn { vault_id, shares, amount });
        coin::from_balance(balance::split(&mut vault.reserve, amount), ctx)
    }

    /// Settlement: require the vault unwound, advance the epoch, and record the
    /// NAV watermark (reserve). Share price tracks the reserve, so realized P&L
    /// is reflected automatically; this just marks the watermark for the fee
    /// skim (Task 6) and gives a clean settlement point. Owner/keeper-gated.
    public fun strike_nav(vault: &mut Vault, owner_cap: &VaultOwnerCap, _ctx: &mut TxContext) {
        assert!(owner_cap.vault_id == object::id(vault), ENotOwner);
        assert!(vault.deployed == 0, ENotFlat);
        let nav = balance::value(&vault.reserve);
        let prev = vault.last_strike_nav;
        let (delta, gain) = if (nav >= prev) (nav - prev, true) else (prev - nav, false);
        vault.last_strike_nav = nav;
        vault.epoch = vault.epoch + 1;
        event::emit(Struck { vault_id: object::id(vault), epoch: vault.epoch, nav, delta, gain });
    }

    // ============================ accessors ====================================

    public fun vault_total_shares(v: &Vault): u128 { v.total_shares }
    public fun vault_reserve_value(v: &Vault): u64 { balance::value(&v.reserve) }
    public fun vault_fee_bps(v: &Vault): u64 { v.fee_bps }
    public fun vault_price_band_bps(v: &Vault): u64 { v.price_band_bps }
    public fun vault_epoch(v: &Vault): u64 { v.epoch }
    public fun vault_deployed(v: &Vault): u64 { v.deployed }
    public fun owner_cap_vault_id(c: &VaultOwnerCap): ID { c.vault_id }
    public fun position_shares(p: &VaultPosition): u128 { p.shares }
    public fun virtual_shares(): u128 { VIRTUAL_SHARES }
}
