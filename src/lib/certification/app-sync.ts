// Telling the member app where someone's certification submission stands, so
// its certification page reads "in, waiting for review" or shows Jacob's
// response. The site never writes an app_ table: it asks the app through the
// APP_ADMIN binding (certApplication).
//
// What the app is told is always derived from the rows, never from the change
// that was just made: the person's newest submission that is not set aside.
//   submitted → 'submitted' (with the moment it was sent)
//   response  → 'response' (with Jacob's words)
//   certified, or nothing left → 'none' (certified is the app's own record)
// So calling it twice, or after any edit, converges. A call the app did not
// take marks the person's rows `app_sync_pending`; the hourly cron tries again.

import { askApp } from '../admin/app-access';
import { emailsWithPendingAppSync, latestOpenCertApplication, setCertAppSync } from './db';

type SyncEnv = { DB: D1Database; APP_ADMIN?: unknown };

export async function syncCertStatusToApp(env: SyncEnv, email: string, actor: string): Promise<{ ok: boolean; message: string | null }> {
  const latest = await latestOpenCertApplication(env.DB, email);
  const input =
    latest?.status === 'submitted'
      ? { email, status: 'submitted' as const, submittedAt: latest.submitted_at, actor }
      : latest?.status === 'response' && latest.response?.trim()
        ? { email, status: 'response' as const, submittedAt: latest.submitted_at, response: latest.response, respondedAt: latest.reviewed_at, actor }
        : { email, status: 'none' as const, actor };
  const r = await askApp(env, async (app) => {
    if (!app.certApplication) {
      return { ok: false as const, error: 'not-deployed', message: 'The member app has not been deployed with certification submissions yet.' };
    }
    return app.certApplication(input);
  });
  await setCertAppSync(env.DB, email, r.ok ? null : r.message).catch(() => {});
  return { ok: r.ok, message: r.ok ? null : r.message };
}

/** The hourly retry: everyone whose news the app has not confirmed. */
export async function retryCertAppSync(env: SyncEnv): Promise<{ tried: number; ok: number }> {
  let emails: string[] = [];
  try {
    emails = await emailsWithPendingAppSync(env.DB);
  } catch {
    return { tried: 0, ok: 0 }; // before migration 0100
  }
  let ok = 0;
  for (const email of emails) if ((await syncCertStatusToApp(env, email, 'cron')).ok) ok++;
  return { tried: emails.length, ok };
}
