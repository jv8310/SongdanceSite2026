import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  createWorkshop,
  updateWorkshop,
  softDeleteWorkshop,
  getProductBySlug,
  setConfig,
  slugify,
  type WorkshopInput,
} from '../../../../lib/workshops/db';

export const prerender = false;

const RETURN_TO = '/admin/workshops';

// Create / update / delete a workshop, plus the default Zoom link. Submitted
// as form-encoded POST from /admin/workshops and /admin/workshops/[id].
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const action = String(form.get('action') ?? '').trim();

  // Save the default Zoom link (separate small form on the index page).
  if (action === 'zoom') {
    const url = String(form.get('zoom_url_default') ?? '').trim();
    if (url) await setConfig(env.DB, 'zoom_url_default', url);
    return redirect(`${RETURN_TO}?flash=zoom`);
  }

  if (action === 'delete') {
    const id = parseInt(String(form.get('id') ?? ''), 10);
    if (Number.isFinite(id)) await softDeleteWorkshop(env.DB, id);
    return redirect(`${RETURN_TO}?flash=deleted`);
  }

  // Resolve product slugs → ids (defaults to the seeded SVH ticket/bump).
  const ticketSlug = String(form.get('main_product_slug') ?? 'svh-ticket').trim();
  const bumpSlug = String(form.get('bump_product_slug') ?? '').trim();
  const ticket = ticketSlug ? await getProductBySlug(env.DB, ticketSlug) : null;
  const bump = bumpSlug ? await getProductBySlug(env.DB, bumpSlug) : null;

  // datetime-local inputs are wall-clock with no zone → treat as UTC ("…Z").
  const startsAt = toUtcIso(String(form.get('starts_at') ?? '').trim());
  const endsAtRaw = String(form.get('ends_at') ?? '').trim();
  const endsAt = endsAtRaw ? toUtcIso(endsAtRaw) : null;
  if (!startsAt) return new Response('A start time is required', { status: 400 });

  const title = String(form.get('title') ?? '').trim();
  if (!title) return new Response('A title is required', { status: 400 });

  const input: WorkshopInput = {
    slug: slugify(String(form.get('slug') ?? '').trim() || title),
    title,
    teacher: nullable(form.get('teacher')),
    starts_at_utc: startsAt,
    ends_at_utc: endsAt,
    display_tz: String(form.get('display_tz') ?? 'Europe/Brussels').trim() || 'Europe/Brussels',
    zoom_url: nullable(form.get('zoom_url')),
    main_product_id: ticket?.id ?? null,
    bump_product_id: bump?.id ?? null,
    free_coupon: nullable(form.get('free_coupon')),
    source_tag: nullable(form.get('source_tag')),
    status: pick(form.get('status'), ['draft', 'published', 'cancelled'], 'draft'),
    is_replay: form.get('is_replay') === 'on' || form.get('is_replay') === '1' ? 1 : 0,
  };

  const id = parseInt(String(form.get('id') ?? ''), 10);
  if (Number.isFinite(id) && id > 0) {
    await updateWorkshop(env.DB, id, input);
    return redirect(`${RETURN_TO}/${id}?flash=saved`);
  }
  const newId = await createWorkshop(env.DB, input);
  return redirect(`${RETURN_TO}/${newId}?flash=saved`);
};

// "2026-06-15T18:00" → "2026-06-15T18:00:00Z". Admin enters the workshop's
// time as UTC wall-clock (the form labels it UTC); the display_tz handles
// per-viewer rendering.
function toUtcIso(local: string): string | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local);
  if (!m) return null;
  const ss = m[6] ?? '00';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${ss}Z`;
}

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}
function nullable(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}
function pick<T extends string>(v: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T {
  const s = String(v ?? '').trim() as T;
  return allowed.includes(s) ? s : fallback;
}
