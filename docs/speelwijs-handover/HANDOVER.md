# SpeelWijs landing page — handover brief for Fable

> **Status (July 2026): the page is built.** `src/pages/speelwijs/index.astro`
> now carries the full landing page (hero, all chapters, practical, FAQ,
> contact) following this brief. This document remains the reference for any
> revision: the copy source, photo map, palette, and rules below still govern.

**Read this first.** Everything you need to build a beautiful bespoke landing
page for the SpeelWijs client is gathered here. The heavy lifting — extracting
copy and graphics, sampling the palette, identifying the type, and wiring the
private route — is done. Your job is the design and the build.

---

## 1. What this is (and isn't)

- A **bespoke, private landing page** for an **external client**: *SpeelWijs*,
  a small-scale, child-led play & care space in Belgium ("de plek tussen opvang
  en school" — the place between daycare and school), run under the **EigenWijs**
  umbrella by **Machteld Verheyde** and **Moniek Neumann**.
- It's being built **on Songdance's infrastructure purely for convenience** —
  hosted at **`songdance.co/speelwijs`** — but it has **nothing to do with
  Songdance**. It is shown privately to the client as a proposal.
- **In Dutch.** Language is `nl` (Belgian, `nl_BE`).
- **The Songdance copy-book does NOT apply.** None of the Somatic Vocal Healing
  rules (sounding-not-singing, hold-space, "the sound of", the banned words,
  etc.) are relevant. Different brand, different voice. Ignore all of it here.

## 2. Hard requirements — already handled for you ✅

You don't need to touch any of this; it's wired and verified in the build:

- **Invisible to search / robots.** `noindex, nofollow, noarchive` is set in the
  layout `<head>`; `/speelwijs` is `Disallow`-ed in `public/robots.txt` (both
  the `*` group and the AI-crawler group); and it is deliberately **absent from
  `sitemap.xml`** (which is a hand-curated list). No crawler or Google will find
  it.
- **No Songdance chrome.** The page uses a **standalone layout**
  (`src/layouts/SpeelWijs.astro`) — no site nav, no footer, no promo bar, no
  `PriceSync`, none of the site's global CSS. A blank, warm canvas.
- **The route exists and builds.** `src/pages/speelwijs/index.astro` renders a
  tasteful holding hero today. `npm run build` passes and emits
  `/speelwijs/index.html` + the photos. **Replace the page body wholesale** when
  you build the real thing — keep using the `SpeelWijs` layout (or fold its
  head/tokens into your own if you prefer, just preserve the noindex + fonts).

If you *do* add more pages under `/speelwijs/...`, they inherit the robots
Disallow automatically (it's a path prefix). Keep every one of them on the
noindex layout.

## 3. Where everything lives

```
public/speelwijs/photos/            13 web-optimized webp photos  → /speelwijs/photos/*.webp
src/layouts/SpeelWijs.astro         standalone noindex layout + design tokens (CSS vars)
src/pages/speelwijs/index.astro     the page (holding hero for now — build here)
public/robots.txt                   /speelwijs Disallow-ed (done)

docs/speelwijs-handover/
├── HANDOVER.md                     this brief
├── copy-nl.md                      ← every string, verbatim NL. Lift as-is.
├── photos.md                       ← the 13 photos: names, contents, section map
└── reference/
    ├── photo-contact-sheet.png     all 13 photos at a glance
    ├── wordmark-speelwijs.png      hi-res crop of the "SpeelWijs" logotype
    ├── heading-serif-sample.png    the rose heading + body serif
    └── pdf-raw-text.txt            raw text dump of the whole brochure
```

## 4. The brand voice

Warm, calm, poetic, unhurried. Short lines. A lot of white space and breath.
The spine of the identity is a **child's voice in single quotes** as each
section title — `'WEET JE WAT IK WIL?'`, `'SPELEN IS MIJN WERK'`,
`'JOEPIE, HET REGENT'`. Keep that device; it *is* the brand.

The philosophy (reflect it in the design's restraint, not just the words):
child-led, slow, nature-connected, rhythm & ritual, free play, parents as
partners, "we adapt the environment to the child, not the child to the system."
Nothing loud, corporate, or salesy. It should feel like exhaling.

## 5. Design system

### Palette (sampled from the brochure)

| Token | Hex | Use |
|---|---|---|
| `--sw-terracotta` | `#b87060` | **Headings** — dusty terracotta-rose. The signature colour. |
| `--sw-terracotta-deep` | `#a5594a` | Links, emphasis, hover |
| `--sw-wine` | `#6b3a48` | **Body text** — deep plum-wine (softer than black) |
| `--sw-ink` | `#4a2f2c` | Soft warm near-black, optional |
| `--sw-cream` | `#fbf7f1` | Page ground — warm off-white |
| `--sw-cream-2` | `#f3e9dd` | Deeper cream for alternating bands |
| `--sw-sand` | `#efe6d8` | Soft sand panel |
| `--sw-leaf` | `#6f7d55` | Muted garden-green accent (pulled from the photos) |
| `--sw-white` | `#ffffff` | Type over photos |

The brochure sets text on **pure white/cream** with terracotta headings and
wine body. The photos supply all the other colour (greens, sky, warm skin,
primary toys). Let the photography carry the vibrancy; keep the typographic
canvas quiet and warm. These are defined as CSS variables in the layout.

### Typography

Two families do all the work in the source:

1. **Wordmark / display — a bold slab serif with rounded *ball terminals*.**
   Warm, chunky, storybook. (See `reference/wordmark-speelwijs.png`.) It was set
   in Canva; exact font unconfirmed. Closest matches, in order:
   - **Recoleta** (Bold) — the best visual match, *if* licensed/available.
   - Free web stand-ins: **Fraunces** (currently loaded — soft, variable,
     ball-terminal, warm), **Bitter**, **Zilla Slab**, **Aleo**.
   - For the exact logotype, easiest is to **render "SpeelWijs" in the chosen
     font**, or ask the client for their brand font. The layout currently uses
     **Fraunces** for the wordmark as a tasteful default.
2. **Headings & body — an elegant Garamond old-style serif** (dusty rose caps,
   let(er)spaced). Confident match: **Cormorant Garamond** (already loaded).
   Section titles are **ALL-CAPS, letterspaced (~0.15–0.25em), in terracotta**,
   wrapped in single quotes. Body is the same serif, wine-coloured, generous
   line-height (~1.6).
   - Note: Cormorant runs *light* at body sizes — if body readability suffers,
     step body copy up in size/weight or swap body to **EB Garamond**/**Spectral**
     while keeping Cormorant for the display caps.

`Figtree` is also loaded for any UI/labels/buttons if you want a clean sans for
small functional bits (prices table, form, footer).

> ⚠️ **Type-sizing caution** (a real gotcha on this stack): Cormorant/Garamond
> italics and small caps read *optically smaller* than a sans at the same
> `font-size`. When you drop an inline serif accent into sans/UI text, size it
> up (~1.2–1.3em). Don't leave italic accents at 1em.

### Layout motifs from the brochure

- Full-bleed **portrait photo spreads**, softly faded, with the quoted title
  overlaid — alternating with quiet **text-only pages** on cream.
- Very generous margins and vertical space. Slow rhythm. One idea per screen.
- Left-aligned, ragged-right body; titles often break across two lines.
- Bold the closing line of each section (the "landing" thought) — the brochure
  does this (e.g. *"Het is een voorbereiding op het leven - het is het leven."*).

## 6. Suggested page structure

The brochure is 12 short chapters. For a single scrolling landing page, a
natural flow (map straight from `copy-nl.md`):

1. **Hero** — full-bleed cover photo (`01`), wordmark *SpeelWijs*, subtitle
   *"De plek tussen opvang en school"*, tagline *"Als ik het mag zeggen"*.
2. **Opening / intro** (`'SPEELWIJS'`) — the welcome hook. photo `02`.
3. **Philosophy trio**, as alternating photo/text bands — inner wisdom
   (`'WEET JE WAT IK WIL?'`, `03`), listening (`'ALS IK HET MAG ZEGGEN'`, `04`),
   free play (`'SPELEN IS MIJN WERK'`, `05`).
4. **Outside / nature** (`'JOEPIE, HET REGENT'`, `06`).
5. **Rhythm & ritual** (`'NOG EEN KEER...'`, `07`).
6. **Parents & community** (`'MAMA, GA JE MEE'`, `08`).
7. **The founders** (`'WIE ZORGT ER VOOR MIJ'`, `09`) — Machteld & Moniek; the
   one adult-with-children photo lives here.
8. **Practical & rates** (`'HOE ZIT DAT NU PRECIES?'`, `10`) — this is where
   concrete facts live; see below. A clean, legible block/table — still warm.
9. **FAQ** (`'JA, IK KOM NAAR SPEELWIJS'`, `11`) — 6 Q&As, an elegant accordion
   or a simple two-column list.
10. **Closing + contact CTA** (`'VOEL JIJ HET OOK?'`, `12`, and animals `13`) —
    the emotional close, signed *Machteld en Moniek*, then contact.

You don't have to include all 12 as full sections — you can distil. But the
philosophy sections are the heart; don't cut them down to nothing.

## 7. The concrete facts (get these exactly right)

Everything marketing-y is flexible; these operational facts are not — copy them
precisely from `copy-nl.md` §9 & §11:

- **Group size:** max **8 children per day**.
- **Open:** **2 days/week, 8:30–16:30**, **40 weeks/year** (school weeks).
  Optional **SpeelKampjes** during holidays (billed separately).
- **Rates:** 1 day/week = **€240/month** (10 monthly payments; July & August
  free); 2 days/week = **€480/month** (10 payments). Incl. snacks, excl. lunch.
- **Contract:** min. 6 months or until the child turns 5; renewal subject to
  availability. **Extra day:** €60 (if space).
- **Contact:** Tel. **0491 324742** · **info@eigenwijze.be**

There's a light, legitimate CTA opportunity ("plan a visit / get in touch" —
*"Voor vragen of persoonlijke toelichting kan je ons altijd contacteren"*).
A gentle contact button/section is welcome; hard-sell scarcity is not — that's
off-brand here.

## 8. Do / Don't

**Do**
- Keep it Dutch, warm, slow, photo-led. Let the photography breathe.
- Preserve the single-quote child-voice titles and the bolded closing lines.
- Make it responsive and fast (photos are already optimized; lazy-load below
  the fold, `fetchpriority=high` on the hero only).
- Keep the noindex + standalone layout intact.

**Don't**
- Don't reintroduce any Songdance nav/footer/branding, or the SVH copy-book.
- Don't add it to `sitemap.xml` or relax robots.
- Don't invent facts, prices, or promises. If the source is silent, leave it.
- Don't machine-translate or rewrite the Dutch. Set it, don't edit it.

## 9. How to preview

`npm run build` then open `dist/speelwijs/index.html`, or `npm run dev` →
`http://localhost:4321/speelwijs`. Any push to a non-main branch also produces a
Cloudflare `*.workers.dev` preview (deep-link it to `/speelwijs`).

---

*Prepared as a handover. Copy is verbatim in `copy-nl.md`; photos and their
section map are in `photos.md`; visual references are in `reference/`.*
