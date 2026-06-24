# Email — Authentic Singing Journey · Origin Story

Jacob's origin story for the **Authentic Singing Journey** (ASJ): Upala, the first
recordings, and how the program began. Written from the brief in
`songdance_email_asj_origin_story_20260624.md`, framed in the site's email shell
(parchment / plum-ink / ember, Georgia, 560px) with two photographs.

**Goal:** clicks to the program page (`/courses/authentic-singing`).
**Voice:** no manufactured urgency, no rescue framing. The 50% discount is named
once, softly, to non-owners only.

## Subject (A/B)

1. How Songdance began
2. **Before any of this, there was Upala** ← recommended (rawer, likely higher open)
3. The story behind the Authentic Singing Journey

**Preheader:** Upala, the first recordings, and a program I almost didn’t believe in.

## Images (already in R2, served publicly)

- Hero — `https://songdance.co/media/library/jacob-upala-speaker.webp`
- Inline — `https://songdance.co/media/library/jacob-upala-singing.webp`

## Preview

After any push to this branch the Preview workflow prints a `*.workers.dev` URL.
The finished email is served there:

- `/email-previews/asj-origin-story.html` — non-owners (50%-off CTA)
- `/email-previews/asj-origin-story-owner.html` — owners (“enjoy another session” CTA)

## The owner / non-owner split

The email ends two ways: owners (already hold ASJ/JAZ) get a warm “thank you —
enjoy another session”; everyone else gets the soft 50%-off invitation. Two ways
to ship that:

### A) Drip — one send (recommended for the ASJ list)

File: **`asj-origin-story.drip.html`**. Paste as the HTML body of a Drip broadcast.
The `{% if subscriber.tags contains "ASJ" or … "JAZ" %}` block does the split in a
single send to the full ASJ list. Set the subject; test-send; go.

- Drip’s `contains` is substring, so `"ASJ"` also matches the `prod_ASJ` purchase
  tag (and `"JAZ"` → `prod_JAZ`). If your account doesn’t expose
  `{{ subscriber.tags }}`, delete the `{% if %}` and use Drip’s conditional-content
  rule on the ASJ / JAZ tags instead — same result.
- The footer carries the postal address + unsubscribe via `{{ unsubscribe_url }}`.
  If Drip auto-appends its own compliance footer, disable it for this send so the
  address/unsub aren’t doubled.

### B) Site broadcasts — two sends split by audience

The site renderer substitutes merge tags but can’t branch on tags mid-email, so the
split is done with **two broadcasts** (`/admin/broadcasts`, format = **HTML**):

| Broadcast | Paste | Audience |
|---|---|---|
| A — Owners | `asj-origin-story.broadcast-owners.html` | **Include** (match ANY): every ASJ/JAZ ownership tag variant |
| B — Non-owners | `asj-origin-story.broadcast-others.html` | **Exclude** those same variants (include left blank = whole list) |

- Tag matching here is **exact** and **match-ANY**, and ASJ/JAZ ownership is spread
  across several literal tags — so list **all the variants** in both the include (A)
  and exclude (B) fields: e.g. `prod_ASJ`, `prod_ASJ_PRO`, `prod_ASJ_end`,
  `prod_JAZ`, `prod_JAZ_PRO`, … Grab the full set from the searchable tag list on
  the compose page (it shows counts); case doesn't matter.
- _(Alternative, if you'd rather not enumerate variants every time: I can switch the
  broadcast audience filter to **contains**-matching — "any tag containing ASJ/JAZ",
  the way Drip's `contains` works — so one entry catches all variants. Say the word.)_
- `{{ subscriber.first_name | default: "there" }}` and `{{unsubscribe_url}}` are
  handled by the renderer; the postal address is already in the footer (not
  doubled). Test-send each before launch.
- Subject/preheader as above. Send window + circuit breaker use the broadcast
  defaults.

## Regenerating

These HTML files are hand-checkable final artifacts. If the copy or design changes,
re-run the generator (kept out of the repo — it lives in the working scratchpad) or
edit the HTML directly; the Drip and both broadcast variants must stay in sync (they
differ only in the CTA block).
