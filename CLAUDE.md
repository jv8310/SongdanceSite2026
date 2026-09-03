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

## Course pricing — certification, workshop sale, Song Deck gift (July 2026)

- **The certification course is sold as fully self-paced** (class library +
  written manuals, instant access) with live components through end of 2026:
  weekly Q&As and monthly deepening sessions. The last couple of live classes
  still happen but are deliberately NOT emphasized on the page (they read as
  "joins the library"). The **"mid-cohort discount" is retired**: cert charges
  its normal price (€797 EUR; `full === base` in `variant.ts`, so nothing
  renders struck through), the path/bundle €1347 (= cert €797 + 12-week €550).
- **Workshop sale — one 20% everywhere** (July 2026 reprice): a live workshop
  window (same pre/post-48h rule as always) gives **20% off the whole
  certification path** — both line items (`CERT_PATH_DISCOUNT_PERCENT` in
  `src/lib/courses/path.ts`) — and the standalone 12-week course carries the
  same 20% (`DISCOUNT_PERCENT` in `twelve-week.ts`; €550 → €440), so the
  lifecycle emails quote one number for both. The path's discounted figures
  are floored to the nearest 5 (`pctMajor`), so the sale reads in round
  prices — EUR path €1,347 → **€1,075** (cert €635 + 12-week €440), 3×
  €375/mo, 6× €200/mo — and the advertised percent is never under-delivered.
  A `?discount=N` / `?adiscount=N` override still wins outright and, since
  September 2026, takes its percent off the **whole path** — both lines, the
  same shape as the workshop sale (EUR path €1,347 at 50% → **€670**). The
  standalone cert offer is discounted by the same percent as before. `variant.ts` bundle rows must stay = cert + 12-week per
  component (invariant noted in the file).
- **Top-of-funnel + order bumps** (July 2026): workshop ticket **€22** (70-min
  session), masterclass **€44** (100-min). The workshop/masterclass order bump
  is now the **"Empowering You" mantra pack** (€9, product `mantra-empower-bump`,
  Drip tag `prod_MantraEmpower`) — **delivered by us, not by Drip**
  ([`src/lib/workshops/mantra-pack.ts`](src/lib/workshops/mantra-pack.ts), see
  "Mantra pack delivery" below). The **Authentic Singing Journey** moved to a **€99 course
  bump** (struck against its new **€150** standalone) shown on BOTH the 12-week
  and the certification checkouts, alongside the €49 Grief bump
  (`src/lib/courses/bumps.ts`; cert-checkout bump wiring in `checkout.ts` +
  `subscriber-status.ts` + `CCRegister.astro`). Charged workshop/masterclass/
  bump prices live in the DB (**migration 0076**); the static marketing labels
  are in `src/lib/workshops/marketing-prices.ts` and course copy.
- **Post-workshop Song Deck gift** (`src/lib/courses/deck-promo.ts`): anyone
  with a secured workshop/masterclass seat sees, on both course checkouts
  (12-week + certification), a **free Song Deck with free worldwide shipping**
  from their session's start until **1 hour after it ends**. The panel's 1-hour
  countdown replaces the 48h discount countdown while live (the % discount
  itself stays). Server re-derives the window at checkout; when live it records
  a zero-amount `songdeck-gift` row in the registration's `bumps` JSON.
  **Fulfilment — direct Shopify API (with the coupon email as fallback)**: while
  the window is live the course checkout also shows a **shipping-address** field
  group (both the 12-week + certification checkouts; markup in `CCRegister.astro`
  / `TWRegister.astro`, shared client logic in
  [`src/lib/client/deck-gift-shipping.ts`](src/lib/client/deck-gift-shipping.ts)).
  The address is **optional** — a free gift never blocks a paid sale. Before
  submit it is verified through **Google's Address Validation API**
  ([`src/lib/address/google-validate.ts`](src/lib/address/google-validate.ts) via
  `/api/courses/verify-address`); if Google tidied it, the buyer sees a "did you
  mean …" suggestion to accept or keep theirs. The chosen address is stored on
  `course_registrations.deck_gift_shipping` (JSON, migration 0075). On payment,
  `fulfilDeckGift` (`src/lib/orders/notification.ts`, on every fulfilment path +
  the hourly reconcile) routes the gift: **Shopify configured + address on file**
  → [`placeDeckGiftShopifyOrder`](src/lib/orders/shopify.ts) creates a draft
  order for the deck variant with a **100% discount** + free shipping line and
  completes it (`draftOrderComplete`, `paymentPending:false`) into a **paid €0
  order** Shopify ships (idempotent on `deck-gift-shopify-<id>`), then a
  `deckGiftConfirmedEmail` ("on its way to …", tracks as `deck_gift_confirmed`)
  goes out. **Otherwise** (Shopify unset, no address, or the API errored — the
  claim releases so the reconcile retries) → the original transactional
  `deckGiftClaimEmail` with the **`SVH-BONUS`** coupon deep link
  (`/discount/CODE?redirect=…`) so the buyer self-orders at €0. The `SVH-BONUS`
  coupon must exist/stay active in the Shopify admin (it's still the fallback).
  SD-ORDER notes the gift. **Setup (no-ops until set):** `SHOPIFY_STORE_DOMAIN`
  (the `*.myshopify.com` admin domain, NOT songdeck.shop); **auth** — either a
  permanent `SHOPIFY_ADMIN_TOKEN` (Admin API token with `write_draft_orders`) **or**
  `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` (the worker exchanges them for a
  short-lived token via the client-credentials grant per call, for apps that only
  expose an expiring, non-copyable token); `SHOPIFY_DECK_PRODUCT_ID` (the Songdeck
  product id — it's the only product without variants, so its single variant is
  resolved automatically; `SHOPIFY_DECK_VARIANT_ID` optionally pins it), optional
  `SHOPIFY_API_VERSION` (default `2024-10`), and `GOOGLE_ADDRESS_VALIDATION_KEY`
  (Address Validation API enabled).
- **Zoom rejoin fix** (`joinWindowFor` in `src/lib/workshops/time.ts`): a fresh
  join still gates at start+20min, but anyone who already clicked Join can
  REJOIN until the session's real end (70-min default / 100-min masterclass from
  `ends_at_utc`) + 10-min grace — a connectivity drop never locks them out.

## The workshop order bump — one resolver, no exceptions

**Never read `workshops.bump_product_id` directly.** A workshop names its bump
in that column; a **masterclass never does** (`SYNC_MAPPINGS` in
`calendar-sync.ts` carries `bumpSlug: null`), so the bump it offers comes from a
default — and every caller used to apply its own. They drifted, and on
2026-07-21 that drift shipped: the registration calendar advertised the
€9 "Empowering You mantra pack" on masterclass dates while the checkout charged
the old `asj-bump` (€19), the ledger recorded ASJ, and `tagInDrip` — gating on
the NULL column — granted **no product tag at all**. Those buyers paid for a
bump and got nothing: no delivery email, nothing under "Your music", a locked
player. Migration `0078` repairs the rows.

Everything now goes through [`src/lib/workshops/bump.ts`](src/lib/workshops/bump.ts):

- `DEFAULT_BUMP_SLUG` (`mantra-empower-bump`) — the single default.
- `resolveWorkshopBumpProductId` / `resolveWorkshopBumpProduct` — the session's
  own bump, else the default for a masterclass. Used by the pages
  (`calendar.ts`, `/w/<slug>`), the checkout (`register.ts`), **both**
  fulfilment paths (Stripe webhook via the ledger, `paypal-fulfill.ts`) and the
  tagging (`paid-handler.tagInDrip`, `contacts/tag-backfill.ts`).
- `workshopOffersBumpSql` — the same rule as a SQL fragment, for D1 sweeps.
- `workshopBumpTagsForEmail` — what a buyer holds, per D1 (see music access).

So what is advertised, charged, recorded and granted are one decision. Adding a
caller that re-derives the bump re-opens this exact bug.

## Page changes are bookmarked, and registrations remember their page

Two small pieces of instrumentation that only make sense together.

- **`signup_page` on a registration** (migration 0083,
  [`src/lib/workshops/signup-page.ts`](src/lib/workshops/signup-page.ts)):
  `/workshop`, `/courses/masterclass` and a direct `/w/<slug>` link all POST the
  same `/api/workshops/register`, so nothing ever recorded *which page* sold a
  seat — "how many workshop tickets did the masterclass page sell?" had no
  answer in the data. Each form now sends its own `location.pathname`; the
  server normalizes it (`masterclass` / `workshop` / `w`, else the cleaned path,
  query and hash dropped — they carry discounts, referral ids and emails) and
  writes it with `recordSignupPage`, **after** the row exists and wrapped in a
  try/catch: it is analytics, and a preview deploy runs against the live
  database *before* its migration is applied, so a checkout must never 500 over
  a reporting column. First page on a row wins. Rows created before this are
  NULL — **unknown, not zero**, and every readout must say so.
- **Bookmarked page changes** ([`src/lib/workshops/experiments.ts`](src/lib/workshops/experiments.ts)):
  the site has no page-view analytics, so "did conversion go up?" can only be
  answered by comparing like windows of registrations either side of a change —
  which is worthless without the exact date. Record one here whenever you change
  what a landing page offers. `MC_WORKSHOP_ALTERNATIVES` (2026-09-03) is the
  first: the masterclass page stopped listing the live €22 workshop dates under
  "in case the masterclass doesn't fit your schedule" (`MC_PAGE_OFFERS_WORKSHOPS`
  in `MCRegister` — flip it to put them back, and bookmark *that* date too). The
  masterclass **replay** stays: same product, same price.
- **Where to read it**: `/admin/workshops/performance` → the panel named after
  the change ([`mc-page-report.ts`](src/lib/workshops/mc-page-report.ts)). It
  deliberately **ignores the period picker** — it runs the days since the change
  against the same number of days immediately before it, which is what makes the
  halves comparable. The conversion rate is **started → secured**: a
  registration row is written at `prepared` the moment the form is submitted
  (before the gateway) and flips to `paid`/`coupon` when the seat is secured, so
  that ratio is a real funnel and the only one this database can offer.

## Share with a friend — one link builder, and the funnel behind it

The countdown page (`/workshop/success`) offers every secured registrant a link
to pass on, carrying the public `?discount=50`. Two things about it:

- **The landing page is decided in exactly one place** —
  `shareLandingPath` / `buildShareUrl`
  ([`src/lib/workshops/share.ts`](src/lib/workshops/share.ts)). A **masterclass
  shares `/courses/masterclass`**, a workshop shares `/workshop`. Until
  September 2026 the page hard-coded `/workshop` for both, so every masterclass
  attendee sent their friends to a different session at a different price, and
  the `?friend=<slug>` ★ marker pointed at a date that page didn't list.
  `MCRegister` now honours `?friend=` the way `WERegister` always did. Anything
  building a share link must call `buildShareUrl` — a caller that re-derives the
  path re-opens this bug.
- **It is measured.** The link carries `?ref=<registration id>.<sig>` (HMAC over
  `ADMIN_SESSION_SECRET`, domain-separated `sd-share:` — the sharer's
  `access_token` is a credential and never rides a public link) and `?rc=<channel>`
  per button, so a WhatsApp share is told from a paste all the way to the sale.

Four steps, three of them rows in `workshop_share_events` (migration 0082):

| step | recorded by | counted as |
| --- | --- | --- |
| panel shown | `/workshop/success` render | one row per registrant, ever (partial unique index + `INSERT OR IGNORE`) |
| button pressed | `/api/workshops/share` (sendBeacon) | every press — totals and distinct sharers |
| friend opened it | [`src/middleware.ts`](src/middleware.ts) | first landing per browser |
| friend registered | `referred_by_id` / `referral_channel` on the registration | joins straight to payment status and revenue |

- **Capture lives in the middleware**, not on the two landing pages: the link is
  public and gets pasted anywhere, and the `sd_ref` cookie (30d, HttpOnly) is
  what lets `/api/workshops/register` credit a friend who comes back days later
  on a bare URL. `share.ts` therefore stays free of heavy imports — the report
  lives in [`share-report.ts`](src/lib/workshops/share-report.ts) so the stats
  module isn't pulled into every request.
- **Two things would otherwise make the numbers lies**, and both are handled:
  WhatsApp/Facebook/Telegram fetch a shared URL themselves to build the preview
  card (`looksLikeShareBot` filters them, so the count moves when a link is
  *opened*, not when it is posted), and the countdown page is reloaded
  constantly while people wait for the Join button (hence the once-ever view).
  A checkout on your own link is never a self-referral.
- **Where to read it**: `/admin/workshops/performance` → "Share with a friend" —
  the funnel, a per-button table, and who is actually sending people. Money goes
  through `grossEurMinor` like every other euro on that page.

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

## Album delivery — buyers get their player link by email

Two ways to own a music album, one delivery shape
([`src/lib/music/delivery.ts`](src/lib/music/delivery.ts)):

- **As an order bump** — the mantra pack, below.
- **Bought on its own** (`album-<id>`, from `/music/<album>`) — `notifyCourseOrder`
  calls `sendAlbumPurchaseEmail`, so every fulfilment path delivers it (Stripe
  webhook, PayPal, free checkout, admin mark-paid, hourly reconcile). The
  template (`albumPurchaseEmail`) is **generic over the album**: title, cover,
  tracks and the blurb all come from the `music_albums` row, so a second album
  needs no new code. Transactional, idempotent on an `events` claim
  (`album-delivery-<id>`), released on failure so a retry gets through.

**The link opens signed in.** `albumPlayerUrl` puts the buyer's own address on
the player link (`/music/<album>?email=…`), and `/music/[album].astro` reads it,
checks entitlement, sets the `sd_music` cookie and **302s to the clean URL** — so
the buyer never types an address we already know, and it sits in the address bar
(and any referrer) for one hop only. The email *is* the credential in this system
(same as `/access` and the gate form), so the link grants nothing typing it
wouldn't, and entitlement is still re-checked on every render — a refund or a
removed tag closes the door as before. An address that doesn't match falls
through to the ordinary gate with the field **prefilled**.

### The mantra pack — the order bump emails itself

The €9 **"Empowering You"** workshop/masterclass order bump
(`mantra-empower-bump`) only ever applied its Drip tag, and the matching Drip
automation was never built — so buyers got the tag (which silently opens the
gated player) but no email telling them so. Delivery now lives in the site, in
[`src/lib/workshops/mantra-pack.ts`](src/lib/workshops/mantra-pack.ts):

- **What it sends**: `mantraPackEmail` (`emails.ts`) — transactional, so it
  ignores suppression, like the seat confirmation. It carries the album cover,
  the track list, the player link and the address that opens it (the buyer's
  own — email *is* the login there). Copy keeps mantra and sounding apart, as
  the copy book does (ch. 6): "a different door", never the practice.
- **What it links to**: whatever **published** music album carries the bump
  product's `drip_tag` — resolved at send time (`resolveMantraPackTarget`), so
  renaming/re-covering the album on `/admin/music` updates future emails with
  no code change. **No published album with that tag → nothing is sent** (there
  would be nothing to link to); the sweep just retries later.
- **When**: live, from `runWorkshopPaidSideEffects` right after the confirmation
  — *plus* a catch-up sweep (`runMantraPackBackfill`) on the 5-minute cron that
  mails every paid bump buyer with no send on record. That sweep is what caught
  up the people who bought before this existed, and it doubles as the safety net
  for a live send that failed.
- **Who counts as a buyer**: a recorded `workshop_purchases` line for the bump
  product, **or** `wants_bump = 1` on a paid/coupon registration whose workshop
  offers that product as its bump **and whose ledger holds no bump line at
  all**. That last clause is load-bearing: migration 0076 repointed every
  *upcoming* workshop from the old ASJ bump onto the mantra pack, so a session
  that has since taken place names the mantra pack today while its earlier
  buyers actually bought ASJ — their ledger line settles it, and intent only
  speaks for the coupon seats that have no ledger. Same pair of signals
  `workshopDripTags` uses to grant the tag, so the email and the access can't
  disagree. "Whose workshop offers that product" is
  `workshopOffersBumpSql` — the session's own `bump_product_id` **or** the
  masterclass fallback (below), never the column alone.
- **Admin**: when nothing is deliverable, the `/admin/emails` panel prints both
  sides of the match — the tag the bump product grants and the tag each album
  asks for. Delivery hinges on those two strings being equal and a mismatch is
  otherwise completely silent (no email, nothing under "Your music", no error).
- **One email per buyer, ever**: claimed atomically on
  (`registration_id`, `mantra_pack`) in `workshop_sent_notifications`, released
  if the send throws so it retries; and deduped by **email**, so taking the bump
  on two sessions doesn't mail the same album twice.
- **Admin**: previews on `/admin/emails` with the other transactional mail, and
  that page carries a **"Mantra pack — deliver to buyers"** panel showing which
  album is being delivered, how many buyers are still waiting, and a button
  (`/api/admin/workshops/mantra-pack-send`) that forces the sweep with a wider
  cap. Pressing it twice is harmless.

## Retreat payment — three buttons, one of them not a gateway

Both retreat forms (`RBRegister` château, `DSRegister` boat) offer **Pay
online** (Stripe), **Pay with PayPal**, and **Pay by manual IBAN bank
transfer**. The third is not a gateway and must never be treated as one:
nothing is created at Stripe or PayPal, no webhook will ever fire, and the
money appears in the bank days later. Logic in
[`src/lib/registrations/bank-transfer.ts`](src/lib/registrations/bank-transfer.ts)
(account, reference, email) and
[`src/lib/client/bank-transfer-panel.ts`](src/lib/client/bank-transfer-panel.ts)
(the on-screen panel).

- **`parseProvider` deliberately never returns `bank_transfer`.** Most
  checkouts only branch on `=== 'paypal'`, so a widened return value would
  fall straight through to the Stripe path and open a card session on a row
  stamped bank_transfer. A checkout that offers the transfer opts in ahead of
  that call with **`wantsBankTransfer(payload.provider)`** — only the two
  retreat checkouts do. `OrderProvider` (= `PaymentProvider | 'bank_transfer'`)
  is what the `provider` **column** may hold; `PaymentProvider` stays "a
  gateway". No migration: the column has no CHECK constraint.
- **The hold is days, not minutes.** The row is an ordinary `pending`
  registration, but with `hold_minutes = BANK_TRANSFER_HOLD_MINUTES` (7 days)
  instead of 30 — at 30 minutes the room would go back on sale under someone
  who has already sent the money. Everything downstream (availability,
  `beds_sold`, the waiting-list hold) already keys on `hold_expires_at`, so
  nothing else changed. When it lapses the row is *not* deleted: a late
  transfer can still be marked paid by hand.
- **The reference is `SD-<registration id>`** (`bankTransferReference`),
  derived not stored, and is what the guest puts in the communication field
  and what Jacob matches the bank line against.
- **No redirect.** The checkout answers with `{ bank_transfer: {…} }` instead
  of a `checkout_url`, and the form swaps itself for the details panel — so
  the account details are on screen *and* in the email, and nothing about the
  booking is guessable from a URL.
- **Confirming it is the admin's job**: `/admin/retreats/<slug>` shows an
  **awaiting transfer** pill plus the amount, IBAN, reference and hold expiry
  on the row, and the ordinary **Mark paid** button (relabelled "Transfer
  received — mark paid") does the rest — it already runs every side-effect a
  webhook would: `assignRoomOnPaid`, `settleWaitlistOnPaid`, Drip, SD-ORDER.
  It also stamps the synthetic `manual-<id>` payment intent, which is why
  `/admin/orders` has always read such a row as "Bank transfer"; the provider
  column now says so from the moment of booking, before any payment intent
  exists. A bank-transfer order is **never refundable from the admin**
  (`isRefundable`) — the money goes back out of the bank by hand.
- **We raise the invoice, because Quaderno cannot.** Almost every retreat
  invoice comes from the native Stripe/PayPal→Quaderno connector: the gateway
  reports the charge and Quaderno makes the document. A transfer has no
  gateway, so nothing invoiced it at all — the money landed and the books
  stayed empty. [`retreat-invoice.ts`](src/lib/registrations/retreat-invoice.ts)
  fills that gap on both mark-paid paths, and **only** for money no gateway
  saw: `invoiceRetreatBooking` refuses anything that is not a `bank_transfer`
  row (a Stripe row marked paid by hand is the connector's to invoice, and a
  second document would bill the guest twice on paper), `invoiceRetreatBalance`
  is for the hand-settled balance whatever gateway took the deposit. Both are
  idempotent on an `events` claim (`retreat-invoice-<id>` /
  `retreat-balance-invoice-<id>`, kind `retreat.invoice.created`), release it
  on failure so the button retries, and never throw into the admin action.
  **The tax is not the course rule**: a course passes `tax_class: 'eservice'`
  and lets Quaderno derive destination VAT or reverse-charge from the contact
  — for a retreat that is wrong both ways. A physical event's place of supply
  is where it is held (Art. 53), B2C and B2B alike, so the rate comes from
  `products.vat_rate` and is passed explicitly as `tax_1_rate`. That column
  really varies: **0.21** for the château in Belgium, **0.0** for the boat in
  Egypt. `amount_cents` holds only what has been *charged* (the deposit on a
  deposit booking; `markBalancePaid` adds the balance to it later), so it is
  the sum to invoice as it stands — never a total to subtract the outstanding
  balance from. A row already marked paid before this existed can still get
  its invoice: `/admin/retreats/<slug>` shows **Create Quaderno invoice** /
  **Invoice the balance** on exactly the rows that are missing one
  (`/api/admin/quaderno-invoice`, which re-derives eligibility from the row
  and trusts nothing in the form).
- **The email** (`buildBankTransferEmail`) is transactional, uses the shared
  retreat shell (`retreatEmail` in `waitlist-emails.ts`, which grew an
  optional `details` panel for it), and asks the guest to **reply when they've
  transferred** — a SEPA credit carries no callback, so that reply is the only
  signal that the booking has become payable. A failed send is logged
  (`registration.bank_transfer.email_error`) and never fails the checkout: the
  booking stands and the details are on screen either way.

## Retreat waiting list — and the offer that holds a place

A sold-out retreat used to be a dead end. Now the page offers a waiting list,
and when a place frees up the admin offers it to someone from
**`/admin/retreats/<slug>` → "Waiting list"**. Table `retreat_waitlist`
(migration 0080), logic in
[`src/lib/registrations/waitlist.ts`](src/lib/registrations/waitlist.ts).

- **Joining** — [`RetreatWaitlist.astro`](src/components/RetreatWaitlist.astro)
  sits under the registration form on both retreat pages and **reveals itself**
  when any of the rooms it lists is full (all of them, or just the one someone
  wanted); the sold-out badges link to it (`#waiting-list`). `POST
  /api/registrations/waitlist` upserts on (retreat, email) — joining twice
  updates, never duplicates — and confirms by email. Someone who left the list
  and comes back rejoins at the **back** of the queue; the people who waited
  through keep their place.
- **Offering** — the admin picks the room and a window (default 48h) and the
  button emails a **claim link**
  (`/retreats/<page>?claim=<token>#register`, `RETREAT_PAGE_PATHS` maps the
  slug → page; a retreat missing from that map can't be offered). The send is
  what makes it real: **a failed email rolls the hold back**
  ([`waitlist-offer.ts`](src/lib/registrations/waitlist-offer.ts)).
- **An offer is a real hold, not just an email.** While it stands, that place
  stops being sold: `countActiveOffersByTier` is subtracted from public
  availability everywhere a visitor is shown or sold a place —
  `/api/registrations/availability`, the dolphin GET, and both checkout
  capacity guards. The claim link passes its token, which excludes **its own**
  hold, so the room reads open for the person it's kept for and for nobody
  else. Holds are per **tier**: in the château's room model two tiers can share
  a physical room, so a booking on a *different* tier can still consume the bed
  — the same coupling that already exists between two ordinary bookings.
- **The hold lifts exactly when the booking takes the place instead** — never
  both at once, never neither. Paid → lifted. Pending **with a room assigned**
  (the château, where checkout takes the room immediately) → lifted. Pending
  **with no room** (the boat: "free until paid", migration 0074) → the hold
  stands, or the promised place would go back on sale while the guest is on the
  payment page. Starting a second checkout on the same claim link releases the
  first (`releaseClaimCheckoutHold`), so one offer never holds two rooms — the
  second of which could be the next person's place.
- **Closing the loop** — the checkout records the booking on the entry
  (`attachRegistration`) and `settleWaitlistOnPaid` flips it to `booked` when
  the money lands. It is called from **every** paid path (Stripe webhook,
  PayPal fulfilment, admin "Mark paid"), alongside `assignRoomOnPaid`.
  Offers that run out are swept to `expired` by the **hourly cron**
  (`expireLapsedOffers`) — but never while the guest's own checkout is still in
  flight.
- **Admin** — the section lists the queue (position = join order among the
  people still waiting), each person's preference, notes and contact details,
  the live offer with its expiry and copyable claim link, and the booking it
  produced. Per row: offer / re-offer, withdraw, mark declined, put back on the
  list, delete. Plus "Add someone by hand" for the ones who ask by email (no
  confirmation email — you're already in the conversation). The retreats index
  shows "N waiting" per retreat.

## Retreat balance — bank transfer first, and a hand to close it

A retreat booked with a 50% deposit owes the rest before the retreat. The
"pay the remainder" email is sent by hand from **`/admin/retreats/<slug>` →
"Balance due"** (one person, or everyone at once); the sender lives in
[`src/lib/registrations/balance.ts`](src/lib/registrations/balance.ts), the
**words in [`balance-email.ts`](src/lib/registrations/balance-email.ts)** so
`/admin/emails` can preview and test-send it beside the lifecycle mail.

- **Two ways to settle, bank transfer first.** The email leads with the
  Songdance account (`BANK_TRANSFER` — Songdance BV, `BE43 0689 3690 1001`; a
  SEPA transfer needs the IBAN alone, so no BIC is quoted), the amount, and a
  **transfer reference** — `balancePaymentReference(id)` = the same `R-<id>`
  order number `/admin/orders` searches on. It asks the guest to **reply**
  once they have sent it (`BALANCE_REPLY_TO`, which is also the send's
  Reply-To — they must not drift). The Stripe/PayPal checkout link follows as
  the alternative, on the gateway the deposit was paid with.
- **A bank transfer has no webhook**, so the balance table carries a **Mark
  paid** button per row (`/api/admin/balance/mark-paid`, admin-gated) next to
  Send/Resend link, and the transfer ref beside the amount so a statement line
  maps to a person. It does exactly what the two paid paths do
  (`markBalancePaid` → roll the balance into `amount_cents`, `recordRetreatOrder`
  to lift the Drip order from deposit to full, log
  `registration.balance.paid`) — **no** re-fired "Completed registration" Drip
  event and no SD-ORDER, same as the Stripe/PayPal balance handlers. It
  refuses a row that is not paid, already settled, or owes nothing, so a
  double-click can't log twice.

## Workshop revenue in EUR — never count a charge at face value

Tickets are charged in the buyer's currency (`workshop_product_prices`), and a
Nordic ticket is **239 kr** with a **99 kr** bump. So a workshop payment's
`amount_minor` is only euros when `currency = 'EUR'` — every euro figure the
site reports has to convert.

`grossEurMinor` ([`src/lib/workshops/stats.ts`](src/lib/workshops/stats.ts))
used to fall back to the raw minor units when there was no EUR settlement
figure, i.e. it read 239 kr as **€239** (~11× for NOK/SEK, ~7.5× for DKK). One
such seat made a 4-registration workshop read **€333** of revenue and a 1.15×
ROAS on `/admin/workshops/performance` (real: ~€70, ~0.25×) — and the same
number fed `/admin/stats`, `/ads` and the SD-REPORT digests. It now converts at
the live `fx_rates` table (`getFxRatesToEur`, `FX_TO_EUR` as the fallback),
which is what `/admin/orders` always did — so the two pages agree.

The fallback is not an edge case, because a settlement figure is often absent:

- **PayPal** workshop payments only carry one when PayPal actually converted
  the money. `captureSettlement` (`src/lib/payments/paypal.ts`) reads the
  capture's `seller_receivable_breakdown.exchange_rate` and stores gross ×
  rate — the same shape as Stripe's `balance_transaction.amount`, on both the
  return and webhook paths. (Not `receivable_amount`: that is net of PayPal's
  fee and would understate gross next to the Stripe rows.) No conversion → the
  columns stay NULL and the FX conversion above does the work.
- **Stripe** rows miss one whenever the balance transaction couldn't be read
  (logged as `workshop.webhook.settlement_failed`).

So: an exact EUR settlement wins, otherwise convert. Anything summing money out
of `workshop_payments` must go through `grossEurMinor` — reading `amount_minor`
as euros is this bug again.

## Ad attribution — a payment plan is ONE sale, counted in full

`/admin/workshops/performance`, the ad-economics cards on `/admin/stats` and
`/ads`, and every ROAS on them ask one question: *what did this ad money buy?*
The answer is the whole purchase. A €1,200 certification path bought on a 6×
plan is a €1,200 sale on the day it was sold — the buyer signed for all six
charges — even though only €200 has been billed.

Until August 2026 the attribution counted `collectedMinorOf` (plan total ×
installments paid *so far*), so that sale entered its masterclass at €200 and
the 27 Aug masterclass read **1.06× ROAS** on ~€598 of spend instead of ~2.4×.
It also contradicted what we tell Meta: `sendCoursePurchaseEvent`
([`src/lib/courses/meta.ts`](src/lib/courses/meta.ts)) has always reported the
full `amount_cents` to the Conversions API, so Meta's ROAS for the very same
order was ~6× ours.

`contractedMinorOf` ([`src/lib/workshops/stats.ts`](src/lib/workshops/stats.ts))
is the attribution figure now:

- the **whole plan** — `amount_cents` is always the plan *total* (every course
  checkout stores monthly × count) — **plus the order bumps on the same
  checkout** (the `bumps` JSON; `amount_cents` deliberately holds the course
  line only, so leaving them out under-counted the same sale a second time);
- capped at what will really be charged, so it can never promise money that
  won't arrive: an admin-scheduled early stop (`cancel_after_installment`, via
  `effectiveTotal`) and a cancelled/refunded row are worth only their actual
  charges;
- refunds off, VAT stripped per country and FX-converted exactly as before.

`collectedMinorOf` stays the **cash** figure and still drives
`computeCourseSales`, so the `/admin/stats` revenue tiles, the daily streams
and the SD-REPORT digests are untouched — nothing recognises revenue before it
is charged. The two travel together through the performance report
(`attributedCourseEurMinor` / `attributedCourseCollectedEurMinor`,
`totalEurMinor` / `totalCollectedEurMinor`, and
`AudienceAcquisition.revenueEurMinor` / `collectedRevenueEurMinor`) and both are
on screen: the revenue bar is two-tone — pale = the full value of the sales that
session produced, solid = charged so far — with the split spelled out beside it.

**No data migration was needed, and none exists.** Every figure on those pages
is recomputed from `course_registrations` on each page load, and `amount_cents`
has held the plan total since the first installment checkout, so the fix
restates *all* history the moment it deploys — past workshops included. (A
stale `installments_paid` can still under-state the *collected* half; "Sync
from Stripe now" on `/admin/courses/future-revenue` is what repairs that.)
Anything new that attributes a course sale to a campaign, a session or a
channel must use `contractedMinorOf` — reading the collected slice is this bug
again.

**Every course figure converts and nets the same way, on every page.** The
attribution above only reads true if the money underneath it does, and two
pages were computing without a money context: `/admin/workshops/performance`
passed none at all (course revenue **gross of VAT**, so the same session read
higher there than on `/admin/stats`), and `computeAdsDashboard` passed none to
anything (so all of `/ads` also priced non-EUR course sales off the **static**
`FX_TO_EUR` approximations instead of the live `fx_rates` table — the course
twin of the kroner bug above). Now: `computeCourseSales` resolves live rates
itself when the caller passes none (as `computeStats` and
`computeWorkshopPerformance` already did, so no call site can silently fall
back), `computeAdsDashboard` takes a `MoneyOpts` and hands the same one to all
three computes plus its bump tally, and both pages build it with
`resolveMoneyOpts`. `fxRateToEur(currency, fxRates)` is the single
currency→EUR rule (live table, then the static fallback) — use it rather than
reaching for `FX_TO_EUR`; the SD-REPORT's course-bump tally now does too.

## Internal reports — daily + weekly "SD-REPORT" digests

Ops-only summary email (NOT customer-facing), sibling to the `SD-ORDER`
notifications. Lives in [`src/lib/workshops/reports.ts`](src/lib/workshops/reports.ts).

- **What it covers** for the window: new **workshop registrations** (paid/coupon,
  per workshop), **course sales** (12-week / certification / grief, per product),
  **bump offers** — both the workshop order bump (`workshop_purchases`) and the
  12-week checkout order bumps (the `bumps` JSON on `course_registrations`) — and
  a **revenue** breakdown that sums them. Numbers reuse the dashboard's own
  `computeStats` + `computeCourseSales` (stats.ts), so a figure here matches
  `/admin/stats` for the same window.
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

## Order overview — paginated, filtered in SQL

`/admin/orders` used to load **every** row of `registrations` +
`course_registrations` + `workshop_registrations`, money-up the lot in JS and
render all of it — plus one extra `workshop_payments` query per 90
registrations (the D1 bound-param cap), i.e. dozens of sequential round-trips.
[`src/lib/admin/orders.ts`](src/lib/admin/orders.ts) now works in two passes:

- **Index pass** — one narrow query per source (`?page`/`?per`-independent),
  carrying only what the page needs to sort, count and money-total a row.
  Source / status / search / email compile to **SQL WHERE fragments**
  (`listOrdersPage`'s `OrderFilter`), so a filtered view scans far less. A
  course search maps the typed words back to product **slugs** (labels only
  exist in JS) and the order number is matched as `'c-' || id`; LIKE wildcards
  in the search term are escaped.
- **Hydration pass** — only the ~50 rows of the requested page are loaded in
  full (gateway ids, plan, names) and rendered. `?page` + `?per`
  (25/50/100/200, default 50) drive it; changing a filter resets to page 1.
- The workshop money join is now a single **`ROW_NUMBER() OVER (PARTITION BY
  registration_id …)`** sub-select ("latest paid/refunded payment per
  registration") instead of the chunked id-list queries.
- The summary tiles still cover the **whole filtered set** (they read the index
  pass, not the page), so a figure never silently means "just this page".
- `findOrder(db, 'C-12')` (order detail + the refund route) and
  `listAllOrders(db, { email })` (the person page) read only their own rows —
  those three pages used to load every order to find one.

## SD-ORDER notifications — safety-net reconcile

The internal per-purchase order emails (`src/lib/orders/notification.ts`, course
+ retreat only; workshops never notify) are idempotent on an `events` claim
(`order-notify-<type>-<id>`). A missed webhook/Resend blip could drop one, so the
hourly cron also runs `reconcileOrderNotifications`
([`src/lib/orders/reconcile.ts`](src/lib/orders/reconcile.ts)): it re-sends any
paid course/retreat order in the last 7 days that carries no sent-claim (bounded
per run, idempotent, so steady state is a no-op).

## Installment plans — the stop must sit exactly on the billing boundary

An N-installment Stripe plan is an ordinary monthly subscription bounded by a
`cancel_at` on the subscription (Checkout won't accept
`subscription_data[cancel_at]`, so the webhook sets it right after creation).
**Stripe prorates the invoice of any period the cancellation falls inside**, so
that timestamp has exactly one correct value: the instant the (N+1)th charge
would fall due — `billing_cycle_anchor + N calendar months`. Earlier, and the
final installment is charged for only the days before the stop; later, and the
plan bills one more time. There is no safe margin in either direction.

Until July 2026 `computeInstallmentCancelAt` used `now + (N-1)×30d + 15d` —
30-day months against Stripe's calendar-month billing, off our own clock. That
always landed ~10–16 days *into* the final period, so **every plan's last
installment was prorated**: 3× billed 43–53% of it, 6× 39–48%, 12× 29–36%. It
surfaced as a €349×3 certification plan whose third invoice came out at
**€157.62** ("Time on … after 27 Jul 2026" = 14 days of a 31-day period).

The rules now, all in [`src/lib/registrations/stripe.ts`](src/lib/registrations/stripe.ts):

- `addMonthsUnix` mirrors Stripe's own anchor arithmetic (every period is
  `anchor + k months`, clamped: a 31st anchor bills Feb 28 then **Mar 31 again**).
- `computeInstallmentCancelAt(n, anchorUnix)` **requires** the anchor, and the
  webhook reads it from the subscription (`billing_cycle_anchor`) before
  scheduling. If Stripe can't be read, we set **no** cancel_at and let the
  hourly repair do it — never a guess from our clock.
- When the final installment settles, `recordCourseInvoiceIfNew` flips
  `cancel_at_period_end` — the canonical proration-free stop, which also bounds
  a plan whose cancel_at never got set.
- `installment-cancel.ts` (the admin early stop) uses the same boundary, and
  `cancel_at_period_end` when the boundary is already behind us.
- The hourly reconcile **repairs live plans**: it re-pins cancel_at to the
  boundary — but only when the current value is *recognisably* the old math
  (`looksLikeLegacyCancelAt`), so a stop the owner set by hand in the Stripe
  dashboard is never pushed back out.

**Audit** (`/admin/courses/future-revenue` → **🔎 Audit plans**,
[`src/lib/payments/stripe-audit.ts`](src/lib/payments/stripe-audit.ts)):
read-only, checks every Stripe plan against Stripe's own paid invoices and
reports cycles charged **short** (with the invoice numbers), cycles charged but
**not recorded** here, stop dates off the boundary, and **webhook health** — how
many `invoice.paid` events actually arrived vs installments recorded. Zero
`invoice.paid` alongside live subscription events means the endpoint isn't
subscribed to that event, which is otherwise invisible. A short cycle is money
Stripe never took: it can't be fixed retroactively, only invoiced or waived.

## Refunding a course installment plan — one cycle at a time

A plan's charges live at the **gateway**, not on our row: `amount_cents` is the
whole plan total, and the row only ever keeps the **first** charge id
(`stripe_payment_intent` / `paypal_capture_id` are both written with
`COALESCE(…)`). So the admin refund button used to target installment 1 for
every plan — a blank ("full") refund quietly gave back one cycle while the
dialog promised the plan total, any larger amount was rejected by the gateway,
and cycle 2+ could only be refunded from the Stripe dashboard.

[`src/lib/admin/installments.ts`](src/lib/admin/installments.ts) reads the
cycles live (`listSubscriptionInvoices` for Stripe, `listSubscriptionTransactions`
for PayPal) and `/admin/orders/C-<id>` renders one row per installment —
date, invoice/sale reference, amount, already-refunded, and its own Refund
button. `/api/admin/refund` takes an optional **`installment`** (a Stripe invoice
id / PayPal sale id):

- **The id is never trusted.** It is looked up in the ledger built from *this
  row's own* subscription id — that lookup is both the resolution and the
  authorisation check — and the amount is clamped to that cycle, not the plan.
- **The whole-order form's ceiling is ONE charge** (`perChargeRefundableMinor`),
  because that is all it can reach. It only appears for a plan as the fallback
  when the gateway can't be read; the panel is the normal path. Anything
  offering `refundableMinor` (the plan total) as refundable against a single
  charge is the original bug.
- **Two gateway holes had to be closed for cycle 2+ to record at all.** Stripe's
  basil API version hides the invoice's PaymentIntent behind an `expand`, so
  `listSubscriptionInvoices` asks for `data.payments` and falls back to a bare
  list on the 400; where it still comes back null, the anchor is recovered from
  our own `course.installment.recorded` events. On PayPal, a refund of cycle 2+
  matched no row and died as `paypal.refund.unmatched` — `recordPaypalRefund`
  now also routes by `subscriptionId` (the webhook passes the sale's
  `billing_agreement_id`) or an explicit `courseRegistrationId` (the admin path).
- Both gateway reads are capped at **8s** and degrade to the fallback form; the
  page never 500s on a Stripe blip.
- **Stopping the plan sits in the same panel** — refunding a cycle and forgiving
  the ones still to come are two halves of one decision. It posts to the same
  `/api/admin/courses/cancel-installments` the Future-revenue table uses (which
  re-derives everything from the row), and both offer the same options in the
  same words via the shared `keepLabel`
  ([`installment-cancel.ts`](src/lib/courses/installment-cancel.ts)) — a second
  doorway to that control, never a second implementation. Stopping never
  refunds and never revokes access. It needs a live plan, so it depends on the
  status rule below: before it, refunding one cycle flipped the row to
  `refunded` and `isCancellablePlan` then refused — "refund one, stop the rest"
  was impossible in that order.

**A partial refund is no longer "this plan has stopped."**
`markCourseRegistrationRefunded` used to flip `status='refunded'` on any refund,
however small — and the revenue stack reads that status as terminal
(`contractedMinorOf` counts a refunded row at `installments_paid` instead of its
contracted total; the future-revenue forecast drops it entirely). So handing one
installment of six back wrote off the four still to bill, on a plan Stripe was
still charging. It now flips only once refunds reach everything the row has
**collected** (`collectedGrossMinor`, the mirror of `collectedMinorOf` in
stats.ts — the two must agree); below that the row keeps its status and only
`refunded_amount_cents` moves, which every figure already nets off. This governs
a Stripe-dashboard refund too, since the `charge.refunded` webhook shares the
writer. Side effect worth knowing: album entitlement gates on `status='paid'`
([`music/product.ts`](src/lib/music/product.ts)), so a *partial* refund of an
album now keeps access and only a full one revokes it.

## Stripe course-installment recognition — safety-net reconcile

Stripe **course installment plans** (3×/6×/12× subscriptions) record each cycle
from the `invoice.paid` webhook, with one backstop at
`checkout.session.completed` (the webhook reads the subscription's
`latest_invoice` and records it if already paid). Both can miss the *first*
charge: the checkout backstop fires only once, at completion — if the opening
invoice hadn't settled *at that instant* (an async method like SEPA debit, or a
few seconds' delay) it records nothing; and if the endpoint isn't subscribed to
`invoice.paid` (or a delivery drops), nothing else ever bumps the count.
Meanwhile `customer.subscription.updated` still flips the row's
`subscription_status` to `active`, so the plan sits at **0/N, `paid_at` NULL,
coarse status `pending`/`expired`** — "ACTIVE" in Stripe, "Not started" on
`/admin/courses/future-revenue` — while Stripe keeps charging monthly. No access,
no SD-ORDER, no Drip. (This is the exact Stripe twin of the PayPal hole below.)

The single idempotent fulfilment step —
[`recordCourseInvoiceIfNew`](src/lib/courses/stripe-fulfill.ts) (bump
`installments_paid`, grant access + Drip + SD-ORDER on the first cycle, guarded
on the Stripe **invoice id** in the `events` log via
`course.installment.recorded`) — is shared by the webhook and the reconcile, so
they converge and can't double-count.

**The same hole opens mid-plan**, and that one was live until July 2026: the
sweep only ever looked at rows stuck at **0/N**. A plan whose first cycle *was*
recorded (by the checkout backstop) and whose later cycles were not sits at
status `paid`, so nothing re-checked it — the €349×3 plan above read "1/3 paid ·
2 left" on the future-revenue page (and counted a third of its revenue in
`/admin/stats` + the SD-REPORT digests, since `collectedMinorOf` prorates by
`installments_paid`) while Stripe had charged all three.

`invoice.paid` itself has a silent failure mode worth knowing: Stripe's
**2025-04-30 "basil"** API version moved `invoice.subscription` →
`invoice.parent.subscription_details.subscription` (same for the metadata, and
`payment_intent` → `payments.data[].payment.payment_intent`), and webhook
payloads render at the **endpoint's** pinned version. Reading only the old shape
means a newer endpoint yields no subscription id, the handler 200s, and nothing
is recorded — with Stripe's dashboard still showing a healthy delivery.
`subscriptionIdFromInvoice` / `subscriptionMetadataFromInvoice` /
`paymentIntentFromInvoice` read every shape, and an invoice.paid we still can't
route is logged as `course.invoice.unlinked` instead of vanishing.

The hourly cron therefore also runs `reconcileStripeCourseOrders`
([`src/lib/payments/stripe-reconcile.ts`](src/lib/payments/stripe-reconcile.ts)),
the Stripe sibling of `reconcilePaypalCourseOrders`, in **two passes**:

1. **Stranded rows** — `provider='stripe'`, non-full plan with a
   `stripe_subscription_id`, status `pending` **or** `expired` (a stranded
   pending row is auto-flipped to `expired` after 15 min by
   `expireStaleCoursePendings`) in a 120-day window.
2. **Open plans** — `installments_paid` between 1 and the effective total, whose
   **next installment is ≥2 days overdue** (same calendar-month schedule the
   forecast projects). A healthy plan is filtered out in SQL/JS before any
   Stripe call, so this costs nothing in steady state.

Both list each subscription's **paid** invoices (`listSubscriptionInvoices`,
`GET /v1/invoices?subscription=…&status=paid`, oldest-first), record every
settled cycle through `recordCourseInvoiceIfNew`, and **repair the schedule**
(above). It's otherwise **read-only** against Stripe (never creates a charge or
subscription), respects an admin cancel/refund (a `refunded` row is skipped; a
`cancelled` one may count up but is never granted access — recording only ever
happens for rows that already hold ≥1 installment), never performs the terminal
cancelled flip itself (the webhook's job), and tolerates per-row errors. It
**no-ops entirely until `STRIPE_SECRET_KEY` is set**. A manual **"Sync from
Stripe now"** button on `/admin/courses/future-revenue`
(`/api/admin/courses/stripe-reconcile`, admin-gated, wider cap) forces the same
sweep so a stuck plan can be recovered on the spot. This is a *backstop*, not the
fix — if Stripe subscriptions stall, first check the webhook endpoint is
subscribed to `invoice.paid` (plus `customer.subscription.*`); the audit panel
tells you whether it is.

**A finished plan is not a cancelled one.** Every installment plan ends via
`cancel_at`, which fires `customer.subscription.deleted` — and that handler used
to flip the row to `status='cancelled'`, so *every* completed plan read as
cancelled on the orders page and in the sales digests. It now only cancels a plan
that ended **owing** charges; one that took everything it owed keeps
`status='paid'` and just records `subscription_status='canceled'`.

**Removing a dead not-started plan.** A plan stuck at 0/N whose gateway
subscription no longer exists (e.g. an abandoned PayPal checkout PayPal has since
purged) can't be paid or cancelled the normal way (`isCancellablePlan` requires
`status='paid'`), so it just clutters the watch list. `/admin/courses/future-revenue`
shows a **Remove** button on any **Not started** plan →
`/api/admin/courses/dismiss-plan` (admin-gated): it deletes the stranded row, but
**only after the gateway confirms no money and no live subscription** — any
settled charge or an ACTIVE/APPROVED (PayPal) / active/trialing/past_due (Stripe)
subscription makes it refuse (a not-started row can look identical to the
ACTIVE-but-unrecorded bug above, so removal is guarded; the reconcile records a
real one instead). It best-effort cancels any lingering approval first
(`cancelSubscriptionIfPresent`, tolerant of PayPal 404/422 via `PaypalApiError`),
logs a snapshot, then deletes. A verification error refuses (fail safe).

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

## Meta ad spend — direct pull from the Marketing API

Ad spend feeds `/ads` (cost-per-registration, ROAS) and `/admin/stats`
straight from one table: `workshop_ad_spend` (migration 0021). Two paths write
it, both idempotent and interchangeable:

- **Direct pull** ([`src/lib/ads/meta-insights.ts`](src/lib/ads/meta-insights.ts)):
  `runMetaAdSpendSync` reads the ad account's daily `spend` **per campaign** from
  the Graph Marketing API (`GET /act_<id>/insights?level=campaign&fields=spend,
  account_currency,campaign_name&time_increment=1`, sibling to the Conversions
  API *send* in `src/lib/workshops/meta.ts`) and writes one row per
  (`spend_date`, `campaign`) via `replaceMetaAdSpend` (`workshops/db.ts`) — an
  atomic delete-then-insert over a **rolling 14-day window**, so Meta is the
  single source of truth for its channel inside that window and can't
  double-count against a CSV import. A 14-day window (not just yesterday) absorbs
  Meta's retroactive spend revisions; a (day, campaign) Meta reports as zero
  correctly clears. The replace only runs on a *successful* fetch (a transient
  API error never wipes data). Spend is converted to EUR with the live
  `fx_rates` table (`getFxRatesToEur`), stored in `amount_eur_minor`.
- **CSV import** (`/api/admin/workshops/ad-spend-import`, the old export→import
  flow) still works as a manual fallback/backfill; both write the same daily
  rows (it already reads a `campaign` column when present).

**Prospecting (TOF) vs retargeting** ([`src/lib/ads/campaigns.ts`](src/lib/ads/campaigns.ts)):
now that spend is per-campaign, **cost per registration** is charged against the
**prospecting** campaign only — the one that actually buys new registrations.
The convention: a campaign with **`TOF`** in its name (as a token, delimiter-
tolerant) is prospecting/acquisition; everything else is retargeting.
`isAcquisitionCampaign` classifies it (a **blank** campaign name — legacy
account-level rows, or a CSV with no campaign column — counts as acquisition, so
pre-breakdown windows keep the old "all spend ÷ regs" figure). Cost per
registration = prospecting spend ÷ registrations; **total** ad spend and
**blended ROAS** still count every campaign. `/admin/stats` shows a **By
campaign** table (spend + prospecting/retargeting tag + the product it's charged
to) so the split is verifiable; `/ads` labels its cost-per-registration tiles as
prospecting-based and breaks the "Ad spend" tile into prospecting · retargeting.

**A campaign's money only buys its own product** ([`campaignAudience`](src/lib/ads/campaigns.ts),
August 2026): prospecting runs one campaign per top-of-funnel product —
`… SVH Workshop` and `… SVH Masterclass`. Pooling the two and pricing every
registration off the pool charged masterclass euros to €22 workshop seats and
workshop euros to €44 masterclass seats, so **neither cost per registration was
real** (one blended number for two products bought at different prices). A
campaign is now bucketed by the product its **name** carries — `masterclass`
(tested first, delimiter-tolerant, "master class"/"masterclasses" too) →
masterclass, `workshop`/`workshops` → workshop, anything naming neither (a broad
brand campaign, a blank legacy/CSV name) → **general**, charged across both as
before. A session is a masterclass when its main product slug contains
"masterclass" — the same test the calendar and the bump resolver use. Each
bucket is only ever charged to its own sessions, so
`/admin/workshops/performance`, `/admin/stats` and `/ads` all report **cost per
workshop registration** and **cost per masterclass registration** side by side
(`report.audiences.{workshop,masterclass}`), and the blended
`costPerRegistrationEurMinor` stays only as the mixed headline. On `/admin/stats`
and `/ads` that audience block is rendered as the **ad-economics card** per
product — *spend → made back → ROAS so far*, plus **how much more revenue it
needs to reach 2×** (`ROAS_TARGET` / `roasGapEurMinor` in `stats.ts`). An
audience's `revenueEurMinor` is its own sessions' checkout net **plus** the
standalone 12-week/cert revenue of the people who registered for them, each
buyer counted **once** (summing the per-session rows would count a buyer again
for every session they attended). Adding a third
TOF product = add its token here and its scope in `computeWorkshopPerformance`.

**A registration costs what it cost *that day*** ([`src/lib/ads/allocation.ts`](src/lib/ads/allocation.ts),
July 2026): the per-workshop ad cost used to be one window-wide average — total
spend ÷ total registrations, charged flat to every workshop by registration
count — which smears an expensive week over a cheap one, so a workshop that
filled at €50/seat looked identical to one that filled at €2/seat. Spend is
priced **per day** instead: that day's spend ÷ that day's registrations = the
price of a registration bought that day; every registration carries the price of
the day it came in, and a workshop's cost is the sum of what its own
registrations cost (`allocateSpendPools`, run twice — prospecting spend for the
**TOF cost / workshop ROAS**, total spend for the **Meta cost / blended ROAS**).
Registrations on a day with no spend are free, as before. Each run allocates
**one pool per campaign audience** (workshop / masterclass / general, above),
priced day by day against the registrations **in that pool's scope** — so a
day's masterclass price is that day's masterclass spend ÷ that day's masterclass
registrations, and a session's cost is the sum of its own registrations' prices
plus its share of any general campaign. **Spend on a day with no registrations
of its own product** can't be priced against a registration, so it is spread
evenly over that product's registrations in the window
(`unattributedAcquisitionSpendEurMinor` — the old flat treatment, now applied
inside the pool). A pool whose product took **no registration at all** in the
window is reported as `unallocatedAcquisitionSpendEurMinor` and charged to
nothing: smearing it onto the other product's seats is precisely the
mis-attribution the split removes, so the per-workshop columns intentionally
stop summing to total prospecting spend by exactly that amount (footnoted
wherever non-zero). `WorkshopPerformanceRow.costPerRegistrationEurMinor` is a
session's own day-weighted seat price, out of its own product's budget;
`dailyCosts` on the report is the day-by-day ledger with a price *per product*
(shown as a table on `/admin/workshops/performance`, and the `/ads`
cost-per-registration chart, which stays blended).

**Cadence**: rides the existing **hourly** cron (`worker-entrypoint.ts`),
self-gating via a `meta_ad_spend_synced_at` marker in `workshop_config` to the
first tick at/after **06:00 Europe/Brussels**, at most once per Brussels
calendar day (mirroring the SD-REPORT digest's 08:00 hold); a failed run
leaves the marker untouched so the next tick retries later the same morning.
**No-ops entirely** until the secrets are set, so deploying it changes nothing
until the owner opts in.

**Today's spend is live** (`syncTodayAdSpend`, August 2026): the daily cron is
right for history and useless for "what has today cost me so far", so opening
**`/admin/stats`** or **`/ads`** pulls the current day from Meta *inline*,
before the page's figures are computed — the ROAS and seat prices you read are
minutes old. It is deliberately cheap and unfailable: **2 days** only (today +
the previous UTC day, since Meta buckets in the ad account's timezone), its own
`meta_ad_spend_live_synced_at` marker (never satisfies or starves the daily
14-day sync), throttled to once a minute across all viewers with the marker
stamped at *attempt* time (a broken token backs off too), an 8s hard timeout,
and every error swallowed into a result the page reports as "⚠ live Meta sync
failed" rather than a 500. Both pages also **open on today** (`resolvePeriod`
takes a fallback preset; everything else still defaults to all-time).

**Setup** (Meta side is the only real work):
- **`META_AD_ACCOUNT_ID`** — the ad account, `act_1234567890` or bare
  `1234567890`.
- **`META_ADS_TOKEN`** — a token with the **`ads_read`** permission on that
  account. A **non-expiring System User token** (Business Settings → System
  Users) is ideal for a server cron. Falls back to `META_ACCESS_TOKEN`, but the
  Conversions API token usually lacks `ads_read`, so set this one explicitly.
- Optional **`META_API_VERSION`** overrides the Graph version (default `v21.0`).

**Manual trigger**: `/admin/stats` → "Pull from Meta now" button
(`/api/admin/workshops/ad-spend-sync`, admin-gated) forces a sync (bypasses the
daily gate) so the token/account can be verified and today's spend land at once.

Caveats: Meta's daily buckets are in the ad account's timezone (registrations
bucket by `created_at` UTC — the same minor imprecision the CSV import already
had, no regression); if the account currency has no EUR rate, `amount_eur_minor`
is null and the sync flags `fxMissing`.

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
  - **Don't double-send with Drip** (`in-drip` tag): the contacts list was a CSV
    import from a Drip export (those people are no longer in Drip), but every site
    **buyer** is pushed to Drip *and* mirrored into contacts — so buyers live in
    both lists. The purchase mirror stamps every buyer with a single `in-drip`
    tag (`IN_DRIP_TAG`, `src/lib/contacts/mirror.ts`; migration 0069 backfilled
    the history) — a marker a pure CSV row can never carry, so it cleanly
    separates "also in Drip" from the shared product tags (which the CSV also
    carried). Put `in-drip` in a broadcast's **exclude tags** to mail buyers from
    Drip only and the CSV cohort from here — nobody twice. (Edge: someone who
    re-entered Drip via a newsletter opt-in rather than a purchase isn't mirrored,
    so isn't tagged.)
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

## Music albums — buyer-only mantra players

Gated audio albums (e.g. the mantra album sold as a checkout bump), managed at
the bottom of `/admin` → **Music albums** (`/admin/music`). Tables
`music_albums` + `music_tracks` (migration 0076); logic in
[`src/lib/music/`](src/lib/music/) (`db.ts` CRUD, `access.ts` signing/entitlement).

- **Admin**: `/admin/music` lists/creates albums; `/admin/music/<id>` is the
  workspace — cover (drag/click, public R2 `music-covers/`), title/slug/
  description, **Drip tag** (the access key), published toggle, audio dropzone
  (MP3/M4A/WAV/FLAC/OGG, ≤90 MB per file, one request per file), track
  rename/reorder/delete with inline preview players, and the copyable public
  player link.
- **Access model — email is the login** (same trust model as `/access`): each
  album stores a `drip_tag`; the product/bump automation applies that tag on
  payment, so the buyer's checkout email carries it in Drip. The player page
  `/music/<slug>` shows an email gate → `/api/music/login` checks the tag via
  `getSubscriber` and sets the **`sd_music` cookie** (HMAC-signed email, 30
  days, domain-separated from the admin session's MAC so the tokens are never
  interchangeable). Admin sessions always pass (and are the only way to see an
  unpublished album). No tag configured / Drip unset / Drip error → deny
  (fail closed; support@ is the fallback in the gate copy).
  **Drip is never the only path.** Tagging on a paid registration is
  best-effort and never retried, so one API blip used to hide a paid album
  forever. `hasAlbumAccess` therefore also grants from D1 —
  `workshopBumpTagsForEmail` ([`src/lib/workshops/bump.ts`](src/lib/workshops/bump.ts)):
  every order-bump Drip tag this email has actually paid for, read from the same
  two signals that grant the tag (a `workshop_purchases` bump line, or
  `wants_bump` on a paid/coupon seat with no bump line). `/access` merges those
  tags into its own lookup, so **"Your music" appears whether or not Drip
  agrees.** Anything that gates on a music album must use these paths, not
  `getSubscriber` alone.
- **Audio is never public**: tracks live under the R2 **`music-audio/`** prefix,
  which `/media/[...key]` refuses to serve. Playback uses **short-lived signed
  URLs** (`/api/music/stream/<track>?e=…&s=…`, 12h HMAC) minted server-side
  only after the entitlement check — so seeking (many Range requests) never
  hits Drip. Range serving is shared with `/media` via `parseRange` /
  `r2RangeResponse` in `src/lib/media.ts`. Covers are ordinary public media.
- **/access integration**: the `/access` lookup matches the subscriber's tags
  against published albums (`listAlbumsForTags`) and shows a "Your music"
  block with player links; finding any also sets the `sd_music` cookie so the
  links open straight into the player.
- **Player** (`/music/[album].astro`, SiteLayout): cover + description, track
  list, sticky bottom bar (play/pause/prev/next/seek), auto-advance, and Media
  Session metadata for phone lock screens.
- **Selling an album** (migration 0077 + [`src/lib/music/product.ts`](src/lib/music/product.ts)):
  set a **price (EUR)** in the album settings and `/music/<slug>` renders a
  full **sales page** for non-owners — cover/description hero, the track list
  (names + durations; the audio itself stays gated), a checkout card, and an
  "Already own this album?" email-login section at the bottom; blank price =
  login-only gate (bump/course bonus). **Multi-currency**: the one EUR price
  scales to each market with the journeys' EUR-relative ratios
  (`albumPriceCents`, clean-rounded; kr currencies to the nearest 5). The
  visitor's edge country picks the opening currency, the form's country select
  repaints every price client-side, and the checkout re-derives it server-side
  from the same function, so headline and charge always agree. The purchase
  rides the ordinary **course machinery** as
  product slug `album-<id>` — `/api/music/checkout` (journey-checkout sibling:
  full payment, B2C, Stripe + direct PayPal) → `course_registrations`
  → the shared paid-handler, which looks the album up and applies its
  `drip_tag` (`courseDripTags` returns `[]` for album slugs so they can never
  fall through to the cert tags). Every fulfilment backstop (webhooks, PayPal
  return, reconciles, admin mark-paid, SD-ORDER, Drip order mirror, Meta CAPI)
  works unchanged. **Entitlement is two-path** (`hasAlbumAccess`): the Drip tag
  *or* a paid `album-<id>` registration row — so a fresh buyer returning via
  `?welcome=1` plays immediately, before Drip has seen the order, and a Drip
  outage never locks paying buyers out.
- **/music is the music home** (`/music/index.astro`), the **"Music" tab** in
  the site menu (`src/data/nav.ts` tail links — it replaced the Songdeck link):
  lists the Songdeck + every published album with cover/price. **The Songdeck
  page moved** from `/courses/songdeck` to `/music/songdeck` (it's a music
  product, not a course); 301s for the old paths live in the `MOVED_URLS` map
  in `src/worker-entrypoint.ts`. Album slugs `songdeck`/`index`/`stream` are
  reserved (static routes shadow `/music/[album]`).

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
