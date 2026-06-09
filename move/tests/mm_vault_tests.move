#[test_only]
module tai::mm_vault_tests {
    use sui::test_scenario::{Self as ts};
    use sui::transfer;
    use sui::coin;
    use sui::sui::SUI;
    use tai::mm_vault::{Self, Vault};

    const ADMIN: address = @0xAD;
    const ONE_SUI: u64 = 1_000_000_000;

    #[test]
    fun create_vault_starts_empty() {
        let mut sc = ts::begin(ADMIN);
        let cap = mm_vault::create_vault(100, 200, ts::ctx(&mut sc)); // 1% fee, 2% band
        ts::next_tx(&mut sc, ADMIN);
        let v = ts::take_shared<Vault>(&sc);
        assert!(mm_vault::vault_total_shares(&v) == 0, 0);
        assert!(mm_vault::vault_reserve_value(&v) == 0, 1);
        assert!(mm_vault::vault_fee_bps(&v) == 100, 2);
        assert!(mm_vault::vault_price_band_bps(&v) == 200, 3);
        ts::return_shared(v);
        transfer::public_transfer(cap, ADMIN);
        ts::end(sc);
    }

    #[test]
    fun first_deposit_gets_sane_shares() {
        // first deposit into an empty vault: shares == amount (1:1 via the offset).
        assert!(mm_vault::shares_for(ONE_SUI, 0, 0) == 1_000_000_000, 0);
    }

    #[test]
    fun share_math_resists_first_depositor_inflation() {
        // Attacker seeds a 1-MIST deposit (1 share), then DONATES 10 SUI to NAV
        // without minting shares — the classic vault inflation attack.
        let s_atk = mm_vault::shares_for(1, 0, 0);
        assert!(s_atk == 1, 0);
        let nav_after_donation = 1 + 10 * ONE_SUI; // attacker's 1 MIST + 10 SUI donated

        // A victim then deposits 1 SUI. WITHOUT the virtual offset this rounds to
        // ZERO shares (deposit stolen). WITH it, the victim still gets fair shares.
        let s_victim = mm_vault::shares_for(ONE_SUI, s_atk, nav_after_donation);
        assert!(s_victim > 1_000_000, 1); // non-zero, not dust

        // Sanity: redeeming those shares returns ~the deposit, not ~0.
        let back = mm_vault::assets_for(s_victim, s_atk + s_victim, nav_after_donation + ONE_SUI);
        assert!(back > ONE_SUI / 2, 2);
    }

    #[test]
    fun shares_assets_roundtrip_is_lossless_to_dust() {
        // deposit 5 SUI into an empty vault, redeem all -> get ~5 SUI back.
        let amount = 5 * ONE_SUI;
        let s = mm_vault::shares_for(amount, 0, 0);
        let back = mm_vault::assets_for(s, s, amount);
        assert!(back <= amount && back + 2 >= amount, 0); // exact to <=1 MIST rounding
    }

    #[test]
    fun deposit_then_withdraw_round_trips() {
        let mut sc = ts::begin(ADMIN);
        let cap = mm_vault::create_vault(0, 200, ts::ctx(&mut sc)); // 0% fee for clean math
        ts::next_tx(&mut sc, ADMIN);
        let mut v = ts::take_shared<Vault>(&sc);

        let pay = coin::mint_for_testing<SUI>(2 * ONE_SUI, ts::ctx(&mut sc));
        let pos = mm_vault::deposit(&mut v, pay, ts::ctx(&mut sc));
        assert!(mm_vault::position_shares(&pos) == 2_000_000_000, 0); // 1:1 first deposit
        assert!(mm_vault::vault_reserve_value(&v) == 2 * ONE_SUI, 1);
        assert!(mm_vault::vault_total_shares(&v) == 2_000_000_000, 2);

        let out = mm_vault::withdraw(&mut v, pos, ts::ctx(&mut sc));
        let got = coin::value(&out);
        assert!(got <= 2 * ONE_SUI && got + 2 >= 2 * ONE_SUI, 3); // ~all back, dust retained
        assert!(mm_vault::vault_total_shares(&v) == 0, 4);
        coin::burn_for_testing(out);

        ts::return_shared(v);
        transfer::public_transfer(cap, ADMIN);
        ts::end(sc);
    }

    #[test]
    fun two_depositors_get_proportional_shares() {
        let mut sc = ts::begin(ADMIN);
        let cap = mm_vault::create_vault(0, 200, ts::ctx(&mut sc));
        ts::next_tx(&mut sc, ADMIN);
        let mut v = ts::take_shared<Vault>(&sc);

        let a = mm_vault::deposit(&mut v, coin::mint_for_testing<SUI>(ONE_SUI, ts::ctx(&mut sc)), ts::ctx(&mut sc));
        let b = mm_vault::deposit(&mut v, coin::mint_for_testing<SUI>(3 * ONE_SUI, ts::ctx(&mut sc)), ts::ctx(&mut sc));
        // A deposited 1, B deposited 3 -> shares are 1:3 (no gains between deposits)
        assert!(mm_vault::position_shares(&a) == 1_000_000_000, 0);
        assert!(mm_vault::position_shares(&b) == 3_000_000_000, 1);
        assert!(mm_vault::vault_total_shares(&v) == 4_000_000_000, 2);

        transfer::public_transfer(a, ADMIN);
        transfer::public_transfer(b, ADMIN);
        ts::return_shared(v);
        transfer::public_transfer(cap, ADMIN);
        ts::end(sc);
    }

    #[test]
    fun strike_advances_epoch_and_watermark() {
        let mut sc = ts::begin(ADMIN);
        let cap = mm_vault::create_vault(0, 200, ts::ctx(&mut sc));
        ts::next_tx(&mut sc, ADMIN);
        let mut v = ts::take_shared<Vault>(&sc);

        let pos = mm_vault::deposit(&mut v, coin::mint_for_testing<SUI>(ONE_SUI, ts::ctx(&mut sc)), ts::ctx(&mut sc));
        assert!(mm_vault::vault_epoch(&v) == 0, 0);
        mm_vault::strike_nav(&mut v, &cap, ts::ctx(&mut sc));
        assert!(mm_vault::vault_epoch(&v) == 1, 1);
        assert!(mm_vault::vault_deployed(&v) == 0, 2);

        transfer::public_transfer(pos, ADMIN);
        ts::return_shared(v);
        transfer::public_transfer(cap, ADMIN);
        ts::end(sc);
    }
}
