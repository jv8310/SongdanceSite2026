// A consolidated "people" view of every email the site knows, aggregated on
// the fly from the authoritative tables rather than stored as a second copy
// (which would drift). One row per email address, gathering:
//   • identity        — best-known name + country
//   • subscription    — whether the address is on the marketing suppression
//                       list (email_suppressions). NB: transactional email —
//                       confirmations, reminders — always sends regardless.
//   • engagement      — workshop seats secured / attended / missed, abandoned
//                       checkouts, and the "pro" lens (audience door 3, or a
//                       masterclass seat).
//   • purchases       — the 12-week course, the certification, other courses,
//                       and retreats, matched by email across the whole engine.
//   • emails received — every recorded send from workshop_sent_notifications,
//                       joined back through the person's registrations, split
//                       transactional vs marketing.
//
// Everything is read-only and query-driven; there is no `people` table. The
// shape mirrors src/lib/admin/orders.ts (which unifies *orders*; this unifies
// *people*).

// ── Notification taxonomy ───────────────────────────────────────────────────

export type EmailKind = 'transactional' | 'marketing';

// Transactional sends always deliver; marketing sends honour the suppression
// list. Anything not listed here is treated as marketing (the safer default —
// it means a new lifecycle step is gated by unsubscribe until classified).
const TRANSACTIONAL_TYPES = new Set<string>([
  'confirmation',
  'reminder_7d',
  'reminder_2d',
  'reminder_1d',
  'reminder_6h',
  'reminder_1h',
  'reminder_15m',
  'at_time',
]);

const NOTIFICATION_LABELS: Record<string, string> = {
  confirmation: 'Confirmation',
  reminder_7d: 'Reminder · 7 days',
  reminder_2d: 'Reminder · 2 days',
  reminder_1d: 'Reminder · 1 day',
  reminder_6h: 'Reminder · 6 hours',
  reminder_1h: 'Reminder · 1 hour',
  reminder_15m: 'Reminder · 15 min',
  at_time: 'Reminder · at start',
  abandoned_1: 'Abandoned checkout · 1',
  abandoned_2: 'Abandoned checkout · 2',
  post_attended: 'Attended · thank-you',
  post_attended_2: 'Attended · the course',
  post_attended_3: 'Attended · last chance',
  post_attended_pro_2: 'PRO · the craft',
  post_attended_pro_3: 'PRO · last note',
  post_no_show: 'No-show · 1',
  post_no_show_2: 'No-show · 2',
  post_no_show_3: 'No-show · 3',
  downsell_1: 'Downsell · 1',
  downsell_2: 'Downsell · 2',
};

export function notificationLabel(type: string): string {
  return NOTIFICATION_LABELS[type] ?? type;
}

export function notificationKind(type: string): EmailKind {
  return TRANSACTIONAL_TYPES.has(type) ? 'transactional' : 'marketing';
}

// ── Person shape ────────────────────────────────────────────────────────────

export type EmailReceived = {
  type: string;
  label: string;
  kind: EmailKind;
  count: number;
  lastAt: string | null;
};

export type Person = {
  email: string;
  name: string | null;
  country: string | null;

  // Marketing subscription state. subscribed === not on the suppression list.
  subscribed: boolean;
  unsubscribedAt: string | null;
  unsubscribeSource: string | null;

  // Engagement (workshops).
  workshopsSecured: number; // paid or comped seats
  workshopsAttended: number;
  workshopsNoShow: number;
  workshopsAbandoned: number; // prepared/failed, never secured
  isPro: boolean; // audience door 3, or a masterclass seat

  // Purchases (across the whole engine, by email).
  bought12w: boolean;
  boughtCert: boolean;
  retreatsBought: number;
  purchases: string[]; // human labels of every paid purchase

  // Lifecycle / transactional email actually sent to this person.
  emailsReceived: EmailReceived[];
  totalEmailsReceived: number;
  marketingEmailsReceived: number;

  // Is this a paying/secured customer, or only a lead (form/cart, no seat)?
  isCustomer: boolean;

  firstSeen: string | null;
  lastActivity: string | null;
};

// ── Raw rows ────────────────────────────────────────────────────────────────

type WReg = {
  email: string;
  name: string | null;
  country: string | null;
  attendance_status: string;
  payment_status: string;
  audience: string | null;
  product_slug: string | null;
  created_at: string;
  updated_at: string;
};

type Notif = { email: string; type: string; sent_at_utc: string };
type CourseReg = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  product_slug: string;
  status: string;
  created_at: string;
  paid_at: string | null;
};
type WCoursePurchase = { email: string; slug: string };
type RetreatReg = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  status: string;
  product_name: string | null;
  created_at: string;
  paid_at: string | null;
};
type Suppression = { email: string; source: string | null; created_at: string };

// ── Labels ──────────────────────────────────────────────────────────────────

const COURSE_LABELS: Record<string, string> = {
  'cc-cert': 'SVH Certification',
  'cc-bundle': 'SVH Certification (bundle)',
  'cert-course': 'SVH Certification',
  'svh-12week': '12-Week Course',
  '12w-course': '12-Week Course',
  'grief-course': 'Grief Course',
  grief: 'Grief Course',
};
function courseLabel(slug: string): string {
  return COURSE_LABELS[slug] ?? slug;
}
const IS_12W = (slug: string) => slug === 'svh-12week' || slug === '12w-course';
const IS_CERT = (slug: string) => slug === 'cc-cert' || slug === 'cc-bundle' || slug === 'cert-course';

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}
function earlierOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}
function fullName(first: string | null, last: string | null): string | null {
  const n = `${first ?? ''} ${last ?? ''}`.trim();
  return n || null;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export async function listPeople(db: D1Database): Promise<Person[]> {
  const [wregRes, notifRes, courseRes, wPurchaseRes, retreatRes, supprRes] = await Promise.all([
    db
      .prepare(
        `SELECT lower(r.email) AS email, r.name, r.country, r.attendance_status,
                r.payment_status, r.audience, r.created_at, r.updated_at,
                p.slug AS product_slug
           FROM workshop_registrations r
           LEFT JOIN workshops w ON w.id = r.workshop_id
           LEFT JOIN workshop_products p ON p.id = w.main_product_id`,
      )
      .all<WReg>(),
    db
      .prepare(
        `SELECT lower(r.email) AS email, n.type, n.sent_at_utc
           FROM workshop_sent_notifications n
           JOIN workshop_registrations r ON r.id = n.registration_id`,
      )
      .all<Notif>(),
    db
      .prepare(
        `SELECT lower(email) AS email, first_name, last_name, product_slug, status, created_at, paid_at
           FROM course_registrations`,
      )
      .all<CourseReg>(),
    db
      .prepare(
        `SELECT lower(r.email) AS email, p.slug AS slug
           FROM workshop_purchases pur
           JOIN workshop_registrations r ON r.id = pur.registration_id
           JOIN workshop_products p ON p.id = pur.product_id
          WHERE pur.product_type = 'course'`,
      )
      .all<WCoursePurchase>(),
    db
      .prepare(
        `SELECT lower(reg.email) AS email, reg.first_name, reg.last_name, reg.name,
                reg.status, prod.name AS product_name, reg.created_at, reg.paid_at
           FROM registrations reg
           LEFT JOIN products prod ON prod.id = reg.product_id`,
      )
      .all<RetreatReg>(),
    db
      .prepare(`SELECT lower(email) AS email, source, created_at FROM email_suppressions`)
      .all<Suppression>(),
  ]);

  const byEmail = new Map<string, Person>();
  const get = (email: string): Person => {
    let p = byEmail.get(email);
    if (!p) {
      p = {
        email,
        name: null,
        country: null,
        subscribed: true,
        unsubscribedAt: null,
        unsubscribeSource: null,
        workshopsSecured: 0,
        workshopsAttended: 0,
        workshopsNoShow: 0,
        workshopsAbandoned: 0,
        isPro: false,
        bought12w: false,
        boughtCert: false,
        retreatsBought: 0,
        purchases: [],
        emailsReceived: [],
        totalEmailsReceived: 0,
        marketingEmailsReceived: 0,
        isCustomer: false,
        firstSeen: null,
        lastActivity: null,
      };
      byEmail.set(email, p);
    }
    return p;
  };

  // Workshop registrations — the engagement spine.
  for (const r of wregRes.results ?? []) {
    if (!r.email) continue;
    const p = get(r.email);
    if (!p.name && r.name) p.name = r.name;
    if (!p.country && r.country) p.country = r.country;
    const secured = r.payment_status === 'paid' || r.payment_status === 'coupon';
    if (secured) {
      p.workshopsSecured += 1;
      if (r.attendance_status === 'attended') p.workshopsAttended += 1;
      if (r.attendance_status === 'no_show') p.workshopsNoShow += 1;
    } else if (r.payment_status === 'prepared' || r.payment_status === 'failed') {
      p.workshopsAbandoned += 1;
    }
    // Pro lens: chose the practitioner door (audience set contains "3"), or
    // holds a masterclass seat.
    const doors = (r.audience ?? '').split(',').map((s) => s.trim());
    if (doors.includes('3')) p.isPro = true;
    if (secured && (r.product_slug ?? '').includes('masterclass')) p.isPro = true;
    p.firstSeen = earlierOf(p.firstSeen, r.created_at);
    p.lastActivity = laterOf(p.lastActivity, r.updated_at || r.created_at);
  }

  // Course purchases (course_registrations).
  const purchaseSeen = new Map<string, Set<string>>(); // dedupe labels per email
  const addPurchase = (p: Person, label: string) => {
    let seen = purchaseSeen.get(p.email);
    if (!seen) {
      seen = new Set();
      purchaseSeen.set(p.email, seen);
    }
    if (!seen.has(label)) {
      seen.add(label);
      p.purchases.push(label);
    }
  };
  for (const c of courseRes.results ?? []) {
    if (!c.email) continue;
    const p = get(c.email);
    if (!p.name) p.name = fullName(c.first_name, c.last_name);
    p.firstSeen = earlierOf(p.firstSeen, c.created_at);
    p.lastActivity = laterOf(p.lastActivity, c.paid_at || c.created_at);
    if (c.status === 'paid') {
      if (IS_12W(c.product_slug)) p.bought12w = true;
      if (IS_CERT(c.product_slug)) p.boughtCert = true;
      addPurchase(p, courseLabel(c.product_slug));
    }
  }

  // Course purchases made through a workshop checkout.
  for (const c of wPurchaseRes.results ?? []) {
    if (!c.email) continue;
    const p = get(c.email);
    if (IS_12W(c.slug)) p.bought12w = true;
    if (IS_CERT(c.slug)) p.boughtCert = true;
    addPurchase(p, courseLabel(c.slug));
  }

  // Retreat registrations.
  for (const r of retreatRes.results ?? []) {
    if (!r.email) continue;
    const p = get(r.email);
    if (!p.name) p.name = fullName(r.first_name, r.last_name) ?? r.name;
    p.firstSeen = earlierOf(p.firstSeen, r.created_at);
    p.lastActivity = laterOf(p.lastActivity, r.paid_at || r.created_at);
    if (r.status === 'paid') {
      p.retreatsBought += 1;
      addPurchase(p, r.product_name ?? 'Retreat');
    }
  }

  // Emails actually sent (recorded sends), grouped per type.
  const notifAgg = new Map<string, Map<string, { count: number; lastAt: string | null }>>();
  for (const n of notifRes.results ?? []) {
    if (!n.email) continue;
    let perType = notifAgg.get(n.email);
    if (!perType) {
      perType = new Map();
      notifAgg.set(n.email, perType);
    }
    const cur = perType.get(n.type) ?? { count: 0, lastAt: null };
    cur.count += 1;
    cur.lastAt = laterOf(cur.lastAt, n.sent_at_utc);
    perType.set(n.type, cur);
  }
  for (const [email, perType] of notifAgg) {
    const p = get(email);
    for (const [type, { count, lastAt }] of perType) {
      const kind = notificationKind(type);
      p.emailsReceived.push({ type, label: notificationLabel(type), kind, count, lastAt });
      p.totalEmailsReceived += count;
      if (kind === 'marketing') p.marketingEmailsReceived += count;
      p.lastActivity = laterOf(p.lastActivity, lastAt);
    }
    // Newest send first.
    p.emailsReceived.sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  }

  // Suppression state (overrides the default `subscribed: true`).
  for (const s of supprRes.results ?? []) {
    if (!s.email) continue;
    const p = get(s.email);
    p.subscribed = false;
    p.unsubscribedAt = s.created_at;
    p.unsubscribeSource = s.source;
    p.lastActivity = laterOf(p.lastActivity, s.created_at);
  }

  // Customer = secured a workshop seat or bought any course/retreat.
  for (const p of byEmail.values()) {
    p.isCustomer =
      p.workshopsSecured > 0 || p.bought12w || p.boughtCert || p.purchases.length > 0;
  }

  // Most recently active first.
  return [...byEmail.values()].sort((a, b) =>
    (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''),
  );
}

// ── Filtering (in memory; the merged set is small) ──────────────────────────

export type PeopleFilter = {
  subscription?: 'subscribed' | 'unsubscribed' | null;
  kind?: 'customer' | 'lead' | null;
  pro?: boolean | null;
  query?: string | null;
};

export function filterPeople(people: Person[], filter: PeopleFilter): Person[] {
  let out = people;
  if (filter.subscription === 'subscribed') out = out.filter((p) => p.subscribed);
  if (filter.subscription === 'unsubscribed') out = out.filter((p) => !p.subscribed);
  if (filter.kind === 'customer') out = out.filter((p) => p.isCustomer);
  if (filter.kind === 'lead') out = out.filter((p) => !p.isCustomer);
  if (filter.pro) out = out.filter((p) => p.isPro);
  const q = (filter.query ?? '').trim().toLowerCase();
  if (q) {
    out = out.filter(
      (p) => p.email.includes(q) || (p.name ?? '').toLowerCase().includes(q),
    );
  }
  return out;
}

export type PeopleSummary = {
  total: number;
  subscribed: number;
  unsubscribed: number;
  customers: number;
  leads: number;
  pro: number;
};

export function summarisePeople(people: Person[]): PeopleSummary {
  const s: PeopleSummary = { total: 0, subscribed: 0, unsubscribed: 0, customers: 0, leads: 0, pro: 0 };
  for (const p of people) {
    s.total += 1;
    if (p.subscribed) s.subscribed += 1;
    else s.unsubscribed += 1;
    if (p.isCustomer) s.customers += 1;
    else s.leads += 1;
    if (p.isPro) s.pro += 1;
  }
  return s;
}
