// The launch-campaign opt-out (/unsubscribe-promo, "stop the launch emails"),
// recorded HERE first. It used to be a Drip tag only, so a broadcast sent from
// the site could not see it: the site's own contacts list now carries the tag
// (NOPROMO_TAG, 'nopromo_june26' — lowercase, like every contact_tags row), so a
// broadcast can exclude it, and Drip gets its 'nopromo_June26' tag as before,
// best-effort (its segments still read it).
//
// The link is unsigned (just ?e=<address>), so the local write is narrow on
// purpose: it tags an address that is ALREADY a contact and never creates one,
// and never one that was erased. A tag on an address we don't hold can't cause
// any mail, so leaving those out loses nothing.

import { NOPROMO_TAG } from './site-tags';
import { applyTag } from '../registrations/drip';
import { logEventSafe } from '../registrations/db';

// Drip's spelling of the same tag (Drip tags are case-sensitive in its UI).
const DRIP_PROMO_TAG = 'nopromo_June26';

export async function recordPromoOptOut(
  env: { DB: D1Database; DRIP_API_TOKEN?: string; DRIP_ACCOUNT_ID?: string },
  email: string,
): Promise<{ local: boolean; drip: boolean }> {
  const e = email.trim().toLowerCase();
  let local = false;
  try {
    const [ins] = await env.DB.batch([
      env.DB
        .prepare(
          `INSERT OR IGNORE INTO contact_tags (email, tag)
             SELECT ?1, ?2
              WHERE EXISTS (SELECT 1 FROM contacts WHERE email = ?1)
                AND NOT EXISTS (SELECT 1 FROM email_suppressions WHERE email = ?1 AND reason = 'erased')`,
        )
        .bind(e, NOPROMO_TAG),
      env.DB
        .prepare(
          `UPDATE contacts
              SET tags = (SELECT group_concat(tag, ', ') FROM (SELECT tag FROM contact_tags WHERE email = ?1 ORDER BY tag)),
                  updated_at = datetime('now')
            WHERE email = ?1`,
        )
        .bind(e),
    ]);
    local = (ins?.meta?.changes ?? 0) > 0;
  } catch (err) {
    console.error('[promo-optout] local write failed', err);
  }

  let drip = false;
  if (env.DRIP_API_TOKEN && env.DRIP_ACCOUNT_ID) {
    try {
      await applyTag({ apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID }, e, DRIP_PROMO_TAG);
      drip = true;
    } catch {
      // best-effort: the local tag is what the site's broadcasts read
    }
  }

  await logEventSafe(env.DB, {
    registration_id: null,
    kind: 'contact.promo_optout',
    source: 'link',
    payload: { email: e, local, drip },
  });
  return { local, drip };
}
