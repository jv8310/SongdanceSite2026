# SpeelWijs — photo library

All 13 photographs from the brochure, extracted at native quality and
re-encoded to web-optimized **WebP** (long edge ≤ 1920px, q82). Total ≈ 4.1 MB.

- **Location in repo:** `public/speelwijs/photos/`
- **Served at:** `/speelwijs/photos/<name>.webp` (static, same origin)
- **Contact sheet (all 13 at a glance):** `docs/speelwijs-handover/reference/photo-contact-sheet.png`

> In the brochure every photo is shown **faded/washed-out** as a full-bleed
> background behind the quoted chapter title. These extracted files are the
> **full-colour, sharp originals** — apply your own treatment (a soft cream
> wash, a duotone, a gradient scrim for text legibility, etc.). All are
> **portrait** orientation except where noted, shot on phones in natural light —
> warm, candid, real. No stock. Keep that honesty.
>
> The map below is the brochure's own photo→chapter pairing. It's a strong
> default, but you're free to re-assign — several photos are interchangeable
> heroes. All children are recognizable; this is a private client preview so
> that's fine here, but if it ever goes public, faces may need consent review.

| # | File | Orientation | Shows | Brochure pairing |
|---|------|-------------|-------|------------------|
| 01 | `01-cover-boy-and-stone.webp` | portrait | A boy crouched in grass, peering intently at a large smooth boulder | **Cover hero** |
| 02 | `02-tree-climb-seaside.webp` | portrait (largest, 1440×1920) | Blond toddler climbing a low seaside tree, sea on the horizon | Welcome `'SPEELWIJS'` |
| 03 | `03-two-boys-in-bushes.webp` | portrait | Two boys deep inside green laurel bushes, exploring | `'WEET JE WAT IK WIL?'` (inner wisdom) |
| 04 | `04-wooden-blocks-indoor.webp` | portrait | Boy absorbed in stacking natural wooden blocks on the floor | `'ALS IK HET MAG ZEGGEN'` (listening) |
| 05 | `05-sandplay-with-cone.webp` | portrait | Child in the sandpit, paper crown on, digging by a traffic cone | `'SPELEN IS MIJN WERK'` (play) |
| 06 | `06-mud-play-raincoat-truck.webp` | portrait | Child in a red raincoat scooping mud into a toy truck, in the rain | `'JOEPIE, HET REGENT'` (rain / outside) |
| 07 | `07-napping-rest.webp` | portrait | Child asleep under a pink blanket in soft light | `'NOG EEN KEER...'` (rhythm & rest) |
| 08 | `08-gemstone-mandala.webp` | portrait | Girl laying coloured gemstones into a carved wooden mandala board | `'MAMA, GA JE MEE'` (ritual / community) |
| 09 | `09-facilitator-in-garden.webp` | portrait (1286×1714) | A facilitator kneeling among children in the sunny garden — the only adult-with-children shot | `'WIE ZORGT ER VOOR MIJ'` (the founders) |
| 10 | `10-chalk-drawing-group.webp` | portrait | A group of children chalk-drawing on the courtyard paving | `'HOE ZIT DAT NU PRECIES?'` (practical) |
| 11 | `11-rainbow-arch-blocks.webp` | portrait | Boy lining up rainbow wooden arch blocks across the floor | `'JA, IK KOM NAAR SPEELWIJS'` (FAQ / yes) |
| 12 | `12-pikler-climbing.webp` | portrait | Toddler climbing a wooden Pikler frame by a lace-curtained window | `'VOEL JIJ HET OOK?'` (closing feeling) |
| 13 | `13-feeding-donkey-and-sheep.webp` | portrait | Child at the fence feeding a donkey and a sheep in the meadow | Back cover / animals / footer |

## Notes for use

- **Best full-bleed heroes** (most depth / negative space for overlaid type):
  `02-tree-climb-seaside`, `10-chalk-drawing-group`, `09-facilitator-in-garden`,
  `01-cover-boy-and-stone`, `13-feeding-donkey-and-sheep`.
- **Quiet / tender** (good for calm sections — rhythm, listening, closing):
  `07-napping-rest`, `04-wooden-blocks-indoor`, `08-gemstone-mandala`,
  `12-pikler-climbing`.
- **Play / energy** (movement, mess, joy): `05-sandplay-with-cone`,
  `06-mud-play-raincoat-truck`, `03-two-boys-in-bushes`, `11-rainbow-arch-blocks`.
- `09-facilitator-in-garden` is the **only photo with an adult** — use it for
  the founders / "who cares for me" section or an "about us" band.
- All are portrait, so a full-viewport landscape hero needs `object-fit: cover`
  with a sensible `object-position` (faces sit upper-third in most). The cover
  photo works well at `object-position: 60% 35%`.
- Need a higher-resolution or differently-cropped version? Re-extract from the
  source PDF with `pdfimages -j` (originals are up to 1556×2074). The source PDF
  is the client's; keep it out of the repo.
