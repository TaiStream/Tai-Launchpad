# Tai Launchpad — Landing Page

Marketing site for [Tai-Launchpad](../). CRT/phosphor terminal aesthetic, agent-native framing, CLI-first.

## Tech

- Next.js 16 (App Router) + React 19
- Tailwind CSS 4 (CSS-first config in `src/app/globals.css`)
- TypeScript 5
- Fonts: VT323 (display) + IBM Plex Mono (body) via `next/font/google`
- All animations are CSS-driven (no Motion library); only the live UTC clock is a client component

## Develop

```sh
cd Tai-Launchpad/landing
npm install
npm run dev
```

Open <http://localhost:3000>.

## Build

```sh
npm run build
npm run start
```

Static-friendly output. Deploy to Vercel, Netlify, GitHub Pages, IPFS, or any Node host.

## Structure

```
landing/
├── src/
│   ├── app/
│   │   ├── layout.tsx        # fonts, metadata, root
│   │   ├── page.tsx          # composes the sections
│   │   └── globals.css       # theme tokens, scanline overlay, animations
│   └── components/
│       ├── Nav.tsx           # sticky top nav (server)
│       ├── LiveClock.tsx     # UTC ticker (client)
│       ├── Hero.tsx          # wordmark + terminal cast (CSS-staggered reveal)
│       ├── Section.tsx       # numbered section wrapper
│       ├── Wedge.tsx         # bags / pump / tai comparison
│       ├── Primitives.tsx    # four primitives
│       ├── CliSurface.tsx    # cli help table + signer matrix
│       ├── Modes.tsx         # sovereign / commissioned / spawned
│       ├── Architecture.tsx  # full stack ASCII diagram
│       ├── Roadmap.tsx       # v1 / v1.1 / v1.5 / v2 entries
│       ├── GetStarted.tsx    # install + docs links
│       └── Footer.tsx        # EOF
├── public/
├── package.json
├── tsconfig.json
├── next.config.ts
└── postcss.config.mjs
```

## Design choices

- **Palette:** warm near-black base (#0a0807), warm cream phosphor text, sharp IBM-3270 amber accents, occasional cyan/mint for semantic moments.
- **Typography:** VT323 (Google) for headline / numbers / wordmark; IBM Plex Mono for body and code. No fallback to system Inter — the terminal aesthetic depends on the typography landing crisp.
- **Effects:** fixed-position CSS scanline overlay + warm phosphor halo gradient + flicker animation on the hero wordmark. All subtle; not pastiche.
- **Animation policy:** CSS-only line-reveal in the hero terminal cast, blinking block cursor on prompts, hover states on cards. No JS animation libraries.
- **Layout:** asymmetric multi-column grids. Numbered section headers (00–07) with terminal prompts (`$ ./section_name`).

## Replace placeholders before going live

- `<org>` in install commands → actual GitHub org
- `https://<org>/tai/install.sh` → real install script URL
- Github / twitter / discord links in the nav and footer
