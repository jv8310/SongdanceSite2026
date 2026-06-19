# Songdance site — notes for Claude

Astro site deployed to Cloudflare Workers. Media (images) live in an R2 bucket
(`songdance-media`, bound as `MEDIA`) and are served publicly at `/media/<key>`.

## Navigation — one menu, three renderings

The site menu has a single source of truth: [`src/data/nav.ts`](src/data/nav.ts)
(the Courses table-of-contents + top-level links + CTA). It feeds three places,
which must stay in sync — edit the data, not the markup:

- **Main header** (`src/components/Nav.astro`, used via `SiteLayout`): desktop
  Courses dropdown + a mobile drawer that renders the full structured menu.
- **Bespoke landing pages** carry their own minimal header (e.g. `WENav`,
  `MCNav`, retreat navs) with no site nav. Each of those navs renders a
  `data-sm-trigger` menu button **and** `<SiteMenu />`
  (`src/components/SiteMenu.astro`) — a slide-in panel with the same menu, on
  desktop and mobile. **Any new landing nav must do the same** so the menu is
  always reachable. `SiteMenu` is placed *after* `</nav>` (outside the nav's
  backdrop-filter, or its `position:fixed` panel would be trapped); the trigger
  uses `color: inherit` so it reads on light and dark headers alike.

Course price labels in the menu carry `data-sd-price` so `PriceSync` localizes
the currency (workshop ticket + masterclass only).

## Typography law — inline italics must be sized UP

The display/lyric font **Cormorant Garamond** (`--font-lyric`) optically reads
**noticeably smaller** than the Figtree body (`--font-body`) and the Spectral
display (`--font-display`) it sits inside — same `font-size`, smaller-looking
letters. So **whenever an inline `<em>` (or any element) swaps to the lyric
font inside body or heading text, you MUST size it up — never leave it at
`1em`.** Use roughly **`1.2–1.35em` inside body/sans text** and **`~1.05em`
inside a Spectral display heading**. An un-bumped Cormorant italic word in a
sentence looks shrunken and wrong (e.g. a tiny "*can't dance*"). This applies to
every page and component, not just the journeys — check it on first design.

## Copy book — READ THIS FIRST before any page work

**Before creating or editing any page, email, or post, you MUST consult
[`docs/svh-copy-book.md`](docs/svh-copy-book.md).** It is the single source of
truth for the site's voice, headlines, paragraphs, quotes, and the non-negotiable
rules of the practice (Somatic Vocal Healing). No page should be written or
changed without first pulling language and direction from it.

The four laws it enforces (never break these in any string on the site):

1. The sound **of** something, never *for* it (one named exception — chapter 35).
2. **Acknowledgment** — never "release" or "letting go" as the mechanism.
3. **Sounding**, not singing.
4. Facilitators **hold space**; the participant heals themselves.

Also: no outcome promises, no rescue framing, and **never** the words "Hamer"
or "German New Medicine" anywhere, in any string. Prices and program
structures do not live in the copy book — only the practice itself.
Marketing mechanics (discounts, deadlines, seat counters, "X places left")
are a separate craft from the copy: allowed in moderation, not governed by
the copy book.

## Email lifecycle (workshops)

All automated workshop email lives in the workshop engine:

- **Words**: `src/lib/workshops/emails.ts` (every template; copy-book rules apply)
- **Cadence**: `src/lib/workshops/cron.ts` (5-min cron; idempotent claims, staleness
  guards, sequence chaining, suppression checks)
- **Sequences**: abandoned checkout ×2 · confirmation + 7 reminders · attended ×3
  (12-week course, riding the 48h/20% participant-discount window from
  `src/lib/courses/twelve-week.ts`) · attended-PRO ×3 (certification path;
  masterclass attendees now, `is_pro` column when it lands) · no-show ×3 ·
  downsell ×2
- **Unsubscribe**: `src/lib/email/unsubscribe.ts`, `/unsubscribe`,
  `/api/unsubscribe` (RFC 8058 one-click), `email_suppressions` table. Marketing
  sends honor it; transactional (confirmation/reminders) always deliver.
- **Review**: `/admin/emails` previews every email with sample data + test-send.
- **Engagement stats**: every send is recorded in `email_sends` (keyed on the
  Resend message id) by `sendEmail`'s `track` option; the Resend event webhook
  (`/api/webhooks/resend`, Svix-signed via `RESEND_WEBHOOK_SECRET`) folds
  delivery/open/click/bounce/complaint events back onto the row. Open & click
  rates per email type show on `/admin/emails/stats`. To light it up: enable
  open+click tracking on the sending domain in Resend, add the webhook endpoint,
  and set the signing secret. `variant` column is the seed for future A/B tests.
- **Timezone-aware sending**: non-urgent mail (early reminders 7d/2d/1d + all
  lifecycle marketing) is held to the recipient's local 08:00–21:00 window
  (`withinSendWindow` in `src/lib/workshops/time.ts`, keyed on the registrant's
  IANA timezone, falling back to the workshop's display tz). Time-critical mail
  always goes on schedule: imminent reminders (6h→start) and the discount-
  deadline emails (`urgent` steps). The discount emails compute their
  hours-remaining figure at send time, so the number is true even after an
  overnight hold.
- **Sanctioned urgency exception** (owner's call, June 2026): discount-deadline
  emails may name the deadline plainly and the final one may be a "last chance"
  send. Keep it factual — no fake scarcity, no countdown theatrics. Marketing
  sends are from `MARKETING_FROM` (Jacob), reply-to `support@songdance.co`.

## Broadcasts — one-off marketing to a standalone contact list

Separate from the workshop lifecycle: a `contacts` list (imported from a CSV,
e.g. a Drip export) and one-off `broadcasts` sent to it. Lives in
[`src/lib/broadcasts/`](src/lib/broadcasts/) and three admin pages
(`/admin/contacts`, `/admin/broadcasts`, `/admin/broadcasts/[id]`). Tables in
`migrations/0047_broadcasts.sql`: `contacts`, `broadcasts`,
`broadcast_recipients`.

- **Import**: `/admin/contacts` parses the CSV in the browser (auto-detecting
  email / name / timezone / country headers) and posts it in chunks, so 55k
  streams in with a progress bar. Re-importing an address updates, never dups.
- **Timezone is everything here**: the import stores each contact's IANA
  timezone (validated; bad/blank → null → default window) so the send rides the
  same `withinSendWindow` 08:00–21:00 gate as lifecycle mail — truly local.
- **Compose / preview / test**: a broadcast is a draft with a **live preview**
  (the compose pages POST to `/api/admin/broadcasts/preview`, which renders the
  unsaved fields server-side). Two `format`s: `simple` (subject, heading,
  preheader, body paragraphs, optional hero + CTA) wrapped in the shared email
  `shell()` (exported from `emails.ts`); or `html` (paste a full email — `body`
  is used as-is). `{{first_name}}` substitutes everywhere; in `html` mode
  `{{unsubscribe_url}}` does too (absent → a footer is appended). Optional
  `body_text` overrides the auto plain-text part. Same copy-book rules apply to
  the words. Test-send before launch.
- **Send window is per-broadcast** (`window_start_hour`/`window_end_hour`,
  default 08:00–21:00 local). Widen it to push faster — but the real throughput
  lever is `MAX_PER_RUN` in `cron.ts`. Each recipient is only mailed inside the
  window for their own timezone.
- **Launch → cron drain**: launch snapshots sendable contacts (minus
  suppressions) into `broadcast_recipients`; `runBroadcasts` (in
  `src/lib/broadcasts/cron.ts`, wired into the 5-min cron) claims a paced,
  in-window batch each tick (`MAX_PER_RUN`/`SEND_GAP_MS`), so a big list spreads
  over days rather than blasting at once. Idempotent atomic claims; transient
  failures retry, then park as `failed`.
- **Circuit breaker**: once a real sample is out, the cron auto-pauses a
  broadcast if complaint/bounce rates cross threshold — a dormant list that's
  gone sour stops instead of burning the domain. Pause/resume by hand too.
- **Feedback**: each broadcast tracks under `email_type = broadcast_<id>` in
  `email_sends`, so open/click/bounce/complaint flow in from the Resend webhook.
  Per-broadcast stats show on its detail page; the rollup shows on
  `/admin/emails/stats` under "Broadcasts" (`emailTypeMeta` knows the prefix).
- **Compliance**: every send honours `email_suppressions` (re-checked at send
  time), carries the RFC 8058 one-click `List-Unsubscribe` header, and a footer
  unsubscribe link — same plumbing as lifecycle marketing.

## R2 image library — how to view and use images

The bucket holds two kinds of images:

- `library/…` — general images uploaded via the admin image manager
- `events/…` — event-card pictures (renaming/deleting one breaks its card)

The library also accepts **short, self-hosted video** (MP4/WebM, ≤70 MB) for
background/accent clips — uploaded the same way, served at `/media/<key>`, and
embedded on a page with `<video src="/media/library/<name>.webm" muted loop
playsinline>`. The serving route honours HTTP Range so video seeks/plays. Longer
or watch-with-sound video still belongs on Vimeo (see
`src/components/forgiveness/FCVideo.astro`). The CLI helper and manifest list
videos alongside images; `pull` downloads their bytes the same way.

There is **no Cloudflare credential in the dev container**, so don't reach for
`wrangler r2`. Instead use the public, read-only manifest + the CLI helper:

```bash
# What's in the bucket? (newest first; folders summary at the top)
node scripts/r2-library.mjs list
node scripts/r2-library.mjs list hero --prefix library/   # filter by name + folder

# Pull images down so you can actually look at them with the Read tool.
# They land in .r2-library/ (gitignored).
node scripts/r2-library.mjs pull hero
node scripts/r2-library.mjs pull --limit 12               # newest 12 to eyeball

# Just the URLs to paste onto a page:
node scripts/r2-library.mjs urls --prefix library/
```

Workflow to **use an image on a page**:

1. `list` / `pull` to find the right image, then `Read` the pulled file to
   confirm what it actually shows before using it.
2. Reference it on a page by its public path: `/media/library/<name>.webp`
   (the `url` field in the manifest). No import needed — it's served by the
   worker, same origin.

The manifest endpoint itself: `GET /api/library/manifest.json`
(`?prefix=library/`, `?limit=20`). It's public and returns `{ count, folders,
images[] }` where each image has `key`, `size`, `uploaded`, `contentType`,
`url` (`/media/<key>`) and `absoluteUrl`.

The CLI defaults to `https://songdance.co`; override with
`SONGDANCE_BASE_URL` or `--base` (e.g. a `*.workers.dev` preview URL).

## Preview link — always share one after pushing

Every push to a non-`main` branch triggers the **Preview** workflow
(`.github/workflows/preview.yml`): it uploads a Cloudflare preview version of
the worker and prints its `*.workers.dev` URL in the run log / job summary.
After pushing work, **always** fetch that URL (wait for the run to finish,
pull it from the "Upload preview version" step log) and include the clickable
preview link in your reply — Jacob expects one with every change. The preview
shares production bindings (D1, R2), so it shows real data without touching
the live deployment.
