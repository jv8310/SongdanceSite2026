// Where a registration was started — the page, not the session.
//
// /workshop, /courses/masterclass and a direct /w/<slug> link all post to the
// same /api/workshops/register, so without this every registration looked
// alike and a question as ordinary as "how many workshop seats did the
// masterclass page sell?" could not be answered. The checkout now sends the
// path it is on and the server normalizes it here, so the column holds a small
// stable set of keys rather than every URL the site has.

export type SignupPage = string;

// The pages we name explicitly. Anything else keeps its (cleaned) path, so a
// new landing page shows up in the data before anyone remembers to add it.
const NAMED: Array<[RegExp, string]> = [
  [/^\/courses\/masterclass\/?$/, 'masterclass'],
  [/^\/workshop\/?$/, 'workshop'],
  [/^\/w\/[^/]+\/?$/, 'w'],
];

// `raw` is a pathname or a full URL (a Referer header). Query and hash are
// dropped — they carry discount codes, referral ids and emails, none of which
// belong in an analytics column.
export function normalizeSignupPage(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  let path = value;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  path = path.split('?')[0].split('#')[0].trim();
  if (!path.startsWith('/')) return null;
  const lower = path.toLowerCase();
  for (const [re, key] of NAMED) {
    if (re.test(lower)) return key;
  }
  // Trim to something a column and a report can live with.
  return lower.slice(0, 64);
}

export const MASTERCLASS_PAGE: SignupPage = 'masterclass';
export const WORKSHOP_PAGE: SignupPage = 'workshop';
