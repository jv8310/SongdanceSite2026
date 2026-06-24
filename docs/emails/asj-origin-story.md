# Email — Authentic Singing Journey · Origin Story

Jacob's origin story for the **Authentic Singing Journey** (Upala, the first
recordings, how it began), in the launch-email design system: **Spectral**
(display) / **Cormorant Garamond** (lyric italics) / **Figtree** (body), an ember
announcement ribbon, a plum offer box, and a two-tier footer. Two endings —
owners vs. non-owners.

**Goal:** clicks to `/courses/authentic-singing`. The 30 June deadline is named
plainly (sanctioned launch urgency); no fake scarcity.

## Subject (A/B)

1. How Songdance began
2. **Before any of this, there was Upala** ← recommended (rawer, likely higher open)
3. The story behind the Authentic Singing Journey

**Preheader:** Upala, the first recordings, and a program I almost didn't believe in.

## Files

| Purpose | File |
|---|---|
| Drip — non-owners | `asj-origin-story.drip-others.html` |
| Drip — owners | `asj-origin-story.drip-owners.html` |
| Broadcast — non-owners | `asj-origin-story.broadcast-others.html` |
| Broadcast — owners | `asj-origin-story.broadcast-owners.html` |
| **Seed both broadcast drafts** | `migrations/0051_asj_origin_story_broadcasts.sql` |

**Images** (R2, public): hero = `…/media/library/jacob-upala-speaker.webp` ·
band = `…/media/library/jacob-upala-singing.webp`.

**Preview:** `/email-previews/asj-origin-story` (non-owners) ·
`/email-previews/asj-origin-story-owner` (owners).

## The owner / non-owner split — two ways to ship

### A) Drip — two segment sends

Paste each file as a Drip email's HTML. There is **no inline Liquid logic** — Drip's
HTML editor rejects `{% if subscriber.tags contains … %}` (and even a bare `{% %}`
in a comment), so the split is done by **audience, not template**:

- `…drip-others.html` → a segment that does **not** own ASJ/JAZ (the 50%-off invite).
- `…drip-owners.html` → a segment that **owns** ASJ/JAZ ("enjoy another session").

Footer uses Drip's required tags: `{{ html_postal_address }}` + `{{ unsubscribe_url }}`,
plus the two-tier promo unsubscribe (`/unsubscribe-promo?e={{ subscriber.email | url_encode }}`
to stop just the launch emails, or the full `{{ unsubscribe_url }}`).

### B) Site broadcasts — seeded by migration 0051

**Merge to `main` → `d1-migrate` applies `0051` → two drafts appear in
`/admin/broadcasts`:**

- **"ASJ · Origin Story — non-owners"** — audience **excludes** the ASJ/JAZ tags.
- **"ASJ · Origin Story — owners"** — audience **includes** the ASJ/JAZ tags.

Both are `format = html`, `status = draft` — nothing sends until you launch them.
Review, **set the final tag variants**, test-send, launch. The renderer fills
`{{ subscriber.first_name | default: "there" }}` + `{{ unsubscribe_url }}` and leaves
the literal postal address (it won't double it). Single unsubscribe here — the site
list has no promo tier, unlike Drip.

**Audience tags:** the migration seeds `prod_asj, prod_asj_pro, prod_asj_end,
prod_jaz, prod_jaz_pro` as a starting point. Matching is **exact + match-ANY**, and
ownership is spread across varying tags, so verify/extend the list against your real
tags on the compose page before launch. (Or ask me to switch the broadcast audience
filter to **contains**-matching, so one entry catches every variant like Drip does.)

## Notes

- **Typography law:** inline Cormorant italics are sized up (1.05em in headings,
  1.25em in body) per `CLAUDE.md` — never left at 1em.
- **Fonts** load from Google Fonts where the client allows it; Georgia is the
  fallback everywhere.
- **Regenerating:** these are final, hand-checkable artifacts. All four HTML
  variants **and** the migration are generated from one template (kept in the
  working scratchpad) so they never drift — they differ only in the CTA block and
  the footer tags. For small tweaks, edit the HTML directly and re-embed the
  broadcast bodies into the migration.
