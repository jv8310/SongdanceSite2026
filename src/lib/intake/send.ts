// Sending intake emails — one place for the invitation, the two reminders and
// the travel-questions email, whichever admin page presses the button
// (/admin/intakes/retreats or /admin/retreats/<slug>).
//
// Each send builds the invitee's own tokened link, goes out through Resend
// (retrying a 429 under Resend's 2 req/s account limit), and on success stamps
// the matching `*_sent_at` column so the admin can see what went when.

import { getRetreat, type RetreatRow } from './retreats-db';
import {
  buildInvitationEmail,
  buildTransportEmail,
  timestampColumnFor,
  type IntakeEmailKind,
  type InvitationRow,
} from './invitations';
import {
  sectionFromJson,
  transportSectionFor,
  tr,
  type TransportSection,
} from './transport';

const DEFAULT_FROM = 'Songdance <intakes@mail.songdance.co>';
const REPLY_TO = 'jacob@songdance.co';

// Resend's default account rate limit is 2 requests/second. A bulk send starts
// one email roughly every SEND_GAP_MS so it stays just under that ceiling
// instead of firing the whole batch at once (which made all but the first
// couple come back as HTTP 429 and get counted as "failed").
const SEND_GAP_MS = 550;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface IntakeSendEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_INTAKES_FROM?: string;
  PUBLIC_BASE_URL?: string;
}

export function isIntakeEmailKind(v: string): v is IntakeEmailKind {
  return v === 'invitation' || v === 'reminder' || v === 'final' || v === 'transport';
}

// The invitee's own link. The travel-questions email opens the transport
// section on its own; everything else opens the full intake.
export function intakeLink(
  baseUrl: string,
  inv: Pick<InvitationRow, 'retreat_slug' | 'token'>,
  kind: IntakeEmailKind = 'invitation',
): string {
  const base = `${baseUrl.replace(/\/+$/, '')}/intake?event=${encodeURIComponent(
    inv.retreat_slug,
  )}&inv=${encodeURIComponent(inv.token)}`;
  return kind === 'transport' ? `${base}&only=transport` : base;
}

// The product slug an intake is linked to, which is what a transport section
// is registered under. Null before migration 0085 (no column) or when unlinked.
export async function productSlugForIntake(
  db: D1Database,
  intakeSlug: string,
): Promise<string | null> {
  try {
    const row = await db
      .prepare(
        `SELECT p.slug FROM intake_retreats ir
           JOIN products p ON p.id = ir.product_id
          WHERE ir.slug = ?`,
      )
      .bind(intakeSlug)
      .first<{ slug: string }>();
    return row?.slug ?? null;
  } catch {
    return null;
  }
}

// The travel questions a retreat's intake asks, in order of precedence:
//   1. the section published from the admin (transport_json, migration 0087 —
//      drafted with Claude on the retreat page);
//   2. the section written in code (src/lib/intake/transport/<slug>.ts);
//   3. none.
// `draft: true` puts the unpublished draft first — only for an admin preview.
export async function transportSectionForIntake(
  db: D1Database,
  intakeSlug: string,
  opts: { draft?: boolean } = {},
): Promise<TransportSection | null> {
  const row = await getRetreat(db, intakeSlug).catch(() => null);
  if (opts.draft) {
    const draft = sectionFromJson(row?.transport_draft_json);
    if (draft) return draft;
  }
  const published = sectionFromJson(row?.transport_json);
  if (published) return published;
  return builtInTransportSection(db, intakeSlug);
}

// The code-defined section alone — what "revert to built-in" goes back to.
export async function builtInTransportSection(
  db: D1Database,
  intakeSlug: string,
): Promise<TransportSection | null> {
  const productSlug = await productSlugForIntake(db, intakeSlug);
  return transportSectionFor({ productSlug, eventCode: intakeSlug });
}

export type SendOutcome = { ok: true } | { ok: false; error: string };

// Send one email to one invitee. Refuses the screening emails to someone who
// already sent their intake (a reminder to a person who's done is noise); the
// travel email is always allowed — it's also how someone updates a flight.
export async function sendIntakeEmail(
  env: IntakeSendEnv,
  args: {
    invitation: InvitationRow;
    retreat: RetreatRow;
    kind: IntakeEmailKind;
    baseUrl: string;
    transport?: TransportSection | null;
  },
): Promise<SendOutcome> {
  const { invitation, retreat, kind } = args;
  if (kind !== 'transport' && invitation.submitted_at) {
    return { ok: false, error: 'already-submitted' };
  }
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'resend-key-missing' };

  const locale = retreat.invite_locale === 'en' ? 'en' : 'nl';
  const link = intakeLink(args.baseUrl, invitation, kind);
  const vars = { first_name: invitation.first_name, event_name: retreat.name, link };

  let email;
  if (kind === 'transport') {
    const section =
      args.transport ?? (await transportSectionForIntake(env.DB, retreat.slug));
    if (!section) return { ok: false, error: 'no-transport-section' };
    email = buildTransportEmail({
      locale,
      vars: { ...vars, why: tr(section.why, locale) ?? '' },
    });
  } else {
    email = buildInvitationEmail({ kind, locale, vars });
  }

  const sent = await sendViaResend({
    apiKey,
    from: env.RESEND_INTAKES_FROM ?? DEFAULT_FROM,
    to: invitation.email,
    replyTo: REPLY_TO,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (!sent.ok) return sent;

  await env.DB
    .prepare(
      `UPDATE intake_invitations SET ${timestampColumnFor(kind)} = datetime('now') WHERE id = ?`,
    )
    .bind(invitation.id)
    .run();
  return { ok: true };
}

export interface BulkSendResult {
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
}

// Many invitees, one kind, paced under Resend's rate limit. The sends overlap
// (each awaits its own round-trip) but start SEND_GAP_MS apart; the gap is
// timer/IO wait, which doesn't count against Worker CPU time. Rows that can't
// take this kind (already submitted) are counted as skipped, not failed.
export async function sendIntakeEmails(
  env: IntakeSendEnv,
  args: {
    invitations: InvitationRow[];
    kind: IntakeEmailKind;
    baseUrl: string;
    retreatFor: (slug: string) => Promise<RetreatRow | null>;
  },
): Promise<BulkSendResult> {
  const result: BulkSendResult = { sent: 0, failed: 0, skipped: 0, errors: [] };
  const sendable = args.invitations.filter(
    (i) => args.kind === 'transport' || !i.submitted_at,
  );
  result.skipped = args.invitations.length - sendable.length;

  const sections = new Map<string, TransportSection | null>();
  const pending: Promise<SendOutcome>[] = [];
  for (let i = 0; i < sendable.length; i += 1) {
    if (i > 0) await sleep(SEND_GAP_MS);
    const invitation = sendable[i]!;
    pending.push(
      (async (): Promise<SendOutcome> => {
        try {
          const retreat = await args.retreatFor(invitation.retreat_slug);
          if (!retreat) return { ok: false, error: 'retreat-missing' };
          let transport: TransportSection | null = null;
          if (args.kind === 'transport') {
            if (!sections.has(retreat.slug)) {
              sections.set(retreat.slug, await transportSectionForIntake(env.DB, retreat.slug));
            }
            transport = sections.get(retreat.slug) ?? null;
          }
          return await sendIntakeEmail(env, {
            invitation,
            retreat,
            kind: args.kind,
            baseUrl: args.baseUrl,
            transport,
          });
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      })(),
    );
  }
  for (const r of await Promise.all(pending)) {
    if (r.ok) result.sent += 1;
    else {
      result.failed += 1;
      if (result.errors.length < 3 && !result.errors.includes(r.error)) result.errors.push(r.error);
    }
  }
  return result;
}

async function sendViaResend(args: {
  apiKey: string;
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendOutcome> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
      // Rate limited: back off and retry, honouring Retry-After when present.
      if (res.status === 429 && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(
          (Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 5) : 1) * 1000,
        );
        continue;
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `resend-${res.status}: ${errText.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        await sleep(1000);
        continue;
      }
      return { ok: false, error: msg.includes('abort') ? 'timeout' : msg.slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: 'retries-exhausted' };
}
