import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';
import {
  upsertEvent,
  deleteEvent,
  getEvent,
  CATEGORIES,
  STATUSES,
  LANGUAGES,
  type EventCategory,
  type EventLanguage,
  type EventStatus,
} from '../../../lib/events/db';

export const prerender = false;

const RETURN_TO = '/admin/events';

// Create / update / delete an event grid card from /admin/events.
// Accepts multipart/form-data so an optional card image can be uploaded;
// the image is stored in R2 and referenced by image_key.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const action = String(form.get('action') ?? '').trim();

  if (action === 'delete') {
    const id = String(form.get('id') ?? '').trim();
    if (!id) return new Response('Bad id', { status: 400 });
    const existing = await getEvent(env.DB, id);
    if (existing?.image_key) {
      await env.MEDIA.delete(existing.image_key).catch(() => {});
    }
    await deleteEvent(env.DB, id);
    return redirect(`${RETURN_TO}?flash=deleted`);
  }

  const originalId = String(form.get('original_id') ?? '').trim();
  const id = normaliseSlug(String(form.get('id') ?? '').trim());
  const title = String(form.get('title') ?? '').trim();
  if (!id || !title) return new Response('Title and id are required', { status: 400 });

  const category = pick(form.get('category'), CATEGORIES, 'online');
  const language = pick(form.get('language'), LANGUAGES, 'en') as EventLanguage;
  const status = pick(form.get('status'), STATUSES, 'open') as EventStatus;

  const facilitators = String(form.get('facilitators') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const capacityRaw = String(form.get('capacity') ?? '').trim();
  const capacity = capacityRaw ? Math.max(0, parseInt(capacityRaw, 10)) || null : null;

  const sortRaw = String(form.get('sort_order') ?? '').trim();
  const sort_order = sortRaw ? parseInt(sortRaw, 10) || 0 : 0;

  // Optional image upload → R2. Only set image_key when a file is actually
  // provided, so saving without re-uploading keeps the existing image.
  let image_key: string | null | undefined = undefined;
  const file = form.get('image');
  if (file instanceof File && file.size > 0) {
    const ext = extFor(file.type, file.name);
    const key = `events/${id}-${Date.now()}${ext}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
    image_key = key;
    // Clean up a previous image if we're replacing one on the same row.
    const prev = await getEvent(env.DB, originalId || id);
    if (prev?.image_key && prev.image_key !== key) {
      await env.MEDIA.delete(prev.image_key).catch(() => {});
    }
  } else if (form.get('remove_image') === '1') {
    const prev = await getEvent(env.DB, originalId || id);
    if (prev?.image_key) await env.MEDIA.delete(prev.image_key).catch(() => {});
    image_key = null;
  }

  await upsertEvent(
    env.DB,
    {
      id,
      title,
      category: category as EventCategory,
      language,
      facilitators,
      start_date: nullable(form.get('start_date')),
      end_date: nullable(form.get('end_date')),
      location: nullable(form.get('location')),
      capacity,
      price: nullable(form.get('price')),
      status,
      summary: nullable(form.get('summary')),
      href: nullable(form.get('href')),
      image_key,
      ongoing: form.get('ongoing') === 'on' || form.get('ongoing') === '1' ? 1 : 0,
      published: form.get('published') === 'on' || form.get('published') === '1' ? 1 : 0,
      sort_order,
    },
    originalId || undefined,
  );

  return redirect(`${RETURN_TO}?flash=saved#event-${id}`);
};

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

function extFor(mime: string, name: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/gif': '.gif',
  };
  if (map[mime]) return map[mime];
  const m = /\.[a-z0-9]+$/i.exec(name);
  return m ? m[0].toLowerCase() : '';
}

function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
