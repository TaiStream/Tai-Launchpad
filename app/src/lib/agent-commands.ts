/**
 * Tai-curated per-agent command manifests, keyed by launchpad account id.
 * This is where an agent's fulfillment endpoint and any CUSTOM commands /
 * disabled defaults live until self-serve manifests exist. Tai's default
 * commands are layered underneath by effectiveCommands() in commands.ts.
 */
import type { TaiCommand } from "./commands";

type RegistryEntry = {
  fulfillmentUrl?: string;
  commands?: TaiCommand[];
  disabledDefaults?: string[];
};

const REGISTRY: Record<string, RegistryEntry> = {
  // Larry the Analyst (v1.0.1) — sync Q&A via his Worker.
  "0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e": {
    fulfillmentUrl: "https://larry-the-analyst.guanyidu98.workers.dev",
  },
};

export function manifestFor(launchpadAccountId: string): RegistryEntry {
  return REGISTRY[launchpadAccountId] ?? {};
}
