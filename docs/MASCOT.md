# Tai Mascot — Variation Guide

The Tai mascot is a medieval illuminated-manuscript-style standing fish on parchment. The original (carried over from the og Tai project) is `app/public/mascot.png`.

This doc captures the design space for generating variations — palette, pose, texture, marginalia, archetype packs — and locks the invariants that have to hold across the family so it doesn't drift into incoherence.

If you're generating variants (commissioned art, AI-generated, or a procedural trait system), riff inside these axes. Anything in **"Things to lock"** must not change.

---

## Palette variations (keep the parchment, change the ink)

- **Iron-gall** (current) — blue-gray, default
- **Sepia / aged-brown** — older manuscript feel; default for "sage" agents
- **Vermilion** — red ink, the medieval scribe's rubrication; for "active" or "alarm" states
- **Verdigris green** — oxidized copper; for agents in the "weathered" tier
- **Lapis ultramarine** — the most expensive medieval pigment; for premium / high-NAV
- **Gold leaf accents** — gilded scales for high-cred agents
- **Phosphor amber** — match the landing palette; fish becomes a "terminal entity"
- **Carbon black + cream** — high-contrast monochrome; minimalist variant
- **Sun-bleached / faded** — for dormant agents
- **Cobalt + white Delftware** — porcelain/tile feel; cooler register
- **Risograph CMYK** — three flat layers slightly misaligned; mixes medieval with print-zine aesthetic

---

## Pose / feature variations (the fish doing things)

Each one becomes a character class an agent can adopt:

- **Scholar** — reading a scroll, spectacles
- **Merchant** — holding coins / moneybag, smiling
- **Sage / Mage** — wizard hat, holding a staff
- **Saint** — halo, hands raised
- **Warrior** — sword and shield
- **Bard** — playing a lute
- **Scribe** — quill in fin, hunched over a desk
- **Sovereign** — crowned, on a tiny throne
- **Hatchling** — bursting out of an egg (just-launched agents)
- **Sleeper** — eyes closed, curled (dormant)
- **Procession** — multiple small fish walking in a line behind the main one (community / sub-agents)
- **Mount-rider** — fish riding a turtle, frog, or another fish
- **Standard-bearer** — carrying a banner with the agent's coin symbol
- **Anachronistic worker** — typing on a medieval-rendered CRT, holding a Sui staff, performing alchemy in a cauldron with little token-coins bubbling out

---

## Texture / rendering variations

- **Pure linework** (current)
- **Heavy woodcut** — chunkier blacks, high contrast (Dürer-y)
- **Cross-hatched engraving** — fine line shading; more "scholarly"
- **Wash / watercolor** — softer pigment bleeds; works well for the muted palettes
- **Halftone dots** — the Lichtenstein/comic-print register
- **Pixelated / dithered** — pairs intentionally with the CRT terminal landing aesthetic
- **Stained glass** — geometric leading; rare/premium feel
- **Tapestry / embroidery** — coarser woven texture
- **Stippling / pointillism** — entirely dot-based
- **ASCII rendering** — a pure-text version of the fish for the CLI's `tai --help` banner
- **Wireframe / vector outline** — for "schematic" variants

---

## Marginalia (small decorative elements around the fish)

These are extras the illustration carries, not the fish itself:

- An **illuminated capital "T"** to the side, woven with vines
- A **Latin motto banner**: `PISCIS QUI AMBULAT` ("the fish that walks") or your own
- A **coat-of-arms shield** below the fish (per-agent, holding the agent's coin symbol)
- A **tiny medieval city skyline** in the background — Sui as the kingdom
- **Cosmological diagrams** floating around (zodiac, planets, alchemical symbols)
- **Companion creatures** marginalia-style: turtle (caution), rabbit (speed), lion (power), unicorn (rarity), fox (cunning)
- **Annotations in scribal hand** — `vid. fol. xvii`, `nota bene`, page-corner damage
- **Water stains / foxing / burn edges** for "aged" feel

---

## A combinatorial trait system (NFT-friendly)

If you want hundreds of unique fish without drawing each one:

| Axis | Slots |
|---|---|
| **Palette** | 11 (iron-gall, sepia, vermilion, verdigris, lapis, gold, amber, black, faded, cobalt, riso) |
| **Pose / class** | 12 (scholar, merchant, mage, saint, warrior, bard, scribe, sovereign, hatchling, sleeper, procession, anachronist) |
| **Texture** | 8 (line, woodcut, hatched, wash, halftone, pixel, stained-glass, stipple) |
| **Accessory** | 10 (motto, capital, shield, city, zodiac, turtle, rabbit, lion, unicorn, fox) |
| **Background state** | 4 (clean parchment, foxing, water-stain, burn-edge) |

11 × 12 × 8 × 10 × 4 = **42,240 distinct combinations.** Even with 80% pruned as ugly, you have ~8,000 viable variants. A trait-driven generator could mint them on demand as each agent launches.

---

## Specific archetype packs to commission first

If you want a coherent first set of 5–8 painted variants (vs procedural):

1. **The Larry** — Scholar · sepia · cross-hatched · scroll + spectacles → "analyst agent" template
2. **The Magnus** — Sage · lapis ultramarine · wash · staff + zodiac marginalia → "advisor agent"
3. **The Coin** — Merchant · gold-accented sepia · woodcut · moneybag + coat-of-arms → "trading agent"
4. **The Sentinel** — Warrior · vermilion · heavy woodcut · sword + shield → "watcher / security agent"
5. **The Hatchling** — generic newly-launched, soft cream-parchment, just-hatched pose → universal placeholder for fresh agents (current mascot fills this role)
6. **The Ascended** — Saint · gold leaf · stained glass · halo → high-NAV / high-cred milestone visual
7. **The Glitch** — Standard pose · phosphor amber · pixelated-dithered · corrupted edges → CRT-terminal pairing and "rogue / cypherpunk" agents

---

## Things to lock (so the family stays coherent)

Across all variants, keep:

- **The same fish anatomy** — proportions, the standing-bipedal stance, the eye placement, the basic silhouette
- **The same parchment-or-aged-vellum background register** — even when the "ink" changes, the substrate reads as medieval document
- **The hand-drawn line quality** — no clean Bézier curves; the wobble is part of the charm
- **A consistent inscription convention** — caption line in scribal hand at the bottom, e.g., `pisces ambulans`, `tai · v.i`

Drift on those four and the family fragments. Vary anything else freely.

---

## How variants get used in product

Once we have a working set:

- **Default avatar for new agents** — when an operator doesn't supply `--image` at launch, the SDK assigns a variant deterministically from the agent's coin type hash (so the same agent always gets the same default fish).
- **State-driven art** — high-NAV agents render with gold accents; dormant agents fade; freshly-launched agents show the hatchling pose. The on-chain state drives which variant the UI renders.
- **Agent-as-NFT card** — when `Display<OwnerCap<T>>` ships in v1.5, the wallet shows a card with the variant's art + the agent's name + NAV + hire price.
- **Procession marginalia** — for v2 sub-agent composition, the parent's card shows tiny variants of its children walking behind it in a procession band.

---

## Source

The original mascot was generated for the og Tai project and adopted here as the v1 sigil. File: `app/public/mascot.png` (1408×768 PNG).
