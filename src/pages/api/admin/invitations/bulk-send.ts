import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import { getRetreat } from '../../../../lib/intake/retreats-db';
import {
  buildInvitationEmail,
  timestampColumnFor,
  type InvitationKind,
  type InvitationRow,
} from '../../../../lib/intake/invitations';

export const prerender = false;

const DEFAULT_FROM = 'Songdance <intakes@mail.songdance.co>';

// Bulk variant of /api/admin/invitations/send: accepts many `ids` and
// one `kind`. Sends in parallel via Resend, then batch-updates the
// matching timestamp column. Already-submitted rows are skipped.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const ids = form.getAll('ids').map((v) => String(v).trim()).filter(Boolean);
  const kindRaw = String(form.get('kind') ?? '').trim();
  if (ids.length === 0) return new Response('No ids', { status: 400 });
  if (kindRaw !== 'invitation' && kindRaw !== 'reminder' && kindRaw !== 'final') {
    return new Response('Bad kind', { status: 400 });
  }
  const kind = kindRaw as InvitationKind;

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return new Response('RESEND_API_KEY missing', { status: 500 });
  const from = env.RESEND_INTAKES_FROM ?? DEFAULT_FROM;

  const placeholders = ids.map(() => '?').join(',');
  const rowsQ = await env.DB
    .prepare(
      `SELECT id, token, retreat_slug, first_name, email,
              invitation_sent_at, reminder_sent_at, final_sent_at,
              submitted_at, created_at
         FROM intake_invitations
        WHERE id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<InvitationRow>();
  const rows = rowsQ.results ?? [];
  if (rows.length === 0) return new Response('No invitations found', { status: 404 });

  const retreatCache = new Map<string, Awaited<ReturnType<typeof getRetreat>>>();
  async function retreatFor(slug: string) {
    if (!retreatCache.has(slug)) retreatCache.set(slug, await getRetreat(env.DB, slug));
    return retreatCache.get(slug);
  }

  const baseUrl = (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, '');

  const sendable = rows.filter((r) => !r.submitted_at);
  const skipped = rows.length - sendable.length;

  const results = await Promise.allSettled(
    sendable.map(async (row) => {
      const retreat = await retreatFor(row.retreat_slug);
      if (!retreat) throw new Error('Retreat not found');
      const locale = retreat.invite_locale === 'en' ? 'en' : 'nl';
      const link = `${baseUrl}/intake?event=${encodeURIComponent(row.retreat_slug)}&inv=${encodeURIComponent(row.token)}`;
      const email = buildInvitationEmail({
        kind,
        locale,
        vars: { first_name: row.first_name, event_name: retreat.name, link },
      });
      const sent = await sendViaResend({
        apiKey,
        from,
        to: row.email,
        replyTo: 'jacob@songdance.co',
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      if (!sent.ok) throw new Error(sent.error);
      return row.id;
    }),
  );

  const okIds: string[] = [];
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') okIds.push(r.value);
    else failed += 1;
  }

  if (okIds.length > 0) {
    const col = timestampColumnFor(kind);
    const stmt = env.DB.prepare(
      `UPDATE intake_invitations SET ${col} = datetime('now') WHERE id = ?`,
    );
    await env.DB.batch(okIds.map((id) => stmt.bind(id)));
  }

  const retreatSlug = rows[0]!.retreat_slug;
  const params = new URLSearchParams({
    bulk: 'send',
    kind,
    sent: String(okIds.length),
    failed: String(failed),
    skipped: String(skipped),
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/admin/intakes/retreats?${params.toString()}#retreat-${encodeURIComponent(retreatSlug)}`,
    },
  });
};

async function sendViaResend(args: {
  apiKey: string;
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        from: args.from,
        to: [args.to],
        reply_to: args.replyTo,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `resend-${res.status}: ${errText.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.includes('abort') ? 'timeout' : msg.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
