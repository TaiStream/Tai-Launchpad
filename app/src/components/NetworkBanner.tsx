"use client";

import { useCurrentAccount, useCurrentWallet } from "@mysten/dapp-kit";

/**
 * Surfaces a red banner when the connected wallet's active chain is not Sui
 * testnet. Without this, the user's transactions silently fail at the wallet
 * level (or worse, go to mainnet and fail there) and they get a confusing
 * "unknown error" instead of "switch your wallet to testnet."
 *
 * @mysten/dapp-kit exposes the connected wallet's chains via the
 * `useCurrentWallet` hook. Most Sui wallets identify chains as
 * `sui:mainnet`, `sui:testnet`, `sui:devnet`. We check that *testnet* is
 * present in the wallet's active chain set.
 */
export default function NetworkBanner() {
    const account = useCurrentAccount();
    const { currentWallet } = useCurrentWallet();

    if (!account) return null;

    // Account chains are an array like ["sui:testnet"] on Sui Wallet, Slush, etc.
    const chains = (account.chains ?? []) as string[];
    const onTestnet = chains.some((c) => c.toLowerCase().includes("testnet"));

    // If we can't determine the chain (some wallets don't expose this
    // reliably), don't show the banner — better than crying wolf.
    if (chains.length === 0) return null;
    if (onTestnet) return null;

    return (
        <div className="border-b border-red/60 bg-red/15 px-5 py-2 text-center text-[12px] text-red-bright md:px-8">
            <span className="font-semibold">wrong network — </span>
            your wallet ({currentWallet?.name ?? "connected wallet"}) is on{" "}
            <code>{chains[0]}</code>, but Tai's pool lives on{" "}
            <code>sui:testnet</code>. Open your wallet and switch the
            network before signing any transaction here.
        </div>
    );
}
