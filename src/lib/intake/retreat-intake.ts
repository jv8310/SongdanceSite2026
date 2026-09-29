// The intake, seen from a retreat: /admin/retreats/<slug> → "Intake".
//
// An intake retreat (intake_retreats) is linked to the retreat product it
// screens for through `product_id` (migration 0085). Once linked, the retreat
// page lists every booked guest beside their intake: invited when, reminded
// when, submitted or not, the assessment, and whether their travel details are
// in — and invites them, one by one or all at once, without copying a single
// email address between pages.
//
// Who is a guest: every PAID, non-host registration on the product. The hosts
// and the cook (host = 1) run the retreat and aren't screened; a pending
// booking (a bank transfer still on its way, a checkout in flight) joins the
// list the moment it's paid. One row per email address — a booking made twice
// under one address is one person to invite.
//
// The invitation row (intake_invitations) is created on the first send, from
// the booking: first name for the greeting, the whole name to prefill the
// form. Invitees added by hand on /admin/intakes/retreats (a partner who
// travels on someone else's booking, say) show up here too, under the guests.

import { genToken, genUuid, type InvitationRow } from './invitations';
import type { RetreatRow } from './retreats-db';
import type { IntakeEmailKind } from './invitations';

export interface RetreatProduct {
  id: number;
  slug: string;
  name: string;
}

export async function retreatProductBySlug(
  db: D1Database,
  slug: string,
): Promise<RetreatProduct | null> {
  const row = await db
    .prepare(`SELECT id, slug, name FROM products WHERE slug = ? AND type = 'retreat'`)
    .bind(slug)
    .first<RetreatProduct>();
  return row ?? null;
}

// Where the retreat-page intake actions send the admin back to, with a flash.
export function backToRetreat(productSlug: string, params: Record<string, string>): Response {
  const qs = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/admin/retreats/${encodeURIComponent(productSlug)}${qs ? `?${qs}` : ''}#intake`,
    },
  });
}

// The intake linked to a retreat product, or null. Throws before migration
// 0085 (no product_id column) — callers show that as "needs the migration".
export async function intakeForProduct(
  db: D1Database,
  productId: number,
): Promise<RetreatRow | null> {
  const row = await db
    .prepare(`SELECT * FROM intake_retreats WHERE product_id = ? ORDER BY updated_at DESC`)
    .bind(productId)
    .first<RetreatRow>();
  return row ?? null;
}

// Intakes not linked to any retreat yet — what the "link an existing intake"
// picker offers, so one already set up by hand (with its invitees and
// submissions) can be joined to its retreat rather than duplicated.
export async function unlinkedIntakes(db: D1Database): Promise<RetreatRow[]> {
  const q = await db
    .prepare(
      `SELECT * FROM intake_retreats
        WHERE product_id IS NULL
        ORDER BY active DESC, created_at DESC`,
    )
    .all<RetreatRow>();
  return q.results ?? [];
}

// One retreat has one intake: linking a new one unlinks whatever was there.
export async function linkIntakeToProduct(
  db: D1Database,
  intakeSlug: string,
  productId: number,
): Promise<boolean> {
  const exists = await db
    .prepare(`SELECT slug FROM intake_retreats WHERE slug = ?`)
    .bind(intakeSlug)
    .first<{ slug: string }>();
  if (!exists) return false;
  await db.batch([
    db
      .prepare(`UPDATE intake_retreats SET product_id = NULL, updated_at = datetime('now') WHERE product_id = ?`)
      .bind(productId),
    db
      .prepare(`UPDATE intake_retreats SET product_id = ?, updated_at = datetime('now') WHERE slug = ?`)
      .bind(productId, intakeSlug),
  ]);
  return true;
}

export async function unlinkIntake(db: D1Database, productId: number): Promise<void> {
  await db
    .prepare(`UPDATE intake_retreats SET product_id = NULL, updated_at = datetime('now') WHERE product_id = ?`)
    .bind(productId)
    .run();
}

// A fresh intake for the retreat, keyed by the product's own slug (so the
// public link reads /intake?event=ritual-of-belonging-2026). If an intake
// already uses that slug and belongs to nobody, it is adopted instead; one
// that belongs to another retreat gets a suffix.
export async function createIntakeForProduct(
  db: D1Database,
  product: RetreatProduct,
  inviteLocale: 'nl' | 'en',
): Promise<string> {
  let slug = product.slug;
  for (let n = 2; ; n += 1) {
    const taken = await db
      .prepare(`SELECT product_id FROM intake_retreats WHERE slug = ?`)
      .bind(slug)
      .first<{ product_id: number | null }>();
    if (!taken) break;
    if (taken.product_id == null || taken.product_id === product.id) {
      await linkIntakeToProduct(db, slug, product.id);
      return slug;
    }
    slug = `${product.slug}-${n}`;
  }
  await db.batch([
    db
      .prepare(`UPDATE intake_retreats SET product_id = NULL, updated_at = datetime('now') WHERE product_id = ?`)
      .bind(product.id),
    db
      .prepare(
        `INSERT INTO intake_retreats (slug, name, flavour, active, invite_locale, product_id, sheet_secret)
         VALUES (?, ?, NULL, 1, ?, ?, ?)`,
      )
      .bind(slug, product.name, inviteLocale, product.id, genToken()),
  ]);
  return slug;
}

// The shared secret the Google Sheet's Apps Script checks. Minted on first
// need so an intake created before migration 0085 gets one too.
export async function ensureSheetSecret(db: D1Database, intake: RetreatRow): Promise<string> {
  if (intake.sheet_secret) return intake.sheet_secret;
  const secret = genToken();
  await db
    .prepare(`UPDATE intake_retreats SET sheet_secret = COALESCE(sheet_secret, ?) WHERE slug = ?`)
    .bind(secret, intake.slug)
    .run();
  const row = await db
    .prepare(`SELECT sheet_secret FROM intake_retreats WHERE slug = ?`)
    .bind(intake.slug)
    .first<{ sheet_secret: string | null }>();
  return row?.sheet_secret ?? secret;
}

// ---------- The roster ----------

export interface RosterRow {
  email: string; // lowercased — the key
  // False for a stand-in address: a partner or co-facilitator booked onto a
  // bed without an email of their own is stored as …@placeholder.invalid, and
  // `.invalid` (RFC 2606) can never deliver. Listed, never mailed — their own
  // address can be added by hand on /admin/intakes/retreats.
  emailable: boolean;
  name: string;
  firstName: string | null;
  registrationId: number | null; // null = an invitee added by hand, no paid booking
  invitation: InvitationRow | null;
  submission: { id: string; classification: string | null; created_at: string } | null;
  transportAt: string | null; // when their travel details last came in
}

export function isSubmitted(r: RosterRow): boolean {
  return !!r.submission || !!r.invitation?.submitted_at;
}

// Who a bulk send of `kind` goes to. The screening emails never go to someone
// who has sent their intake; the invitation only to those never invited, the
// two reminders only to those who were. The travel email goes to those whose
// intake is in but whose travel details aren't — anyone still to send the
// intake gets the travel questions inside it.
export function eligibleFor(
  kind: IntakeEmailKind,
  r: RosterRow,
  hasTransport: boolean,
): boolean {
  if (!r.emailable) return false;
  const done = isSubmitted(r);
  switch (kind) {
    case 'invitation':
      return !done && !r.invitation?.invitation_sent_at;
    case 'reminder':
      return !done && !!r.invitation?.invitation_sent_at;
    case 'final':
      return !done && !!r.invitation?.invitation_sent_at;
    case 'transport':
      return hasTransport && done && !r.transportAt;
  }
}

export async function intakeRoster(
  db: D1Database,
  productId: number,
  intakeSlug: string,
): Promise<RosterRow[]> {
  const [guestsQ, invitesQ, subsQ, transportQ] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, first_name, last_name, email
           FROM registrations
          WHERE product_id = ? AND status = 'paid' AND host = 0
          ORDER BY COALESCE(first_name, name), id`,
      )
      .bind(productId)
      .all<{ id: number; name: string; first_name: string | null; last_name: string | null; email: string }>(),
    db
      .prepare(`SELECT * FROM intake_invitations WHERE retreat_slug = ?`)
      .bind(intakeSlug)
      .all<InvitationRow>(),
    db
      .prepare(
        `SELECT id, lower(email) AS email, classification, created_at
           FROM intake_submissions
          WHERE event_code = ?
          ORDER BY created_at DESC`,
      )
      .bind(intakeSlug)
      .all<{ id: string; email: string; classification: string | null; created_at: string }>(),
    db
      .prepare(`SELECT lower(email) AS email, updated_at FROM intake_transport_answers WHERE event_code = ?`)
      .bind(intakeSlug)
      .all<{ email: string; updated_at: string }>(),
  ]);

  const invites = new Map<string, InvitationRow>();
  for (const i of invitesQ.results ?? []) invites.set(i.email.toLowerCase(), i);
  const subs = new Map<string, RosterRow['submission']>();
  for (const s of subsQ.results ?? []) {
    // Newest first, so the first one seen per email is the latest.
    if (!subs.has(s.email)) subs.set(s.email, { id: s.id, classification: s.classification, created_at: s.created_at });
  }
  const transport = new Map<string, string>();
  for (const t of transportQ.results ?? []) transport.set(t.email, t.updated_at);

  const rows: RosterRow[] = [];
  const seen = new Set<string>();
  const push = (email: string, name: string, firstName: string | null, registrationId: number | null) => {
    rows.push({
      email,
      emailable: !/\.invalid$/i.test(email),
      name,
      firstName,
      registrationId,
      invitation: invites.get(email) ?? null,
      submission: subs.get(email) ?? null,
      transportAt: transport.get(email) ?? null,
    });
  };

  for (const g of guestsQ.results ?? []) {
    const email = g.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    // Stored as typed at checkout; cased only where it is shown (tidyName in
    // the admin, tidyFirstName in the email greeting).
    const full =
      g.first_name || g.last_name ? `${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() : g.name;
    push(email, full, (g.first_name || full).trim().split(/\s+/)[0] || null, g.id);
  }
  // Invitees added by hand, or whose booking has since been cancelled.
  const extra = [...invites.values()]
    .filter((i) => !seen.has(i.email.toLowerCase()))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const i of extra) {
    const email = i.email.toLowerCase();
    seen.add(email);
    push(email, i.full_name || i.first_name || '', i.first_name, null);
  }
  return rows;
}

// The invitation row a send needs, created from the roster row on first use.
// Idempotent on (retreat, email): an existing row keeps its token — links
// already sent keep working — and only gains a name it didn't have.
export async function ensureInvitation(
  db: D1Database,
  intakeSlug: string,
  person: { email: string; firstName: string | null; fullName: string | null },
): Promise<InvitationRow> {
  const email = person.email.trim().toLowerCase();
  await db
    .prepare(
      `INSERT INTO intake_invitations (id, token, retreat_slug, first_name, full_name, email)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(retreat_slug, email) DO UPDATE SET
         first_name = COALESCE(intake_invitations.first_name, excluded.first_name),
         full_name  = COALESCE(intake_invitations.full_name, excluded.full_name)`,
    )
    .bind(genUuid(), genToken(), intakeSlug, person.firstName, person.fullName, email)
    .run();
  const row = await db
    .prepare(`SELECT * FROM intake_invitations WHERE retreat_slug = ? AND email = ?`)
    .bind(intakeSlug, email)
    .first<InvitationRow>();
  if (!row) throw new Error(`invitation for ${email} could not be created`);
  return row;
}
