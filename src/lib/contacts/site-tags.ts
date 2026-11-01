// Tags and contact fields with a meaning beyond marketing. A leaf module (no
// imports), so the contacts importer (broadcasts/db.ts), the contact editor
// (./edit.ts), erase (./erase.ts) and the promo opt-out can all read it without
// an import cycle.
//
// Two lists live here:
//
// • SITE_OWNED_TAGS — tags the site writes itself, never a CSV. The contacts
//   import leaves them alone when it replaces a row's tags.
//
// • Purchase evidence — tags and contacts.custom keys that are the only proof
//   of purchase for people who bought before the site took payments (they have
//   no order row here). The member app's sync reads them as entitlements
//   (songdance-app apps/api/src/sync/site.ts loadContactTags, derive.ts
//   dripFactsFromInput / readWeekField / readCertStatusField), and so does the
//   site (src/lib/courses/live-pass-plan.ts reads prod_svh_12w, the workshop
//   downsell in src/lib/workshops/cron.ts reads the product tags). So Erase
//   keeps them, the contact editor asks before removing one, and "Remove from
//   the contacts list" refuses while any are there.

// The local promo opt-out tag (unsubscribe-promo). The same literal is written
// by src/lib/contacts/promo-optout.ts; import it from here rather than repeating it.
export const NOPROMO_TAG = 'nopromo_june26';

// Written by the site, never by a CSV: the purchase mirror's buyer marker, the
// site's newsletter form, and the promo opt-out. The importer never deletes these.
export const SITE_OWNED_TAGS = ['in-drip', 'newsletter', NOPROMO_TAG] as const;

// Tag prefixes / substrings that mark a purchase (all compared lowercased).
const EVIDENCE_TAG_PREFIXES = ['prod_', 'prodg_', 'cert_', 'ceee'] as const;
const EVIDENCE_TAG_CONTAINS = ['vsh'] as const;
const EVIDENCE_TAG_EXACT = ['in-drip'] as const;

/** True when a contact tag is proof of a purchase (see the header). Case-insensitive. */
export function isPurchaseEvidenceTag(tag: string): boolean {
  const t = String(tag ?? '').trim().toLowerCase();
  if (!t) return false;
  if ((EVIDENCE_TAG_EXACT as readonly string[]).includes(t)) return true;
  if (EVIDENCE_TAG_PREFIXES.some((p) => t.startsWith(p))) return true;
  return EVIDENCE_TAG_CONTAINS.some((s) => t.includes(s));
}

// contacts.custom keys Drip synced for the SVH course (week counter, start day,
// certification status). The member app reads the week under any of the
// svh_week aliases, so all of them count.
const EVIDENCE_FIELDS = [
  'prod_svh_week',
  'prod_svh_9m_status',
  'prod_svh_start',
  'svh_week',
  'svh_current_week',
  'prod_svh_current_week',
] as const;

/** True when a contacts.custom key is purchase evidence (see the header). Case-insensitive. */
export function isPurchaseEvidenceField(key: string): boolean {
  const k = String(key ?? '').trim().toLowerCase();
  return (EVIDENCE_FIELDS as readonly string[]).includes(k);
}

// For the admin pages: why these are kept (a short phrase, then the detail).
export const PURCHASE_EVIDENCE_WHY = 'needed for the courses they bought';
export const PURCHASE_EVIDENCE_DETAIL =
  'The member app and the site read them to know what this person owns, and for people who bought before the site took payments they are the only record.';
