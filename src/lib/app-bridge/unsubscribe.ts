// The site's half of unsubscribing someone from the member app's MCP tools
// (songdance-app `unsubscribe_email`), so Claude can do what the admin's
// Unsubscribe button on /admin/people/<email> does. Reached only through the
// AppBridge entrypoint (src/worker-entrypoint.ts), never over HTTP.
//
// The suppression row is the one that counts: every marketing send on the
// site (broadcasts, workshop lifecycle, course sequences) and the app's
// community mail read email_suppressions. Drip follows best-effort, and the
// answer says what Drip did, since that is the part that can fail quietly.

import { isEmailSuppressed, suppressEmail } from '../email/unsubscribe';
import { unsubscribeFromAll, getSubscriber } from '../registrations/drip';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type BridgeEnv = { DB: D1Database; DRIP_API_TOKEN?: string; DRIP_ACCOUNT_ID?: string };

export type UnsubscribeAnswer =
  | {
      ok: true;
      email: string;
      // Already on the list before this call: nothing about it changed.
      alreadySuppressed: boolean;
      drip: 'unsubscribed' | 'not-in-drip' | 'not-configured' | 'failed';
      dripError?: string;
    }
  | { ok: false; error: string };

export async function unsubscribeFromApp(
  env: BridgeEnv,
  input: { email?: unknown; actor?: unknown },
): Promise<UnsubscribeAnswer> {
  const email = String(input?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: 'invalid-email' };
  const actor = String(input?.actor ?? '').trim().slice(0, 120) || 'unknown';

  const alreadySuppressed = await isEmailSuppressed(env.DB, email);
  // Same row the admin button writes; an existing row keeps its reason.
  await suppressEmail(env.DB, email, `app:${actor}`);

  if (!env.DRIP_API_TOKEN || !env.DRIP_ACCOUNT_ID) {
    return { ok: true, email, alreadySuppressed, drip: 'not-configured' };
  }
  const cfg = { apiToken: env.DRIP_API_TOKEN, accountId: env.DRIP_ACCOUNT_ID };
  try {
    if (!(await getSubscriber(cfg, email))) return { ok: true, email, alreadySuppressed, drip: 'not-in-drip' };
    await unsubscribeFromAll(cfg, email);
    return { ok: true, email, alreadySuppressed, drip: 'unsubscribed' };
  } catch (err) {
    return { ok: true, email, alreadySuppressed, drip: 'failed', dripError: String(err).slice(0, 300) };
  }
}
