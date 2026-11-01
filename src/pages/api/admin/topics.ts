// POST /api/admin/topics — set which email topics an address gets, from the
// Topics block on /admin/people/<email> (PersonTopics.astro). Form fields:
// email, return_to, keep (repeated: the topics left ticked). Every active topic
// not ticked becomes an opt-out (source admin:<signed-in email>); a ticked one
// that was opted out is lifted. Topics govern broadcasts only
// (src/lib/email/topics.ts). Comes back to the block with a flash. Admin-gated.
import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie } from '../../../lib/registrations/auth';
import { isEmailSuppressed } from '../../../lib/email/unsubscribe';
import { listTopics, setTopicOptOuts, topicsReady } from '../../../lib/email/topics';
import { logEventSafe } from '../../../lib/registrations/db';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const admin = await getSessionEmail(env.ADMIN_SESSION_SECRET, readCookie(request));
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const form = await request.formData().catch(() => null);
  const email = String(form?.get('email') ?? '').trim().toLowerCase();
  const rawReturn = String(form?.get('return_to') ?? '');
  const fallback = EMAIL_RE.test(email) ? `/admin/people/${encodeURIComponent(email)}` : '/admin/people';
  // Only ever back inside the admin (no open redirect).
  const back = rawReturn.startsWith('/admin') ? rawReturn : fallback;

  if (!EMAIL_RE.test(email)) return redirect(back, 'topics_err', 'Invalid email address.');
  if (!(await topicsReady(env.DB))) {
    return redirect(back, 'topics_err', 'Topics need migration 0099 (applied when merged).');
  }
  if (await isEmailSuppressed(env.DB, email).catch(() => false)) {
    return redirect(back, 'topics_err', 'Unsubscribed from everything — topics only matter once they are resubscribed.');
  }

  const topics = await listTopics(env.DB);
  const keep = new Set((form?.getAll('keep') ?? []).map((v) => String(v)));
  const out = topics.filter((t) => !keep.has(t.key)).map((t) => t.key);
  let changed: { added: string[]; removed: string[] };
  try {
    changed = await setTopicOptOuts(env.DB, email, out, `admin:${admin}`);
  } catch (err) {
    return redirect(back, 'topics_err', `Topics could not be saved: ${String(err).slice(0, 200)}`);
  }
  if (changed.added.length || changed.removed.length) {
    await logEventSafe(env.DB, {
      registration_id: null,
      kind: 'contact.topics_changed',
      source: 'admin',
      payload: { email, left: changed.added, rejoined: changed.removed, by: admin },
    });
  }
  const names = topics.filter((t) => out.includes(t.key)).map((t) => t.name);
  return redirect(back, 'topics_msg', names.length ? `Topics saved: left ${names.join(', ')}.` : 'Topics saved: subscribed to all.');
};

// 303 back with one flash, dropping any flash an earlier action left in the URL.
function redirect(base: string, key: 'topics_msg' | 'topics_err', msg: string): Response {
  const url = new URL(base, 'https://x');
  url.searchParams.delete('topics_msg');
  url.searchParams.delete('topics_err');
  url.searchParams.set(key, msg);
  return new Response(null, { status: 303, headers: { Location: `${url.pathname}${url.search}#topics` } });
}
