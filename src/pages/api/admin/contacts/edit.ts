// POST /api/admin/contacts/edit — change one contact on the marketing list, from
// the Contact panel on /admin/people/<email> (ContactPanel.astro) and the "Add a
// contact" form on /admin/contacts. Form-encoded; answers with a 303 back to
// `return_to` (an /admin path) carrying ?contact_msg=… (+ &contact_err=1).
// Admin-gated; every change is logged with the admin's address (src/lib/contacts/edit.ts).
//
// Fields: email, action, return_to, plus the action's own:
//   add           name, timezone, country, tags, go=person (land on the person page)
//   details       name, timezone, country
//   add_tags      tags (comma-separated)
//   remove_tag    tag, confirm_evidence=1 (needed for a purchase-evidence tag)
//   set_field     key, value, confirm_evidence=1 (needed to change an evidence field)
//   remove_field  key, confirm_evidence=1 (needed for an evidence field)
//   delete        —  (refused while the contact carries purchase evidence)
import type { APIRoute } from 'astro';
import { getSessionEmail, readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  EMAIL_RE,
  addContact,
  addContactTags,
  deleteContact,
  removeContactField,
  removeContactTag,
  safeAdminReturn,
  setContactField,
  updateContactDetails,
  withFlash,
  type EditResult,
} from '../../../../lib/contacts/edit';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const cookie = readCookie(request);
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, cookie))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const by = (await getSessionEmail(env.ADMIN_SESSION_SECRET, cookie)) ?? 'admin';

  const form = await request.formData().catch(() => null);
  const get = (k: string) => String(form?.get(k) ?? '');
  const email = get('email').trim().toLowerCase();
  const action = get('action');
  const personPage = `/admin/people/${encodeURIComponent(email)}`;
  const back = safeAdminReturn(get('return_to'), EMAIL_RE.test(email) ? personPage : '/admin/contacts');
  const hash = back.startsWith('/admin/people') ? '#contact' : '#add-contact';
  const go = (to: string, r: EditResult, h = hash) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: withFlash(to, r.ok ? { contact_msg: r.message } : { contact_msg: r.error, contact_err: '1' }, h),
        'Cache-Control': 'no-store',
      },
    });

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return go(back, { ok: false, error: "That doesn't look like an email address." });
  }
  const confirmEvidence = get('confirm_evidence') === '1';
  const db = env.DB;

  let result: EditResult;
  try {
    switch (action) {
      case 'add': {
        result = await addContact(
          db,
          { email, name: get('name'), timezone: get('timezone'), country: get('country'), tags: get('tags') },
          by,
        );
        if (result.ok && get('go') === 'person') {
          // Land on the person page, its back link pointing where the form was.
          const to = back.startsWith('/admin/people') ? personPage : `${personPage}?return_to=${encodeURIComponent(back)}`;
          return go(to, result, '#contact');
        }
        break;
      }
      case 'details':
        result = await updateContactDetails(
          db,
          email,
          { name: get('name'), timezone: get('timezone'), country: get('country') },
          by,
        );
        break;
      case 'add_tags':
        result = await addContactTags(db, email, get('tags'), by);
        break;
      case 'remove_tag':
        result = await removeContactTag(db, email, get('tag'), by, { confirmEvidence });
        break;
      case 'set_field':
        result = await setContactField(db, email, get('key'), get('value'), by, { confirmEvidence });
        break;
      case 'remove_field':
        result = await removeContactField(db, email, get('key'), by, { confirmEvidence });
        break;
      case 'delete':
        result = await deleteContact(db, email, by);
        break;
      default:
        result = { ok: false, error: 'Unknown action.' };
    }
  } catch (err) {
    console.error('[contacts/edit] failed', err);
    result = { ok: false, error: `That did not work: ${String((err as Error)?.message ?? err).slice(0, 200)}` };
  }
  return go(back, result);
};
