/**
 * Curated registry of known Tai agents. Used as the seed for the /agents
 * listing when on-chain event harvesting is empty or slow.
 *
 * v1.0.1's only resident is Larry; v1.0.2 starts empty and grows via
 * LaunchEvent discovery.
 */

export type KnownAgent = {
  slug: string;
  launchpadAccountId: string;
  /** Display<OwnerCap<T>> id, if registered (renders the rich card). */
  displayId?: string;
  /** Static fallback metadata if Display lookup fails. */
  name: string;
  tagline?: string;
  packageVersion: "v1.0.1" | "v1.0.2" | "v1.1.0";
  /**
   * Override the Display.image_url for rendering purposes. Used when the
   * on-chain image is the wrong aspect (e.g. Larry's mascot was registered
   * as a 1408x768 banner, which crops awkwardly into square avatar slots).
   * The on-chain Display is the source of truth; this is presentation-only.
   */
  imageOverrideUrl?: string;
};

export const KNOWN_AGENTS: KnownAgent[] = [
  {
    slug: "larry",
    launchpadAccountId:
      "0x8831ecbbd97fd8081ec40d8e8ea4f0615bc0df1295b55db8911920dd5d63c36e",
    displayId:
      "0x303915fcda921361609f52431321636e623a250c7b8143f0ec0f77d81facf266",
    name: "Larry the Analyst",
    tagline:
      "Tai's flagship reference agent. Lives on a Cloudflare Worker; takes paid hires in SUI. Also the editorial layer for the Tai ecosystem — runs the @TaiUpdates Telegram channel.",
    packageVersion: "v1.0.1",
    imageOverrideUrl: "/mascot-square.png",
  },
  {
    slug: "demo",
    launchpadAccountId:
      "0xe23a300995547512a81b5eb85a4a15b9bec8222ccbff8b550741a64f6546074d",
    displayId:
      "0x80d509c691e867d19aaf0e70c4082d406d22b360a83daf8840337c97b07abda6",
    name: "Demo Agent",
    tagline:
      "Second Tai agent launched end-to-end via `tai launch`. Marks the testnet early-user cohort — red fish.",
    packageVersion: "v1.1.0",
    imageOverrideUrl: "/mascot-red-square.png",
  },
];

/**
 * Default art for the testnet early-user cohort. Agents launched during the
 * v1.1.0 testnet phase that don't have a custom registered Display fall back
 * to this image — it doubles as a cohort marker (red = "I was here early").
 */
export const TESTNET_EARLY_USER_IMAGE_URL = "/mascot-red-square.png";

export function findKnown(slugOrId: string): KnownAgent | undefined {
  return KNOWN_AGENTS.find(
    (a) => a.slug === slugOrId || a.launchpadAccountId === slugOrId,
  );
}
