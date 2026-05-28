"use client";

import { ConnectButton as DappKitConnectButton } from "@mysten/dapp-kit";

/**
 * Tai-flavored wrapper over @mysten/dapp-kit's ConnectButton. Keeps the
 * default behavior (modal-based wallet picker, connected-address indicator,
 * disconnect on click while connected) but lets us style the chip to match
 * the rest of the app instead of dapp-kit's stock blue look.
 */
export default function ConnectButton() {
    return (
        <div className="tai-connect">
            <DappKitConnectButton />
            <style>{`
                .tai-connect button {
                    background: rgba(245, 165, 36, 0.12) !important;
                    border: 1px solid rgba(245, 165, 36, 0.5) !important;
                    color: #ffd56b !important;
                    border-radius: 0 !important;
                    font-family: var(--font-mono) !important;
                    font-size: 11px !important;
                    text-transform: uppercase !important;
                    letter-spacing: 0.22em !important;
                    padding: 6px 14px !important;
                    height: auto !important;
                    transition: background-color 0.15s;
                }
                .tai-connect button:hover {
                    background: rgba(245, 165, 36, 0.22) !important;
                }
            `}</style>
        </div>
    );
}
