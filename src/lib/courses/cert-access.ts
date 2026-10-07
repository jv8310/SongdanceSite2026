// When does a certification student's course end? The single answer, computed
// from what they bought — no column, no migration, nothing to keep in step.
//
// The certification course runs NINE MONTHS. The rules (owner, October 2026):
//
//   1. The clock starts on the day they bought it…
//   2. …unless they hold the 12-week foundation too, in which case it starts
//      when the 12 weeks are over: they get 12 weeks + 9 months either way.
//      Whether they walk the two side by side ("activate now") or one after
//      the other ("wait") makes no difference — starting both at once must
//      never cost anyone the 12 weeks.
//   3. Nobody ends before 31 December 2026. Everyone who bought before then
//      keeps the course to the end of the year; whoever's own 9 months run
//      past it keeps it to the end of their own 9 months.
//
// So there are two groups: "ends at the end of 2026" and "ends later" — the
// two Drip tags `cert-access-drip.ts` writes, with the date beside them.
//
// "Holds the 12-week foundation" means one of:
//   - the path (`cc-bundle`): the 12 weeks are part of the purchase, so the
//     certification clock starts 12 weeks after it;
//   - a standalone 12-week purchase still running when the cert was bought, or
//     bought within FOUNDATION_PAIRING_DAYS after it (two separate checkouts
//     the same week are one decision): the clock starts when that 12-week
//     course ends;
//   - a cert bought on the "mid-12-week" offer (source variant `B1`, shown only
//     to people already inside the 12-week course — often bought before this
//     site recorded sales): we can't see when their 12 weeks end, so they get
//     the full 12 weeks on top of the purchase date, generously.
//
// 4. A live pass bought with the "Extend my certification window" add-on
//    (live-pass.ts) keeps the window open until the pass ends: the end date is
//    then the later of the two, and `extendedTo` says so.
//
// Purchases are read from both places a course sale can land, the same pair
// `hasBoughtCert` in workshops/cron.ts checks: `course_registrations` (status
// 'paid' — a refunded or cancelled order holds nothing) and the workshop
// engine's own ledger (`cert-course` / `12w-course` lines on a paid seat).
// Days are Brussels calendar days, like every other date the site reports.

import { businessDayOf } from '../workshops/periods';
import { loadCertExtensions } from './live-pass';

export const CERT_ACCESS_MONTHS = 9;
export const FOUNDATION_WEEKS = 12;
// Everyone keeps the course at least to this day (inclusive).
export const CERT_ACCESS_FLOOR = '2026-12-31';
const FOUNDATION_PAIRING_DAYS = 14;

const CERT_SLUGS = ['cc-cert', 'cc-bundle'];
const TWELVE_WEEK_SLUGS = ['svh-12week'];
const LEDGER_CERT_SLUGS = ['cert-course'];
const LEDGER_TWELVE_WEEK_SLUGS = ['12w-course'];

export type CertAccessGroup = 'end-2026' | 'later';

export type CertStartReason =
  | 'purchase' // cert on its own: 9 months from the purchase
  | 'path' // bought as the path: 12 weeks + 9 months
  | 'twelve-week' // a 12-week course of their own was running: starts when it ends
  | 'mid-twelve-week'; // bought while inside the 12-week course (B1): +12 weeks

export type CertAccess = {
  email: string;
  name: string | null;
  // The purchase that decides the end date (the one ending latest).
  source: 'course' | 'ledger';
  sourceId: number;
  productSlug: string;
  purchasedOn: string; // YYYY-MM-DD, Brussels
  startReason: CertStartReason;
  startsOn: string; // the day the 9 months start
  ownNineMonthsEndOn: string; // start + 9 months, before the floor
  courseEndsOn: string; // max(floor, ownNineMonthsEndOn)
  extendedTo: string | null; // the last day of a certification-window extension
  endsOn: string; // max(courseEndsOn, extendedTo)
  group: CertAccessGroup;
  purchases: number; // cert purchases on this address
};

// ── Date arithmetic on YYYY-MM-DD (UTC noon, so no DST edge can move a day) ──

function parseDay(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}
function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDay(d);
}
// Calendar months, clamped to the last day of a shorter month: 31 May + 9
// months is 28/29 February, never 2 or 3 March.
export function addMonths(day: string, n: number): string {
  const d = parseDay(day);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
  return fmtDay(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), 12)));
}

export function certGroupFor(endsOn: string): CertAccessGroup {
  return endsOn <= CERT_ACCESS_FLOOR ? 'end-2026' : 'later';
}

// ── The rule, as a pure function ────────────────────────────────────────────

export type CertPurchase = {
  source: 'course' | 'ledger';
  id: number;
  productSlug: string;
  day: string; // YYYY-MM-DD, Brussels
  sourceVariant: string | null;
};

export function computeCertEnd(
  cert: CertPurchase,
  twelveWeekDays: string[],
): { startReason: CertStartReason; startsOn: string; ownNineMonthsEndOn: string; endsOn: string } {
  let startsOn = cert.day;
  let startReason: CertStartReason = 'purchase';

  if (cert.productSlug === 'cc-bundle') {
    startsOn = addDays(cert.day, FOUNDATION_WEEKS * 7);
    startReason = 'path';
  } else {
    // A standalone 12-week course still running at the cert purchase (or
    // bought alongside it): the cert starts when it ends. The latest such end
    // wins, so a second run of the 12 weeks never shortens anything.
    const pairingLimit = addDays(cert.day, FOUNDATION_PAIRING_DAYS);
    for (const tw of twelveWeekDays) {
      const twEnd = addDays(tw, FOUNDATION_WEEKS * 7);
      if (tw <= pairingLimit && twEnd > cert.day && twEnd > startsOn) {
        startsOn = twEnd;
        startReason = 'twelve-week';
      }
    }
    if (startReason === 'purchase' && cert.sourceVariant === 'B1') {
      startsOn = addDays(cert.day, FOUNDATION_WEEKS * 7);
      startReason = 'mid-twelve-week';
    }
  }

  const ownNineMonthsEndOn = addMonths(startsOn, CERT_ACCESS_MONTHS);
  const endsOn = ownNineMonthsEndOn > CERT_ACCESS_FLOOR ? ownNineMonthsEndOn : CERT_ACCESS_FLOOR;
  return { startReason, startsOn, ownNineMonthsEndOn, endsOn };
}

// ── Loading ─────────────────────────────────────────────────────────────────

type PurchaseRow = {
  source: 'course' | 'ledger';
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  product_slug: string;
  source_variant: string | null;
  bought_at: string;
};

async function loadPurchases(db: D1Database, email?: string): Promise<PurchaseRow[]> {
  const slugs = [...CERT_SLUGS, ...TWELVE_WEEK_SLUGS];
  const ledgerSlugs = [...LEDGER_CERT_SLUGS, ...LEDGER_TWELVE_WEEK_SLUGS];
  const ph = (n: number) => Array(n).fill('?').join(',');
  const byEmail = email ? ' AND lower(email) = ?' : '';
  const byLedgerEmail = email ? ' AND lower(wr.email) = ?' : '';
  const e = email ? [email.trim().toLowerCase()] : [];

  const [courses, ledger] = await Promise.all([
    db
      .prepare(
        `SELECT 'course' AS source, id, email, first_name, last_name, product_slug,
                source_variant, COALESCE(paid_at, created_at) AS bought_at
           FROM course_registrations
          WHERE status = 'paid' AND product_slug IN (${ph(slugs.length)})${byEmail}`,
      )
      .bind(...slugs, ...e)
      .all<PurchaseRow>(),
    db
      .prepare(
        `SELECT 'ledger' AS source, pur.id AS id, wr.email AS email,
                wr.name AS first_name, NULL AS last_name,
                p.slug AS product_slug, NULL AS source_variant, pur.created_at AS bought_at
           FROM workshop_purchases pur
           JOIN workshop_registrations wr ON wr.id = pur.registration_id
           JOIN workshop_products p ON p.id = pur.product_id
          WHERE pur.product_type = 'course'
            AND wr.payment_status IN ('paid','coupon')
            AND p.slug IN (${ph(ledgerSlugs.length)})${byLedgerEmail}`,
      )
      .bind(...ledgerSlugs, ...e)
      .all<PurchaseRow>()
      .catch(() => ({ results: [] as PurchaseRow[] })),
  ]);
  return [...(courses.results ?? []), ...(ledger.results ?? [])];
}

function isCertSlug(slug: string): boolean {
  return CERT_SLUGS.includes(slug) || LEDGER_CERT_SLUGS.includes(slug);
}

// Everyone who holds the certification, one entry per address, with the
// purchase that ends latest deciding their date. Sorted by end date, then email.
export async function listCertAccess(db: D1Database): Promise<CertAccess[]> {
  const [rows, extensions] = await Promise.all([loadPurchases(db), loadCertExtensions(db)]);
  return buildCertAccess(rows, extensions);
}

// One address — the paid-handler's live path. Null when they hold no cert.
export async function getCertAccessForEmail(
  db: D1Database,
  email: string,
): Promise<CertAccess | null> {
  const [rows, extensions] = await Promise.all([loadPurchases(db, email), loadCertExtensions(db, email)]);
  return buildCertAccess(rows, extensions)[0] ?? null;
}

// The later of a course end and an extension's last day.
export function extendEnd(courseEndsOn: string, extendedTo: string | null | undefined): string {
  return extendedTo && extendedTo > courseEndsOn ? extendedTo : courseEndsOn;
}

function buildCertAccess(rows: PurchaseRow[], extensions: Map<string, string>): CertAccess[] {
  const byEmail = new Map<string, PurchaseRow[]>();
  for (const r of rows) {
    const key = r.email.trim().toLowerCase();
    if (!key) continue;
    const list = byEmail.get(key);
    if (list) list.push(r);
    else byEmail.set(key, [r]);
  }

  const out: CertAccess[] = [];
  for (const [email, list] of byEmail) {
    const certs = list.filter((r) => isCertSlug(r.product_slug));
    if (!certs.length) continue;
    const twelveWeekDays = list
      .filter((r) => !isCertSlug(r.product_slug))
      .map((r) => businessDayOf(r.bought_at));

    // The name from any of their rows (the ledger may not carry one).
    const anyName =
      list.map((r) => [r.first_name, r.last_name].filter(Boolean).join(' ').trim()).find(Boolean) ?? null;
    let best: CertAccess | null = null;
    for (const c of certs) {
      const day = businessDayOf(c.bought_at);
      const end = computeCertEnd(
        { source: c.source, id: c.id, productSlug: c.product_slug, day, sourceVariant: c.source_variant },
        twelveWeekDays,
      );
      // endsOn only ever rises with the own 9 months, so that decides it.
      if (best && best.ownNineMonthsEndOn >= end.ownNineMonthsEndOn) continue;
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || anyName;
      best = {
        email,
        name,
        source: c.source,
        sourceId: c.id,
        productSlug: c.product_slug,
        purchasedOn: day,
        startReason: end.startReason,
        startsOn: end.startsOn,
        ownNineMonthsEndOn: end.ownNineMonthsEndOn,
        courseEndsOn: end.endsOn,
        extendedTo: null,
        endsOn: end.endsOn,
        group: certGroupFor(end.endsOn),
        purchases: certs.length,
      };
    }
    if (best) {
      const ext = extensions.get(email) ?? null;
      if (ext && ext > best.courseEndsOn) {
        best.extendedTo = ext;
        best.endsOn = ext;
        best.group = certGroupFor(ext);
      }
      out.push(best);
    }
  }
  out.sort((a, b) => (a.endsOn === b.endsOn ? a.email.localeCompare(b.email) : a.endsOn.localeCompare(b.endsOn)));
  return out;
}
