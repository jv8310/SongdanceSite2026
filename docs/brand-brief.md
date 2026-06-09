# Songdance — Brand Brief

A reference for designers working on Songdance materials. Everything here is
drawn directly from the live website's design system, so anything you produce
will sit naturally alongside it.

---

## 1. Brand essence

**Songdance — Somatic Vocal Healing.**

> *"Sound that comes from you, not toward you. The honest sound of what you
> feel, until it's been heard."*

The feeling we're going for, in three words from the design system itself:
**warm, contemplative, embodied.** The guiding image is *"candle-lit, not
clinical."* Think evening light, paper and ink, the human voice — never
sterile, corporate, or techy.

---

## 2. Logo & symbol

Files live in `/public/brand/`:

| Asset | File | Use |
|---|---|---|
| Wordmark (dark) | `logo-wordmark-dark.png` | On light/paper backgrounds |
| Wordmark (white) | `logo-wordmark-white.png` | On dark/night backgrounds |
| Wordmark (vector) | `logo-wordmark.svg` | Scalable master — preferred for print |
| Symbol (orange) | `symbol-orange.png` | Standalone mark, favicon, social avatar, stamps |

- **Wordmark** — the word "Songdance" set as a single hand-drawn, slightly
  irregular script. It reads as personal and handmade, not typeset. Keep its
  natural ink color on light grounds; use the white version on dark.
- **Symbol** — two interlocking curved forms (a mirrored "p/d" pair) in the
  brand terracotta-orange. They suggest two voices / two dancers answering each
  other. On the site it sometimes appears reversed-out (white) inside a small
  orange circular "stamp," rotated a few degrees, as a playful accent.

Usage notes: give the marks generous breathing room, never recolor them outside
the palette below, and don't add borders, drop shadows, or gradients to the
logo itself.

---

## 3. Color palette

The palette is warm and earthy — aged paper, dark plum-ink, and a terracotta
ember as the single accent. Greens and plums are secondary supporting tones.

### Backgrounds — "Paper"
| Name | Hex | Use |
|---|---|---|
| Paper | `#F4ECDF` | Primary page background |
| Paper deep | `#EADFCB` | Panels, alternating sections, footer |
| Paper soft | `#FAF5EA` | Elevated cards, inputs |

### Text & ink — "Ink" (a near-black warmed toward plum)
| Name | Hex | Use |
|---|---|---|
| Ink | `#2A1B2A` | Primary text, headlines |
| Ink soft | `#4A3848` | Secondary / body text |
| Ink quiet | `#7A6A78` | Captions, meta, muted labels |
| Ink whisper | `#B6A8B4` | Faintest text, dividers, dots |

### Accent — "Ember" (terracotta — the brand's signature color)
| Name | Hex | Use |
|---|---|---|
| Ember | `#C9603A` | Primary accent — links, the symbol, highlights |
| Ember deep | `#A14826` | Hover/active accent, eyebrow labels |
| Ember soft | `#EBC9B5` | Tinted chips/tags, text-selection background |
| Ember glow | `#F2DCC9` | Soft accent wash / quote-break backgrounds |

### Secondary tones
| Name | Hex | Use |
|---|---|---|
| Moss | `#5C6A4A` | Green accent (e.g. "course" tags) |
| Moss deep | `#3F4A30` | Darker green text on tint |
| Moss soft | `#C7CDB8` | Green tag/background tint |
| Plum | `#4A2540` | Feature/accent panels, button hover |
| Plum soft | `#C9B4C3` | Plum tag/background tint |

### Dark sections — "Night"
| Name | Hex | Use |
|---|---|---|
| Night | `#1A1018` | Dark/immersive section backgrounds (e.g. retreat band) |
| Night deep | `#0F080E` | Deepest shade |
| Night soft | `#2D1F2C` | Raised elements on dark |

**At a glance:** Paper `#F4ECDF` + Ink `#2A1B2A` + Ember `#C9603A` are the three
colors that define the brand. If you only take three swatches, take those.

---

## 4. Typography

Three typefaces, each with a clear job. All are free / open-license and
available on Google Fonts.

| Role | Typeface | Where it's used |
|---|---|---|
| **Display** | **Spectral** (serif) | Headlines, section titles, hero — the editorial voice. Weights 300–600, roman & italic. |
| **Lyric** | **Cormorant Garamond** (serif, *italic*) | Pull-quotes, lyrical asides, the emotional grace notes. Almost always *italic*, weight 400–500. |
| **Body / UI** | **Figtree** (sans-serif) | Body copy, navigation, buttons, labels, forms. Weights 300–600. |
| Mono *(minor)* | iA Writer Mono / JetBrains Mono → system mono | Tiny technical labels: chapter numbers, metadata, eyebrows. Used sparingly. *Note: not loaded as a webfont — it falls back to the system monospace, so don't lean on it for anything important.* |

A signature move: a Spectral headline often contains one word set in italic
**Cormorant Garamond**, sometimes in plum — e.g. the oversized italic *"you."*
That serif-roman / serif-italic contrast is core to the type personality.

### Type scale (desktop → mobile is fluid/responsive)
| Token | Size | Use |
|---|---|---|
| Hero | 56–112px | Homepage hero headline |
| Display | 40–72px | Large page titles |
| H1 | 36–56px | Page headings |
| H2 | 28–40px | Section headings |
| H3 | 24px | Sub-headings |
| H4 | 20px | Small headings |
| Body large | 19px | Lede / emphasized prose |
| Body | 17px | Default body text |
| Body small | 15px | Secondary text |
| Caption | 13px | Captions |
| Label | 12px | Uppercase eyebrows/labels |

**Eyebrow / label style:** small (11–12px), UPPERCASE, wide letter-spacing
(~0.22em), usually in Ember-deep. Body line-height is generous (~1.6–1.7) for an
unhurried, readable feel. Display headlines are set tight (negative tracking,
~1.05–1.1 line-height).

---

## 5. Iconography

Phosphor Icons, **Light** weight (thin, rounded line icons). Keep icons hairline
and understated — they should whisper, not shout. Match the line weight if you
ever draw custom glyphs.

---

## 6. Imagery treatment

Photography is the emotional core, and it's treated consistently everywhere:

- **Warm desaturation:** a subtle filter (`saturate 0.88`, `contrast 1.02`)
  pulls the color back slightly and adds a touch of contrast — earthy, filmic,
  candle-lit. Avoid punchy, oversaturated, "stock-photo" color.
- **Subjects:** people sounding/singing, nature, retreat settings, warm
  candid portraits. Real and intimate, never posed-corporate.
- **Crops:** intentional and often **portrait-oriented** (≈2:3). Faces are never
  awkwardly landscape-cropped.
- **No decorative borders.** Images sit in soft **rounded corners** (≈10–18px;
  the hero photo uses a tall arch — rounded top, squared bottom).
- On dark sections, photos drop to ~60% opacity under a deep plum-black gradient
  so text stays legible.

---

## 7. UI / finishing details

(Helpful if the designer touches anything interactive or web-facing.)

- **Buttons:** fully rounded "pill" shape. Primary = solid Ink background with
  Paper text; hovers to Plum. Quiet/secondary = transparent with Ink text.
- **Corner radii:** 4px (small), 10px (medium), 18px (large), 28px (xl),
  999px (pill).
- **Shadows:** soft, warm, low-opacity (tinted with the plum-ink, never pure
  black/gray). Subtle elevation, never harsh.
- **Motion:** gentle, slow easing (custom ease-out curves), durations from
  ~180ms up to ~900ms for "breath." Calm and unhurried; honors
  reduced-motion preferences.
- **Spacing:** built on a soft scale — 4, 8, 12, 16, 24, 32, 48, 64, 96, 144,
  200px — with lots of generous whitespace.

---

## 8. Quick "do / don't"

**Do** — warm paper grounds, terracotta accent, editorial serif headlines with
italic grace notes, generous whitespace, intimate filmic photography, hairline
icons.

**Don't** — pure white or cool-gray backgrounds, bright primary colors,
oversaturated photos, heavy/bold sans-serif headlines, hard black shadows,
techy or clinical styling.

---

*Source of truth: this is distilled from the website's design tokens
(`src/styles/tokens.css`) and global styles (`src/styles/site.css`). If you need
the raw values for any element, those two files have everything.*
