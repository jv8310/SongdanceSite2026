// POST /api/admin/contacts/erase — erase one person's marketing data (see
// src/lib/contacts/erase.ts for what goes, what is anonymised and what stays —
// purchase evidence among it). From the erase step of the Contact panel on
// /admin/people/<email>. Form fields: email, confirm (must read
// "ERASE <email>"), return_to. Answers with a 303 to the person page carrying
// ?contact_msg=… (+ &contact_err=1). Admin-gated.
import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie, verifySession } from '../../../../lib/registrations/auth';
import { EMAIL_RE, withFlash } from '../../../../lib/contacts/edit';
import { eraseContact } from '../../../../lib/contacts/erase';

export const prerender = false;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request);
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, cookie))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const by = (await getSessionEmail(env.ADMIN_SESSION_SECRET, cookie)) ?? 'admin';

  const form = await request.formData().catch(() => null);
  const email = String(form?.get('email') ?? '').trim().toLowerCase();
  const confirm = String(form?.get('confirm') ?? '').trim();
  const rawReturn = String(form?.get('return_to') ?? '');
  // Back to the person page; its own back link (return_to) is kept.
  const personPage = `/admin/people/${encodeURIComponent(email)}`;
  const keep = rawReturn.startsWith('/admin') && !rawReturn.startsWith('//') && !rawReturn.startsWith('/admin/people/')
    ? `?return_to=${encodeURIComponent(rawReturn)}`
    : '';
  const to = (params: Record<string, string>, hash: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: withFlash(personPage + keep, params, hash), 'Cache-Control': 'no-store' },
    });

  if (!EMAIL_RE.test(email)) {
    return new Response(null, {
      status: 303,
      headers: { Location: withFlash('/admin/contacts', { contact_msg: "That doesn't look like an email address.", contact_err: '1' }, '#add-contact') },
    });
  }

  // "ERASE <email>": the word in any case, the address exactly (after lowercasing).
  const m = /^erase\s+(\S+)$/i.exec(confirm);
  if (!m || m[1].toLowerCase() !== email) {
    return to({ erase: '1', contact_msg: `Type ERASE ${email} exactly to confirm. Nothing was erased.`, contact_err: '1' }, '#erase');
  }

  const r = await eraseContact(env, email, by);
  if (!r.ok) return to({ erase: '1', contact_msg: r.error, contact_err: '1' }, '#erase');

  const c = r.counts;
  const parts: string[] = [];
  if (c.contact === 'deleted') parts.push('the contact');
  if (c.contact === 'minimised') parts.push("the contact's name, timezone, country and other fields");
  if (c.tags) parts.push(plural(c.tags, 'tag', 'tags'));
  if (c.recipients) parts.push(plural(c.recipients, 'broadcast queue row', 'broadcast queue rows'));
  if (c.clicks) parts.push(plural(c.clicks, 'link click', 'link clicks'));
  if (c.topicOptOuts) parts.push(plural(c.topicOptOuts, 'topic choice', 'topic choices'));
  if (c.newsletter) parts.push('the newsletter signup');
  if (c.events) parts.push(plural(c.events, 'log entry that named the address', 'log entries that named the address'));
  const sentences: string[] = [];
  sentences.push(parts.length ? `Erased: ${parts.join(', ')}.` : 'There was no marketing data to erase.');
  if (c.sendsAnonymised) {
    sentences.push(`${plural(c.sendsAnonymised, 'email record', 'email records')} anonymised (their counts stay in the stats).`);
  }
  const kept = [...r.kept.tags, ...r.kept.fields];
  if (kept.length) sentences.push(`Kept as purchase evidence, needed for the courses they bought: ${kept.join(', ')}.`);
  sentences.push('The address stays on the suppression list as “erased”, so it is never mailed or imported again.');
  sentences.push(
    r.drip === 'unsubscribed'
      ? 'Drip: unsubscribed there; delete the subscriber in Drip by hand.'
      : r.drip === 'failed'
        ? 'Drip: the call failed; unsubscribe and delete the subscriber in Drip by hand.'
        : 'Drip: not configured here; delete the subscriber in Drip by hand if it exists.',
  );
  return to({ contact_msg: sentences.join(' ') }, '#contact');
};
