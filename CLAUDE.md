# Songdance site — notes for Claude

Astro site deployed to Cloudflare Workers. Media (images) live in an R2 bucket
(`songdance-media`, bound as `MEDIA`) and are served publicly at `/media/<key>`.

## Admin login — email + password, multi-user

`/admin/login` takes an **email + password**; the session is an HMAC-signed
cookie (`sd_admin`, 12h) carrying the signed-in email. Logic in
[`src/lib/registrations/auth.ts`](src/lib/registrations/auth.ts); every admin
page/endpoint gates on `verifySession`. Credentials come from env (no DB, no
hashing — same posture as the rest of the site's secrets), merged from:

- **`ADMIN_PASSWORD`** (+ optional **`ADMIN_EMAIL`**, default `jacob@songdance.co`)
  — the owner login, unchanged.
- **`ADMIN_USERS`** — collaborators. Either one `email:password` per line (or
  `;`-separated), e.g. `collaborator@example.com:theirPassword`, **or** a JSON
  array `[{"email":"…","password":"…"}]`. Set it as a secret:
  `wrangler secret put ADMIN_USERS`. Add/remove an admin = edit that secret.

Email match is case-insensitive; passwords compared timing-safe. Old
`admin.…` sessions stay valid across the deploy (verify checks the signature,
not the subject), so nobody is force-logged-out.

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
Marketing mechanics (discounts, deadlines, seat counters, "X places left",
and a measure of genuine urgency) are a separate craft from the copy: allowed
in moderation, not governed by the copy book.

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
  rates per email type show on `/admin/emails/stats`. A spam **complaint** and a
  **permanent (hard) bounce** also add the address to `email_suppressions`
  (reasons `complaint` / `bounced`) so marketing stops; soft/transient bounces
  are left alone, and Resend must report the bounce `type` for the hard-bounce
  suppression to fire (the bounce-check reimport below is the comprehensive
  cleanup). Transactional mail ignores suppression, so this never blocks
  confirmations/reminders. To light it up: enable
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

## Internal reports — daily + weekly "SD-REPORT" digests

Ops-only summary email (NOT customer-facing), sibling to the `SD-ORDER`
notifications. Lives in [`src/lib/workshops/reports.ts`](src/lib/workshops/reports.ts).

- **What it covers** for the window: new **workshop registrations** (paid/coupon,
  per workshop), **course sales** (12-week / certification / grief, per product),
  **bump offers** — both the workshop order bump (`workshop_purchases`) and the
  12-week checkout order bumps (the `bumps` JSON on `course_registrations`) — and
  a **revenue** breakdown that sums them. Numbers reuse the dashboard's own
  `computeStats` + `computeCourseSales` (stats.ts), so a figure here matches
  `/admin/workshops/stats` for the same window.
- **Cadence**: a **daily** digest (covering *yesterday*) every morning, plus a
  **weekly** digest (the 7 days ending yesterday, with a revenue-by-day table)
  every **Tuesday**. Runs on the existing **hourly** cron (no new trigger):
  `runReports` self-gates to the first tick at/after **08:00 Europe/Brussels**,
  so it survives DST and a missed tick is caught up later the same day. Windows
  resolve in Brussels time, matching the stats-page presets.
- **Idempotency**: claims a unique `events` row (`external_id`
  `report-daily-<date>` / `report-weekly-<date>`, kind `report.sent`) before
  sending — once per day even if the cron double-fires; a send failure releases
  the claim so a later tick retries.
- **Recipients**: `REPORTS_TO` (comma/space-separated) → `ORDER_NOTIFICATIONS_TO`
  → `ADMIN_EMAIL` → `jacob@songdance.co`. Sent transactionally (not gated by
  suppression — it's internal).
- **Review**: both digests preview with sample data on `/admin/emails` (group
  "Reports (internal)") with a test-send, same as every other email.
- **D1 param cap**: the stats queries feed `IN (…)` id lists to D1, which caps
  bound params at **100/statement**. Anything binding a data-growing id list
  (payments in a window, all workshop registrations) must chunk it —
  [`src/lib/db/chunked.ts`](src/lib/db/chunked.ts) (`selectByIdsChunked`) is the
  shared helper. Un-chunked, this silently killed the digest on busy days and
  500'd `/admin/orders`.

## SD-ORDER notifications — safety-net reconcile

The internal per-purchase order emails (`src/lib/orders/notification.ts`, course
+ retreat only; workshops never notify) are idempotent on an `events` claim
(`order-notify-<type>-<id>`). A missed webhook/Resend blip could drop one, so the
hourly cron also runs `reconcileOrderNotifications`
([`src/lib/orders/reconcile.ts`](src/lib/orders/reconcile.ts)): it re-sends any
paid course/retreat order in the last 7 days that carries no sent-claim (bounded
per run, idempotent, so steady state is a no-op).

## PayPal payment recognition — safety-net reconcile

Direct-PayPal course orders (`src/lib/payments/paypal.ts` + `paypal-fulfill.ts`)
have an asymmetry: a **one-off** PayPal payment is fulfilled *synchronously* by
the buyer-return handler (`/api/payments/paypal-return`), but an **installment
subscription's** (3×/6×/12×) installments are recorded *only* by the `PAYMENT.SALE.COMPLETED`
webhook — the return handler deliberately skips them (it just mirrors the
subscription's status). So a dropped or unverified webhook (e.g. a missing/wrong
`PAYPAL_WEBHOOK_ID` makes `verifyPaypalWebhook` fail-closed → the endpoint 400s
*every* event, silently) leaves a subscription stuck at `status='pending'`,
`0/N` while PayPal keeps charging the customer — no access, no SD-ORDER,
no Drip. The webhook still 400s so PayPal keeps retrying, but a real delivery
that fails verification now writes a `paypal.webhook.verify_failed` event
(external_id `paypal-verify-failed-<event id>`, with the `reason` —
`no_webhook_id` / `FAILURE` / `verify_error:…`), so the failure is visible in
the `events` log instead of only in PayPal's own webhook dashboard.

The hourly cron therefore also runs `reconcilePaypalCourseOrders`
([`src/lib/payments/paypal-reconcile.ts`](src/lib/payments/paypal-reconcile.ts)):
it finds stranded PayPal course rows — status `pending` **or** `expired` (a
stranded pending row is auto-flipped to `expired` after 15 min by
`expireStaleCoursePendings` on admin page load, so live-but-unrecorded
subscriptions usually sit in `expired`) — and polls PayPal directly — for an
**installment subscription** (3×/6×/12×) it reads the subscription's transactions
(`listSubscriptionTransactions`, `GET /v1/billing/subscriptions/{id}/transactions`)
and records each COMPLETED cycle; for a **one-off** it reads the order and, *only
if a capture already COMPLETED*, fulfils it (never captures — that would charge a
genuinely abandoned checkout). Everything funnels through the same idempotent
fulfillment the webhook uses (`recordCoursePaypalSubscriptionSale` /
`fulfillCoursePaypalOneOff`, guarded on the capture/sale id in `events`), so it
converges with the webhook and can't double-count; steady state (webhook healthy)
is a no-op, and it no-ops entirely until the PayPal secrets are set.
**Setup-fee routing**: order bumps on a PayPal plan charge as the subscription's
`setup_fee`, which PayPal settles as its *own sale* on the same subscription
(alongside cycle 1, same minute — e.g. a £45 grief bump next to the £97.50
cycle). Both the webhook and the reconcile route every subscription sale by
amount (`recordCoursePaypalSubscriptionSale`): only a sale equal to the expected
monthly amount (`amount_cents / installments_total`) bumps `installments_paid`;
anything else is logged as `paypal.course.setup_fee` under the same
`paypal.course.installment.<saleId>` claim so no path ever counts it as a cycle.
Two same-minute PayPal charges on a plan with a bump are therefore *correct*,
not a double charge. Subscription
window is 120 days (a 3× monthly plan runs ~90d); one-offs 7 days. This is a
*backstop*, not the fix — if PayPal subscriptions stall, first check that the
webhook endpoint is registered in the PayPal app, subscribed to
`PAYMENT.SALE.COMPLETED` + `BILLING.SUBSCRIPTION.*`, and that `PAYPAL_WEBHOOK_ID`
matches that same live app.

## Broadcasts — one-off marketing to a standalone contact list

Separate from the workshop lifecycle: a `contacts` list (imported from a CSV,
e.g. a Drip export) and one-off `broadcasts` sent to it. Lives in
[`src/lib/broadcasts/`](src/lib/broadcasts/) and three admin pages
(`/admin/contacts`, `/admin/broadcasts`, `/admin/broadcasts/[id]`). Tables in
`migrations/0047_broadcasts.sql`: `contacts`, `broadcasts`,
`broadcast_recipients`.

- **Import**: `/admin/contacts` parses the CSV in the browser (auto-detecting
  email / name / timezone / country / tags headers) and posts it in chunks, so
  55k streams in with a progress bar. Re-importing an address updates, never
  dups — but an existing **name is never overwritten** (only filled when
  missing), so a verifier re-import can't downgrade good names. Every other
  column is preserved: `tags` is normalized into a
  `contact_tags` table (for fast targeting + counts) and kept as a display
  string; all remaining non-empty columns go into a `custom` JSON blob, so the
  full export is retained and filterable. Rows whose `status` is `unsubscribed`
  are stored but added to `email_suppressions` (so they're never emailed).
  D1 caps bound params at 100/statement, so the batch upsert chunks rows
  accordingly (12 contacts / 45 tag-pairs / 90 emails per statement). Tags are
  only replaced for rows that actually carry a tags value — a tag-less re-import
  (e.g. a verifier file) never wipes a contact's existing targeting tags.
- **Email-verifier re-import** (e.g. MillionVerifier): the import recognises a
  `result`/`quality` verdict column and acts on it — `bad` (invalid / disposable)
  → `email_suppressions` (reason `invalid_address`); `risky` (unknown / catch_all)
  → the `risky` tag, added *additively* so the address can be excluded (or
  segmented) per broadcast without losing its other tags; `good`/blank → no
  action. The raw verdict columns are still kept in `custom`.
- **Timezone is everything here**: the import stores each contact's IANA
  timezone (validated; bad/blank → null → default window) so the send rides the
  same `withinSendWindow` 08:00–21:00 gate as lifecycle mail — truly local.
- **Audience targeting**: a broadcast can include tags (match ANY), exclude
  tags, and one custom-field equals filter (e.g. `Nederlands = No`). The compose
  page lists all your tags with counts — searchable, click to add — and shows a
  live "X contacts match" estimate (`/api/admin/broadcasts/audience`); the launch
  snapshot applies the same `audienceWhere` criteria. Blank = the whole sendable
  list. (Tag fields are free text too — any tag works, listed or not.)
- **Compose / preview / test**: a broadcast is a draft with a **live preview**
  (the compose pages POST to `/api/admin/broadcasts/preview`, which renders the
  unsaved fields server-side). Two `format`s: `simple` (subject, heading,
  preheader, body paragraphs, optional hero + CTA) wrapped in the shared email
  `shell()` (exported from `emails.ts`); or `html` (paste a full email — `body`
  is used as-is). `{{first_name}}` substitutes everywhere (and Drip/Liquid-style
  `{{ subscriber.first_name | default: "there" }}` is understood, honouring the
  default; unknown `{{ … }}` merge tags resolve to their default or are dropped,
  never sent literally); in `html` mode `{{unsubscribe_url}}` does too (absent →
  a footer is appended). Optional
  `body_text` overrides the auto plain-text part. Same copy-book rules apply to
  the words. Test-send before launch.
- **Send window is per-broadcast** (`window_start_hour`/`window_end_hour`,
  default 08:00–21:00 local). Widen it to push faster — but the real throughput
  lever is `MAX_PER_RUN` in `cron.ts` (currently **1000**/tick ≈ up to ~288k/day).
  The drain sends in **`BATCH_SIZE`=90 chunks through Resend's batch endpoint**
  (`sendEmailBatch`, `POST /emails/batch` — one HTTP request per chunk, not one
  per recipient), with a short `BATCH_GAP_MS`=600 pause between chunks to stay
  under Resend's 2 req/s. So a full tick clears in a few **seconds** and finishes
  well inside the 300s tick interval — which is the point: two drains can never
  overlap and double the request rate into Resend 429s (the old
  one-send-every-550ms loop ran a tick ~300–400s, overlapped the next, and that
  doubled rate is exactly what throttled it to a trickle). The ceiling now is
  Resend's account rate limit + daily cap, not Worker wall-clock — raise those to
  go higher. Each recipient is only mailed inside the window for their own
  timezone.
- **Launch → cron drain**: launch snapshots sendable contacts (minus
  suppressions) into `broadcast_recipients`; `runBroadcasts` (in
  `src/lib/broadcasts/cron.ts`, wired into the 5-min cron) claims a paced,
  in-window batch each tick (`MAX_PER_RUN` total, `BATCH_SIZE` per Resend
  request), so a big list spreads over hours rather than blasting at once.
  Idempotent atomic claims (a whole chunk claimed in one `db.batch`); transient
  failures retry, then park as `failed`.
- **Circuit breaker**: once a real sample is out, the cron auto-pauses a
  broadcast if complaint / **hard-bounce** rates cross threshold — a dormant list
  that's gone sour stops instead of burning the domain. Pause/resume by hand too.
  The bounce side weighs **permanent bounces only** (`hard_bounced_at`, migration
  0052, stamped by the Resend webhook when `bounce.type = 'Permanent'`): a
  transient/greylist bounce clears on its own and isn't removed by list cleaning,
  so counting it would re-trip the breaker on every resume. The rates are measured
  **since the last launch/resume** (`broadcasts.breaker_baseline_at`, migration
  0049), so cleaning the list and resuming gets a fresh sample to prove itself
  instead of staying permanently tripped by a sour historical rate.
- **List cleaning is list-level** (`src/lib/broadcasts/clean.ts`,
  `/admin/contacts` → "Clean dead domains", `/api/admin/contacts/clean`): scans
  every contact's domain — MX/A checked via DNS-over-HTTPS (cloudflare-dns.com),
  cached in `domain_status` (migration 0048) so each domain resolves once across
  runs/imports — and adds addresses at dead domains (no mail server, typo TLDs
  like `.con`, NXDOMAIN) to the **global `email_suppressions`** list
  (`suppressContactsAtDeadDomains`, reason `invalid_domain`). So a domain cleaned
  once is gone from this broadcast, every future broadcast, and lifecycle
  marketing; live broadcast queues are scrubbed to match
  (`suppressPendingRecipientsAtDeadDomains`). Fails open so a DNS hiccup never
  drops a valid address; non-destructive (contact rows stay). New imports at a
  known-dead domain are auto-suppressed on the way in (`importContacts`). For
  dead mailboxes at live providers, use the **bounce-check loop** on
  `/admin/contacts`: export the whole sendable list
  (`/api/admin/contacts/export` → `sendableContactsForExport`), run it through a
  mailbox-level checker (NeverBounce/ZeroBounce/Bouncer/…), then reimport the
  results — the page detects the result column, you tick which values mean
  undeliverable, and `/api/admin/contacts/suppress` (`suppressEmailsBatch`,
  reason `bounced`) adds them to the global `email_suppressions` list and scrubs
  live broadcast queues. (Or export a single broadcast's queue via
  `/api/admin/broadcasts/export` for a per-send check.) Separately,
  a broadcast's detail page can remove already-queued contacts carrying given
  tags (`/api/admin/broadcasts/exclude-tags` → `suppressPendingByTags`), e.g.
  ones Drip flagged undeliverable — audience exclude-tags only apply at launch,
  this scrubs a live/paused queue.
- **Feedback**: each broadcast tracks under `email_type = broadcast_<id>` in
  `email_sends`, so open/click/bounce/complaint flow in from the Resend webhook.
  Per-broadcast stats show on its detail page; the rollup shows on
  `/admin/emails/stats` under "Broadcasts" (`emailTypeMeta` knows the prefix).
- **Compliance**: every send honours `email_suppressions` (re-checked at send
  time), carries the RFC 8058 one-click `List-Unsubscribe` header, and a footer
  unsubscribe link — same plumbing as lifecycle marketing. The physical postal
  address (`MAILING_ADDRESS` in `emails.ts`) is in the shell footer (simple) and
  auto-appended to pasted HTML (`ensureAddress`, idempotent).
- **Editable until done**: a broadcast can be edited while `sending`/`paused`
  (not just `draft`) — the cron re-renders each batch from the row, so content
  edits reach recipients not yet sent. Stats label broadcasts by their real name
  (`/admin/emails/stats` looks the name up from the id).

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

**Deep-link the preview to the page that shows the change — not the bare root.**
Append the most relevant path to the `*.workers.dev` origin so the link opens
straight onto the work: e.g. `…workers.dev/admin/emails` for email/template
work, `/admin/broadcasts` for a broadcast, the specific `/courses/<slug>` or
landing page for a page edit, `/admin/…` for an admin tool. Only fall back to
the root when the change is genuinely site-wide. (Most admin pages gate on
login, but the deep link still lands Jacob in the right place after he signs in.)

**If Jacob says "skip preview", skip the preview step entirely and instead open
a PR and merge it** — no preview link needed. Otherwise the default stands:
share the deep-linked preview, and only open a PR when asked.
