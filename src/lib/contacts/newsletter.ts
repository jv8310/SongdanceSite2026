// The site's own newsletter signup — the "Stay in touch" form at the foot of
// every SiteLayout page (NewsletterFooter.astro → POST /api/newsletter).
//
// Until November 2026 that form showed "Thank you" and threw the address away
// (a placeholder waiting for a Drip endpoint), and /api/newsletter wrote only to
// Drip and had no caller. A signup now lands where everything else the site
// mails from lives: the `contacts` list, which feeds broadcasts and People.
//
//   • contacts row — created with source 'newsletter', or, for an address the
//     list already holds, left as it was except a missing name filled in;
//   • tag `newsletter` (plus `forgiveness course waitlist` for that source) —
//     additive, so nothing the contact already carries is touched, and never
//     the purchase mirror's `in-drip` marker: this person is mailed from the
//     site, so a broadcast excluding `in-drip` still reaches them;
//   • the signup itself in `custom` — newsletter_signed_up_at (ISO, UTC),
//     newsletter_signup_page (the path the form sat on) and newsletter_source,
//     merged key by key into what is there (json_patch), the latest signup
//     winning. That is the record of when and where they asked to be written
//     to, and it is what puts the person on /admin/people (listPeople reads
//     `newsletter`-tagged contacts carrying newsletter_signed_up_at).
//
// A signup never lifts an unsubscribe. An address on email_suppressions stays
// there — anyone can type any address into a form, and only the person who
// unsubscribed should be able to undo it — so the contact is recorded (it shows
// on People as unsubscribed, with the signup date) and an admin can Resubscribe
// it after hearing from them. The caller is told, so it can log it; the visitor
// is not, since that would say whether an address is on our list.

import { logEventSafe } from '../registrations/db';
import { addContactTagStatements, normalizeContactTags } from './mirror';

export const NEWSLETTER_TAG = 'newsletter';
export const NEWSLETTER_SOURCE = 'newsletter';

// Extra tag per `source` a form may post. Anything else is kept only as the
// newsletter_source field, never as a tag, so a caller can't mint tags.
const SOURCE_TAGS: Record<string, string> = {
  'forgiveness-course': 'forgiveness course waitlist',
};

export type NewsletterSignupInput = {
  email: string;
  firstName?: string | null;
  // Which form or campaign, e.g. 'footer' or 'forgiveness-course'.
  source?: string | null;
  // location.pathname of the page the form was on.
  page?: string | null;
};

export type NewsletterSignupResult = {
  email: string;
  isNew: boolean; // the address was not on the contacts list before
  suppressed: boolean; // on email_suppressions: recorded, but not mailed
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeSignupEmail(raw: unknown): string | null {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

// A same-site path only: leading '/', no scheme or host, query and hash dropped
// (they carry discounts, referral ids and, on some links, the address itself).
export function normalizeSignupPage(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  const path = s.split(/[?#]/)[0].slice(0, 200);
  return /^\/[\w\-./%~]*$/.test(path) ? path : null;
}

function normalizeSource(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase().slice(0, 60);
  return /^[a-z0-9][a-z0-9\-_:]*$/.test(s) ? s : 'footer';
}

export async function recordNewsletterSignup(
  db: D1Database,
  input: NewsletterSignupInput,
  now: Date = new Date(),
): Promise<NewsletterSignupResult> {
  const email = normalizeSignupEmail(input.email);
  if (!email) throw new Error('recordNewsletterSignup: invalid email');
  const firstName = String(input.firstName ?? '').trim().slice(0, 80) || null;
  const source = normalizeSource(input.source);
  const page = normalizeSignupPage(input.page);

  const before = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM contacts WHERE email = ?1) AS existing,
              EXISTS (SELECT 1 FROM email_suppressions WHERE email = ?1) AS suppressed`,
    )
    .bind(email)
    .first<{ existing: number; suppressed: number }>();

  // No null values: in a JSON merge patch a null DELETES the key, which would
  // wipe the page an earlier signup recorded.
  const custom = JSON.stringify({
    newsletter_signed_up_at: now.toISOString(),
    ...(page ? { newsletter_signup_page: page } : {}),
    newsletter_source: source,
  });
  const tags = normalizeContactTags([NEWSLETTER_TAG, SOURCE_TAGS[source] ?? '']);

  await db.batch([
    db
      .prepare(
        `INSERT INTO contacts (email, name, source, custom)
           VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(email) DO UPDATE SET
           name = COALESCE(contacts.name, excluded.name),
           custom = CASE
             WHEN contacts.custom IS NULL OR TRIM(contacts.custom) = '' THEN excluded.custom
             WHEN json_valid(contacts.custom) THEN json_patch(contacts.custom, excluded.custom)
             ELSE contacts.custom
           END,
           updated_at = datetime('now')`,
      )
      .bind(email, firstName, NEWSLETTER_SOURCE, custom),
    ...addContactTagStatements(db, email, tags),
  ]);

  const result: NewsletterSignupResult = {
    email,
    isNew: !before?.existing,
    suppressed: !!before?.suppressed,
  };

  await logEventSafe(db, {
    registration_id: null,
    kind: result.suppressed ? 'newsletter.signup_suppressed' : 'newsletter.signup',
    source: 'web',
    payload: { email, source, page, new_contact: result.isNew },
  });

  return result;
}
