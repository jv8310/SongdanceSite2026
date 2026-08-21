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
  A `?discount=N` override still wins outright and still only touches the
  12-week line. `variant.ts` bundle rows must stay = cert + 12-week per
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

## Refunds in the stats — netted at the sale, reported at the refund

Every revenue figure (`/admin/stats`, `/ads`, the SD-REPORT digests) is dated by
the **sale** and carries its refunds netted off. That is the right way to judge a
product — a refunded sale must not read as a good one — but on its own it hides
the money: with a 30-day guarantee the refund usually lands in a *later* month
than the sale, so it silently rewrote the month sold and never appeared in the
month paid out. Four rules now, and code that touches money must keep them:

- **One splitter, never re-derive.** `collectedSplitOf`
  ([`src/lib/workshops/stats.ts`](src/lib/workshops/stats.ts)) is the only place
  that says what a course row collected. `amount_cents` is the **course price
  only** — order bumps (ASJ €99, Grief €49) are charged as their own line and
  live in the `bumps` JSON — so the refund is allocated **pro-rata across course
  + bumps**. Subtracting it from the course line alone drove that line negative
  and `max(0, …)` ate the difference, while a separate un-refund-aware query
  still billed the bump at full price. `computeCourseSales` returns the bumps
  breakdown (`courses.bumps`); the digest and `/ads` **read that** — the two
  copies of the bump aggregation they each carried are gone.
- **A fully refunded order is not a sale.** It's skipped from counts *and*
  revenue (surfaced as `fullyRefundedCount`), instead of reading "1 sale, €0".
- **`computeRefunds` is the refund view**, dated by `refunded_at`, split into
  `againstWindowSalesEurMinor` (already deducted from the revenue above) and
  `againstEarlierSalesEurMinor` (**reflected nowhere else** — the number that
  was invisible). It is reported *beside* revenue, never folded into it: netting
  it there would double-count the in-window part. Caveat: `refunded_at` is
  stamped on the first refund, so a refund given in two parts months apart is
  dated wholly to the first — the total is right, its placement can be early.
  Retreats are excluded (retreat revenue isn't in these figures either).
- **Workshop refunds are partial-capable** (migration 0082:
  `workshop_payments.refunded_amount_minor` + `refunded_at`). `status =
  'refunded'` now means **fully** refunded; a partial stays `'paid'` and carries
  the amount, so the existing `status = 'paid'` readers keep the row and
  subtract only what came back (`collectedShareOf`). Before this, refunding €5
  of a €22 ticket erased the whole €22 and left the order un-refundable for the
  rest. Both writers — `handleWorkshopRefund` (Stripe, passed the per-refund
  delta) and `recordPaypalRefund` — accumulate through
  `recordWorkshopPaymentRefund`, and only a full refund marks the **seat**
  refunded (so a partial keeps its bump/music access).

**PayPal installment refunds**: a plan row stores only the *first* sale id
(`paypal_capture_id = COALESCE(…)`), so a refund against cycle 2/3 — e.g. issued
in the PayPal dashboard — matched nothing and was logged
`paypal.refund.unmatched`, money still on the books. `recordPaypalRefund` now
falls back to the **events ledger** (`paypal.course.installment.<saleId>`, which
every recorded cycle and setup-fee sale writes with its plan id) before trying
the workshop tables.

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
campaign** table (spend + prospecting/retargeting tag) so the split is
verifiable; `/ads` labels its "Cost / registration" as prospecting-based and
breaks the "Ad spend" tile into prospecting · retargeting.

**A registration costs what it cost *that day*** ([`src/lib/ads/allocation.ts`](src/lib/ads/allocation.ts),
July 2026): the per-workshop ad cost used to be one window-wide average — total
spend ÷ total registrations, charged flat to every workshop by registration
count — which smears an expensive week over a cheap one, so a workshop that
filled at €50/seat looked identical to one that filled at €2/seat. Spend is
priced **per day** instead: that day's spend ÷ that day's registrations = the
price of a registration bought that day; every registration carries the price of
the day it came in, and a workshop's cost is the sum of what its own
registrations cost (`allocateSpendByDay`, run twice — prospecting spend for the
**TOF cost / workshop ROAS**, total spend for the **Meta cost / blended ROAS**).
Registrations on a day with no spend are free, as before. **Spend on a day with
no registrations at all** can't be priced against a registration, so it is spread
evenly over the window's registrations — the old flat treatment, applied only to
the part the daily model can't place; that keeps the per-workshop columns summing
to the spend actually made, so the window figures (`costPerRegistrationEurMinor`
= total prospecting spend ÷ total registrations) are **unchanged** and still
reconcile. Only the *distribution across workshops* moves — which is the point.
`WorkshopPerformanceRow.costPerRegistrationEurMinor` is a workshop's own
day-weighted seat price; `dailyCosts` on the report is the day-by-day ledger
(shown as a table on `/admin/workshops/performance`, and already the `/ads`
cost-per-registration chart), and `unattributedAcquisitionSpendEurMinor` is the
spread residue, footnoted wherever it's non-zero.

**Cadence**: rides the existing **hourly** cron (`worker-entrypoint.ts`),
self-gating via a `meta_ad_spend_synced_at` marker in `workshop_config` to the
first tick at/after **06:00 Europe/Brussels**, at most once per Brussels
calendar day (mirroring the SD-REPORT digest's 08:00 hold); a failed run
leaves the marker untouched so the next tick retries later the same morning.
**No-ops entirely** until the secrets are set, so deploying it changes nothing
until the owner opts in.

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
