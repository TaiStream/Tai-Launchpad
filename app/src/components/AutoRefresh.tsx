"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Polls the server every `intervalMs` by calling `router.refresh()`, which
 * re-runs the server component (re-fetches Sui RPC) without dropping the
 * client component state. Inserted into a page once.
 */

export default function AutoRefresh({
  intervalMs = 15_000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, router]);
  return null;
}
