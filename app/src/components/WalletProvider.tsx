"use client";

/**
 * Client-side wallet provider stack: TanStack Query → SuiClientProvider →
 * WalletProvider from @mysten/dapp-kit. Mounted once at the layout root so
 * every page can pull `useCurrentAccount()` / `useSignAndExecuteTransaction()`
 * without re-creating the QueryClient on each render.
 */

import { ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    SuiClientProvider,
    WalletProvider as DappKitWalletProvider,
    createNetworkConfig,
} from "@mysten/dapp-kit";
import "@mysten/dapp-kit/dist/index.css";

const { networkConfig } = createNetworkConfig({
    testnet: { url: "https://fullnode.testnet.sui.io", network: "testnet" },
});

export default function WalletProvider({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => new QueryClient());
    return (
        <QueryClientProvider client={queryClient}>
            <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
                <DappKitWalletProvider autoConnect>
                    {children}
                </DappKitWalletProvider>
            </SuiClientProvider>
        </QueryClientProvider>
    );
}
