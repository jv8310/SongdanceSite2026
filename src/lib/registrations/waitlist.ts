// Retreat waiting list — join when full, be offered the place that frees up.
//
// Table: retreat_waitlist (migration 0080). One row per (retreat, email).
//
// The shape of the thing:
//   1. The retreat sells out. The public form shows a join panel instead of a
//      dead end; a join writes a `waiting` row (upsert on email).
//   2. A place frees up (cancellation, a room put back on sale). The admin
//      offers it to someone from /admin/retreats/<slug> → the row flips to
//      `invited`, carrying a claim token and an expiry.
//   3. That offer HOLDS the place, and GIVES it: `countActiveOffersByTier` is
//      subtracted from public availability for the offered tier, so a walk-in
//      can't take the seat that was promised — while for the invited person,
//      arriving with their token, that tier reads open (`applyClaim`), so the
//      link that invited them can actually buy the place it names.
//   4. They book through the ordinary checkout. The row records the
//      registration and flips to `booked` when the money lands
//      (settleWaitlistOnPaid, called from every paid path).
//
// A hold is per TIER, not per bed: an offer on "Twin cabin – lower deck"
// reserves one place in that tier. In the château room model tiers can share a
// physical room (a multi-mode room counts toward two tiers), so a booking on a
// *different* tier can still consume the same bed — the same coupling that
// already exists between two ordinary bookings. Offering the tier the guest
// actually wants is what makes the hold meaningful.

import { computeTierAvailability, logEvent, type TierAvailability } from './db';

export type WaitlistStatus =
  | 'waiting'
  | 'invited'
  | 'booked'
  | 'declined'
  | 'expired'
  | 'removed';

export type WaitlistEntry = {
  id: number;
  product_id: number;
  tier_id: number | null;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  phone_country: string | null;
  country: string | null;
  party_size: number;
  notes: string | null;
  source: string;
  status: WaitlistStatus;
  claim_token: string | null;
  offered_tier_id: number | null;
  offered_at: string | null;
  offer_expires_at: string | null;
  offer_count: number;
  responded_at: string | null;
  registration_id: number | null;
  created_at: string;
  updated_at: string;
};

// A row plus what the admin view needs to read it at a glance.
export type WaitlistEntryView = WaitlistEntry & {
  position: number | null;          // queue number among people still waiting
  tier_name: string | null;         // preferred room/cabin
  offered_tier_name: string | null; // what was offered
  offer_live: boolean;              // offer still claimable right now
  registration_status: string | null;
};

// How long an offered place is held, unless the admin picks otherwise.
export const DEFAULT_OFFER_HOURS = 48;
export const OFFER_HOUR_CHOICES = [24, 48, 72, 120, 168] as const;

// Statuses that still occupy a slot in the queue.
export const OPEN_STATUSES: WaitlistStatus[] = ['waiting', 'invited'];

// Where each retreat's public registration form lives, so a claim link can
// land on the page that actually sells the place. A retreat missing from this
// map still works — the admin can copy the claim link by hand — but adding the
// slug here is what makes the offer email one click.
export const RETREAT_PAGE_PATHS: Record<string, string> = {
  'ritual-of-belonging-2026': '/retreats/ritual-of-belonging',
  'dolphin-and-sound-2026': '/retreats/dolphin-and-sound',
};

export function retreatPagePath(productSlug: string): string | null {
  return RETREAT_PAGE_PATHS[productSlug] ?? null;
}

// The link that opens the retreat's own form with the place unlocked.
export function claimUrl(
  baseUrl: string,
  productSlug: string,
  token: string,
): string | null {
  const path = retreatPagePath(productSlug);
  if (!path) return null;
  return `${baseUrl.replace(/\/+$/, '')}${path}?claim=${encodeURIComponent(token)}#register`;
}

// SQLite writes `YYYY-MM-DD HH:MM:SS` (UTC, no zone marker). Every comparison
// against datetime('now') therefore has to stay in that format — which is why
// expiries are computed in SQL, not in JS.
export function sqliteToIso(raw: string | null): string | null {
  if (!raw) return null;
  return raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
}

// "27–29 November 2026" from a product's own start/end dates.
export function dateRangeLabel(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const fmt = (iso: string, withMonth: boolean, withYear: boolean) => {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      ...(withMonth ? { month: 'long' as const } : {}),
      ...(withYear ? { year: 'numeric' as const } : {}),
    }).format(d);
  };
  if (!end || end.slice(0, 10) === start.slice(0, 10)) return fmt(start, true, true);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${fmt(start, !sameMonth, false)}–${fmt(end, true, true)}`;
}

export function waitlistDisplayName(e: {
  first_name: string;
  last_name: string | null;
  email: string;
}): string {
  const name = `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
  return name || e.email;
}

// The schema and the code ship on two workflows (d1-migrate + deploy), and a
// preview version runs against production D1 — so there are windows where this
// code is live and `retreat_waitlist` isn't there yet. Nothing about a waiting
// list is worth 500-ing a checkout over: reads and side-effects degrade to
// "nobody is on the list, nothing is held", which is exactly how the site
// behaved before this feature. A real SQL error still throws.
function isMissingTable(err: unknown): boolean {
  return /no such table:\s*retreat_waitlist/i.test(
    err instanceof Error ? err.message : String(err),
  );
}

async function tolerant<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isMissingTable(err)) {
      console.warn('[waitlist] retreat_waitlist missing — migration 0080 not applied yet');
      return fallback;
    }
    throw err;
  }
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const SELECT_COLS = `id, product_id, tier_id, first_name, last_name, email,
       phone, phone_country, country, party_size, notes, source, status,
       claim_token, offered_tier_id, offered_at, offer_expires_at, offer_count,
       responded_at, registration_id, created_at, updated_at`;

// ─────────────────────────── joining ───────────────────────────

export type JoinInput = {
  product_id: number;
  tier_id: number | null;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  phone_country: string | null;
  country: string | null;
  party_size?: number;
  notes: string | null;
  source?: 'public' | 'admin';
};

export type JoinResult = {
  entry: WaitlistEntry;
  /** false when this email was already on the list (we updated it instead). */
  created: boolean;
  /** true when a closed entry (declined / removed / lapsed) went back on. */
  rejoined: boolean;
};

// Put someone on the list, or refresh what we know about them if they're
// already on it. Never duplicates, never demotes: an entry that already holds
// an offer (or has booked) keeps its status and its place in the queue — only
// the contact details and preference are refreshed.
export async function joinWaitlist(
  db: D1Database,
  input: JoinInput,
): Promise<JoinResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await db
    .prepare(
      `SELECT ${SELECT_COLS} FROM retreat_waitlist WHERE product_id = ? AND email = ?`,
    )
    .bind(input.product_id, email)
    .first<WaitlistEntry>();

  if (existing) {
    // Someone who left the list (declined / removed / a lapsed offer) and
    // comes back goes to the *back* of the queue — the people who waited
    // through keep their place.
    const rejoining =
      existing.status === 'declined' ||
      existing.status === 'removed' ||
      existing.status === 'expired';
    await db
      .prepare(
        `UPDATE retreat_waitlist
            SET first_name = ?, last_name = ?, phone = ?, phone_country = ?,
                country = ?, party_size = ?, notes = COALESCE(?, notes),
                tier_id = COALESCE(?, tier_id),
                status = CASE WHEN ? = 1 THEN 'waiting' ELSE status END,
                created_at = CASE WHEN ? = 1 THEN datetime('now') ELSE created_at END,
                updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(
        input.first_name,
        input.last_name,
        input.phone,
        input.phone_country,
        input.country,
        input.party_size ?? existing.party_size ?? 1,
        input.notes,
        input.tier_id,
        rejoining ? 1 : 0,
        rejoining ? 1 : 0,
        existing.id,
      )
      .run();
    const entry = await getEntry(db, existing.id);
    return { entry: entry ?? existing, created: false, rejoined: rejoining };
  }

  const row = await db
    .prepare(
      `INSERT INTO retreat_waitlist
         (product_id, tier_id, first_name, last_name, email, phone, phone_country,
          country, party_size, notes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING ${SELECT_COLS}`,
    )
    .bind(
      input.product_id,
      input.tier_id,
      input.first_name,
      input.last_name,
      email,
      input.phone,
      input.phone_country,
      input.country,
      input.party_size ?? 1,
      input.notes,
      input.source ?? 'public',
    )
    .first<WaitlistEntry>();
  if (!row) throw new Error('Failed to write waiting-list entry');
  return { entry: row, created: true, rejoined: false };
}

// ─────────────────────────── reading ───────────────────────────

export async function getEntry(
  db: D1Database,
  id: number,
): Promise<WaitlistEntry | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLS} FROM retreat_waitlist WHERE id = ?`)
    .bind(id)
    .first<WaitlistEntry>();
  return row ?? null;
}

// The claim link's entry, if the token is real and the offer is still live.
// Returns null for an unknown, spent or lapsed token — the caller shows the
// ordinary "this offer has ended" copy either way.
export async function getLiveOfferByToken(
  db: D1Database,
  token: string,
): Promise<WaitlistEntry | null> {
  const clean = token.trim();
  if (!clean) return null;
  return tolerant(async () => {
    const row = await db
      .prepare(
        `SELECT ${SELECT_COLS} FROM retreat_waitlist
          WHERE claim_token = ?
            AND status = 'invited'
            AND (offer_expires_at IS NULL OR offer_expires_at > datetime('now'))`,
      )
      .bind(clean)
      .first<WaitlistEntry>();
    return row ?? null;
  }, null);
}

// Everyone on a retreat's list, newest offers first, then queue order.
export async function listWaitlist(
  db: D1Database,
  productId: number,
): Promise<WaitlistEntryView[]> {
  return tolerant(() => listWaitlistRows(db, productId), []);
}

async function listWaitlistRows(
  db: D1Database,
  productId: number,
): Promise<WaitlistEntryView[]> {
  const q = await db
    .prepare(
      `SELECT w.id, w.product_id, w.tier_id, w.first_name, w.last_name, w.email,
              w.phone, w.phone_country, w.country, w.party_size, w.notes,
              w.source, w.status, w.claim_token, w.offered_tier_id, w.offered_at,
              w.offer_expires_at, w.offer_count, w.responded_at, w.registration_id,
              w.created_at, w.updated_at,
              t.name  AS tier_name,
              ot.name AS offered_tier_name,
              r.status AS registration_status,
              CASE WHEN w.status = 'invited'
                    AND (w.offer_expires_at IS NULL OR w.offer_expires_at > datetime('now'))
                   THEN 1 ELSE 0 END AS offer_live
         FROM retreat_waitlist w
         LEFT JOIN tiers t  ON t.id  = w.tier_id
         LEFT JOIN tiers ot ON ot.id = w.offered_tier_id
         LEFT JOIN registrations r ON r.id = w.registration_id
        WHERE w.product_id = ?
        ORDER BY CASE w.status
                   WHEN 'invited' THEN 0
                   WHEN 'waiting' THEN 1
                   WHEN 'booked'  THEN 2
                   ELSE 3
                 END,
                 w.created_at, w.id`,
    )
    .bind(productId)
    // SQLite has no booleans — offer_live comes back as 0/1.
    .all<Omit<WaitlistEntryView, 'offer_live' | 'position'> & { offer_live: number }>();

  const rows: WaitlistEntryView[] = (q.results ?? []).map((r) => ({
    ...r,
    offer_live: Number(r.offer_live) === 1,
    position: null,
  }));

  // Queue position counts only the people still waiting for a place, in join
  // order — so "#1" always means "the next one up".
  const queue = rows
    .filter((r) => r.status === 'waiting')
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id));
  const positions = new Map<number, number>();
  queue.forEach((r, i) => positions.set(r.id, i + 1));

  return rows.map((r) => ({ ...r, position: positions.get(r.id) ?? null }));
}

// How many people are still waiting on a retreat (for the retreats index).
export async function countWaiting(
  db: D1Database,
  productId: number,
): Promise<{ waiting: number; invited: number }> {
  return tolerant(async () => {
    const row = await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END), 0) AS waiting,
           COALESCE(SUM(CASE WHEN status = 'invited'
                              AND (offer_expires_at IS NULL OR offer_expires_at > datetime('now'))
                             THEN 1 ELSE 0 END), 0) AS invited
           FROM retreat_waitlist
          WHERE product_id = ?`,
      )
      .bind(productId)
      .first<{ waiting: number; invited: number }>();
    return { waiting: row?.waiting ?? 0, invited: row?.invited ?? 0 };
  }, { waiting: 0, invited: 0 });
}

// Waiting counts for several retreats at once (the retreats index).
export async function countWaitingByProduct(
  db: D1Database,
): Promise<Map<number, number>> {
  return tolerant(async () => {
    const q = await db
      .prepare(
        `SELECT product_id, COUNT(*) AS n FROM retreat_waitlist
          WHERE status = 'waiting'
          GROUP BY product_id`,
      )
      .all<{ product_id: number; n: number }>();
    const map = new Map<number, number>();
    for (const row of q.results ?? []) map.set(row.product_id, row.n);
    return map;
  }, new Map<number, number>());
}

// Where someone sits in the queue right now (1-based), or null if they're not
// waiting. Used by the join confirmation email.
export async function queuePosition(
  db: D1Database,
  entry: WaitlistEntry,
): Promise<number | null> {
  if (entry.status !== 'waiting') return null;
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM retreat_waitlist
        WHERE product_id = ?
          AND status = 'waiting'
          AND (created_at < ? OR (created_at = ? AND id <= ?))`,
    )
    .bind(entry.product_id, entry.created_at, entry.created_at, entry.id)
    .first<{ n: number }>();
  return row?.n ?? null;
}

// ─────────────────────────── holds ───────────────────────────

// Places currently held by live offers, per tier.
//
// An offer holds its place until the booking it produced takes that place
// itself — never both at once, in either direction:
//
//   • paid → the registration occupies the place; the hold lifts.
//   • pending with a room assigned (the château, where a booking takes its
//     room the moment checkout starts) → already counted; the hold lifts.
//   • pending with no room (the boat: "free until paid", migration 0074) →
//     counted nowhere, so the hold must stand, or the promised place would go
//     back on sale while the guest is on the payment page.
//
// `exceptEntryId` is the invited person's own entry, so their claim link sees
// the place kept for them.
export async function countActiveOffersByTier(
  db: D1Database,
  productId: number,
  opts: { exceptEntryId?: number | null } = {},
): Promise<Map<number, number>> {
  return tolerant(
    () => activeOffersByTier(db, productId, opts),
    new Map<number, number>(),
  );
}

async function activeOffersByTier(
  db: D1Database,
  productId: number,
  opts: { exceptEntryId?: number | null },
): Promise<Map<number, number>> {
  const q = await db
    .prepare(
      `SELECT w.offered_tier_id AS tier_id, COUNT(*) AS n
         FROM retreat_waitlist w
        WHERE w.product_id = ?
          AND w.id <> ?
          AND w.status = 'invited'
          AND w.offered_tier_id IS NOT NULL
          AND (w.offer_expires_at IS NULL OR w.offer_expires_at > datetime('now'))
          AND NOT EXISTS (
                SELECT 1 FROM registrations r
                 WHERE r.id = w.registration_id
                   AND (r.status = 'paid'
                        OR (r.status = 'pending'
                            AND r.inventory_unit_id IS NOT NULL
                            AND (r.hold_expires_at IS NULL
                                 OR r.hold_expires_at > datetime('now'))))
              )
        GROUP BY w.offered_tier_id`,
    )
    .bind(productId, opts.exceptEntryId ?? -1)
    .all<{ tier_id: number; n: number }>();
  const map = new Map<number, number>();
  for (const row of q.results ?? []) map.set(row.tier_id, row.n);
  return map;
}

// Starting a second checkout on the same claim link releases the first one.
//
// An unfinished checkout keeps its room for 30 minutes. Without this, an
// invited guest who goes back and re-submits would quietly hold two rooms —
// and the second one could be the place promised to the next person on the
// list. So the previous attempt's hold is expired the moment they start
// another: one offer, one live booking. (An old checkout that is nonetheless
// paid still fulfils — the payment webhook works off the session id, not the
// hold.)
export async function releaseClaimCheckoutHold(
  db: D1Database,
  claim: WaitlistEntry | null,
): Promise<void> {
  if (!claim?.registration_id) return;
  // registrations always exists; no table guard needed here.
  await db
    .prepare(
      `UPDATE registrations
          SET hold_expires_at = datetime('now')
        WHERE id = ?
          AND status = 'pending'
          AND (hold_expires_at IS NULL OR hold_expires_at > datetime('now'))`,
    )
    .bind(claim.registration_id)
    .run();
}

// What a visitor may actually book: the room model's own remaining count,
// minus the places held for people on the waiting list.
export function applyHolds(
  availability: TierAvailability[],
  holds: Map<number, number>,
): TierAvailability[] {
  if (holds.size === 0) return availability;
  return availability.map((a) => ({
    ...a,
    remaining: Math.max(0, a.remaining - (holds.get(a.tier.id) ?? 0)),
  }));
}

// An offer is a place, not only a hold. Excluding the claimant's own hold is
// half the rule: it hands the place back only when the room model already had
// it free. It usually doesn't — a retreat is offered from its waiting list
// precisely because it is sold out, and the admin may offer the moment a
// cancellation is *known* ("you can still make an offer … it simply holds a
// place the retreat doesn't have yet", /admin/retreats/<slug>), before the
// booking that frees the bed has actually gone.
//
// So for the person holding a live claim, their offered tier reads open —
// whatever the rest of the retreat looks like. `Math.max(remaining, 1)`, not
// `+1`: their own hold was already excluded, so this promises the one place
// they were offered and never a second one. Everybody else still sees the
// tier full, because their holds are still subtracted.
//
// Without it the invited guest is turned away by the very link that invited
// them: the booking form refuses the cabin at checkout, and the waiting-list
// panel replaces the form altogether with "Every place is taken".
export function applyClaim(
  availability: TierAvailability[],
  claim: WaitlistEntry | null,
): TierAvailability[] {
  const tierId = claim?.offered_tier_id;
  if (!tierId) return availability;
  return availability.map((a) =>
    a.tier.id === tierId ? { ...a, remaining: Math.max(a.remaining, 1) } : a,
  );
}

// The three together — the one answer to "what may this visitor book right
// now": the room model, minus the places promised to other people, plus the
// place promised to this one. Every public availability read goes through
// here (the availability endpoint and both retreat checkouts), so what a
// claim link shows and what it is allowed to buy can't drift apart.
export async function availabilityForVisitor(
  db: D1Database,
  productId: number,
  claim: WaitlistEntry | null = null,
): Promise<TierAvailability[]> {
  const [availability, holds] = await Promise.all([
    computeTierAvailability(db, productId),
    countActiveOffersByTier(db, productId, { exceptEntryId: claim?.id ?? null }),
  ]);
  return applyClaim(applyHolds(availability, holds), claim);
}

// ─────────────────────────── offering ───────────────────────────

export type OfferResult =
  | { ok: true; entry: WaitlistEntry; token: string }
  | { ok: false; error: string };

// Offer a place to one person: mint a claim token, hold the tier, and stamp
// the expiry. Re-offering the same person (a resend, or a longer window)
// refreshes the token so an old forwarded link can't be used.
export async function offerPlace(
  db: D1Database,
  entryId: number,
  opts: { tierId: number; hours?: number; by?: string },
): Promise<OfferResult> {
  const entry = await getEntry(db, entryId);
  if (!entry) return { ok: false, error: 'not-found' };
  if (entry.status === 'booked') return { ok: false, error: 'already-booked' };

  const hours = Math.max(1, Math.min(24 * 30, Math.round(opts.hours ?? DEFAULT_OFFER_HOURS)));
  const token = newToken();

  await db
    .prepare(
      `UPDATE retreat_waitlist
          SET status = 'invited',
              claim_token = ?,
              offered_tier_id = ?,
              offered_at = datetime('now'),
              offer_expires_at = datetime('now', ?),
              offer_count = offer_count + 1,
              responded_at = NULL,
              registration_id = NULL,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(token, opts.tierId, `+${hours} hours`, entryId)
    .run();

  const updated = await getEntry(db, entryId);
  if (!updated) return { ok: false, error: 'not-found' };

  await logEvent(db, {
    registration_id: null,
    kind: 'waitlist.offer.sent',
    source: 'admin',
    payload: {
      waitlist_id: entryId,
      email: entry.email,
      tier_id: opts.tierId,
      hours,
      offer_count: updated.offer_count,
      by: opts.by ?? null,
    },
  });

  return { ok: true, entry: updated, token };
}

// Take an offer back (the place went elsewhere, or it was a mis-click): the
// hold is released and the person returns to the queue.
export async function withdrawOffer(
  db: D1Database,
  entryId: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE retreat_waitlist
          SET status = 'waiting', claim_token = NULL, offered_tier_id = NULL,
              offered_at = NULL, offer_expires_at = NULL,
              registration_id = NULL, updated_at = datetime('now')
        WHERE id = ? AND status = 'invited'`,
    )
    .bind(entryId)
    .run();
}

// Admin-set status: 'declined' (they said no), 'removed' (off the list),
// 'waiting' (put back on it), 'booked' (booked outside the claim link).
export async function setStatus(
  db: D1Database,
  entryId: number,
  status: WaitlistStatus,
): Promise<void> {
  const clearsOffer = status !== 'invited';
  await db
    .prepare(
      `UPDATE retreat_waitlist
          SET status = ?,
              claim_token = CASE WHEN ? = 1 THEN NULL ELSE claim_token END,
              responded_at = CASE WHEN ? IN ('declined','booked') THEN datetime('now') ELSE responded_at END,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(status, clearsOffer ? 1 : 0, status, entryId)
    .run();
}

// The claim link was used: remember which booking came out of it. The row
// stays `invited` (so the place stays held through checkout) until the money
// actually lands — see settleWaitlistOnPaid.
export async function attachRegistration(
  db: D1Database,
  entryId: number,
  registrationId: number,
): Promise<void> {
  await tolerant(
    () =>
      db
        .prepare(
          `UPDATE retreat_waitlist
              SET registration_id = ?, updated_at = datetime('now')
            WHERE id = ?`,
        )
        .bind(registrationId, entryId)
        .run(),
    undefined,
  );
}

// Called from every paid path (Stripe webhook, PayPal fulfilment, admin
// "Mark paid"). Closes the waiting-list entry whose claim produced this
// booking, which also releases its hold. Silent no-op for the ordinary
// registrations that never came off a waiting list.
export async function settleWaitlistOnPaid(
  db: D1Database,
  registrationId: number,
): Promise<void> {
  await tolerant(async () => {
    const res = await db
      .prepare(
        `UPDATE retreat_waitlist
            SET status = 'booked', claim_token = NULL,
                responded_at = COALESCE(responded_at, datetime('now')),
                updated_at = datetime('now')
          WHERE registration_id = ? AND status <> 'booked'`,
      )
      .bind(registrationId)
      .run();
    if ((res.meta?.changes ?? 0) > 0) {
      await logEvent(db, {
        registration_id: registrationId,
        kind: 'waitlist.booked',
        source: 'system',
        payload: { registration_id: registrationId },
      });
    }
  }, undefined);
}

// Sweep: offers whose window has closed stop holding their place and read as
// `expired` in the admin list, so the next person can be offered it. Runs on
// the hourly cron; also safe to call ad hoc.
export async function expireLapsedOffers(db: D1Database): Promise<number> {
  return tolerant(() => expireLapsed(db), 0);
}

async function expireLapsed(db: D1Database): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE retreat_waitlist
          SET status = 'expired', claim_token = NULL, updated_at = datetime('now')
        WHERE status = 'invited'
          AND offer_expires_at IS NOT NULL
          AND offer_expires_at <= datetime('now')
          -- Someone who claimed in time and is mid-checkout isn't lapsed;
          -- their own booking now holds the place. settleWaitlistOnPaid
          -- closes the entry when the money lands.
          AND NOT EXISTS (
                SELECT 1 FROM registrations r
                 WHERE r.id = retreat_waitlist.registration_id
                   AND r.status IN ('paid','pending')
                   AND (r.status = 'paid'
                        OR r.hold_expires_at IS NULL
                        OR r.hold_expires_at > datetime('now'))
              )`,
    )
    .run();
  return res.meta?.changes ?? 0;
}
