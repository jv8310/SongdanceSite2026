// Invitation flow for intake retreats.
//
// - parseBulkInvitees: turn a textarea-pasted blob into rows
// - listInvitations / getInvitationByToken: D1 reads
// - buildInvitationEmail: render the subject + HTML + text for one of
//   { invitation, reminder, final } in NL or EN
// - genToken: 32-char URL-safe random for the ?inv= URL parameter
//
// The intake page (intake.astro) resolves ?inv=<token> to an
// invitation row, force-prefills email + full_name from it, and the
// /api/intake/submit endpoint marks submitted_at when the form arrives.

import type { Locale } from './copy';

export interface InvitationRow {
  id: string;
  token: string;
  retreat_slug: string;
  first_name: string | null;
  email: string;
  invitation_sent_at: string | null;
  reminder_sent_at: string | null;
  final_sent_at: string | null;
  submitted_at: string | null;
  created_at: string;
}

export type InvitationKind = 'invitation' | 'reminder' | 'final';

export interface ParsedLine {
  first_name: string | null;
  email: string;
}

const EMAIL_IN_LINE = /([^\s,<>"']+@[^\s,<>"']+\.[^\s,<>"']+)/;

// Parse one line like "Jane jane@x.com", "Jane Doe <jane@x.com>",
// "Jane, jane@x.com" or just "jane@x.com". The first whitespace-
// separated token before the email is used as the first name; the rest
// (likely a surname) is dropped so we don't accidentally greet
// "Hi Jane Doe-van-der-Berg,". Returns null when no email is found.
export function parseLine(raw: string): ParsedLine | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(EMAIL_IN_LINE);
  if (!m) return null;
  const email = m[1]!.toLowerCase();
  const before = trimmed.slice(0, m.index ?? 0);
  const cleaned = before
    .replace(/[<>,;]+$/g, '')
    .replace(/^[<>,;]+/, '')
    .trim();
  const first = cleaned ? cleaned.split(/\s+/)[0]!.replace(/[,;]+$/g, '') : '';
  return { first_name: first || null, email };
}

export function parseBulkInvitees(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const p = parseLine(line);
    if (!p) continue;
    if (seen.has(p.email)) continue;
    seen.add(p.email);
    out.push(p);
  }
  return out;
}

export function genToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function genUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export async function listInvitations(
  db: D1Database,
  retreat_slug: string,
): Promise<InvitationRow[]> {
  const q = await db
    .prepare(
      `SELECT id, token, retreat_slug, first_name, email,
              invitation_sent_at, reminder_sent_at, final_sent_at,
              submitted_at, created_at
         FROM intake_invitations
         WHERE retreat_slug = ?
         ORDER BY submitted_at IS NOT NULL, created_at DESC`,
    )
    .bind(retreat_slug)
    .all<InvitationRow>();
  return q.results ?? [];
}

export async function getInvitationByToken(
  db: D1Database,
  token: string,
): Promise<InvitationRow | null> {
  const row = await db
    .prepare(
      `SELECT id, token, retreat_slug, first_name, email,
              invitation_sent_at, reminder_sent_at, final_sent_at,
              submitted_at, created_at
         FROM intake_invitations
         WHERE token = ?`,
    )
    .bind(token)
    .first<InvitationRow>();
  return row ?? null;
}

export async function getInvitationById(
  db: D1Database,
  id: string,
): Promise<InvitationRow | null> {
  const row = await db
    .prepare(
      `SELECT id, token, retreat_slug, first_name, email,
              invitation_sent_at, reminder_sent_at, final_sent_at,
              submitted_at, created_at
         FROM intake_invitations
         WHERE id = ?`,
    )
    .bind(id)
    .first<InvitationRow>();
  return row ?? null;
}

// Locate an invitation row for a given retreat + email — used by the
// submit endpoint to mark `submitted_at` even when the deelnemer didn't
// click through the tokened URL (e.g. forwarded link, typed it in).
export async function findInvitationForSubmission(
  db: D1Database,
  retreat_slug: string,
  email: string,
): Promise<InvitationRow | null> {
  const row = await db
    .prepare(
      `SELECT id, token, retreat_slug, first_name, email,
              invitation_sent_at, reminder_sent_at, final_sent_at,
              submitted_at, created_at
         FROM intake_invitations
         WHERE retreat_slug = ? AND email = ?`,
    )
    .bind(retreat_slug, email.toLowerCase())
    .first<InvitationRow>();
  return row ?? null;
}

export async function markInvitationSubmitted(
  db: D1Database,
  id: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE intake_invitations
          SET submitted_at = COALESCE(submitted_at, datetime('now'))
        WHERE id = ?`,
    )
    .bind(id)
    .run();
}

// ---------- Email templates ----------

interface TplVars {
  first_name: string | null;
  event_name: string;
  link: string;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function greeting(locale: Locale, first_name: string | null): string {
  if (locale === 'nl') return first_name ? `Dag ${first_name},` : 'Dag,';
  return first_name ? `Hi ${first_name},` : 'Hi,';
}

function signoff(locale: Locale): string {
  return locale === 'nl' ? 'Met warme groet,\nJacob' : 'With warmth,\nJacob';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bodyCopy(
  kind: InvitationKind,
  locale: Locale,
  event_name: string,
): string {
  if (locale === 'nl') {
    if (kind === 'invitation') {
      return `Om een veilig en gedragen veld te kunnen waarborgen, vraag ik alle deelnemers op voorhand een intake te doen. Het is een eerste kennismaking — vijftien minuten, je antwoorden lees ik zorgvuldig.`;
    }
    if (kind === 'reminder') {
      return `Een vriendelijke herinnering: je intake voor ${event_name} heb ik nog niet binnen. Het invullen kost ongeveer vijftien minuten, en helpt me jouw deelname goed voor te bereiden.\n\nMocht iets onduidelijk zijn of je vragen hebt, laat het me weten met een reply.`;
    }
    return `Dit is mijn laatste bericht over de intake voor ${event_name}. Ik heb je antwoorden nodig om je deelname goed voor te bereiden — vul je 'm binnen een paar dagen in?`;
  }
  if (kind === 'invitation') {
    return `To safeguard a held and grounded container, I ask all participants to complete an intake beforehand. It's a first meeting — fifteen minutes, your answers read with care.`;
  }
  if (kind === 'reminder') {
    return `A gentle reminder: I haven't yet received your intake for ${event_name}. It takes about fifteen minutes, and helps me prepare your participation well.\n\nIf anything feels unclear or you have questions, just reply.`;
  }
  return `This is my last note about the intake for ${event_name}. I need your answers to prepare your participation well — would you fill it in within a few days?`;
}

function subjectFor(
  kind: InvitationKind,
  locale: Locale,
  event_name: string,
): string {
  if (locale === 'nl') {
    if (kind === 'invitation') return `Intake voor ${event_name}`;
    if (kind === 'reminder') return `Herinnering — intake voor ${event_name}`;
    return `Laatste bericht — intake voor ${event_name}`;
  }
  if (kind === 'invitation') return `Intake for ${event_name}`;
  if (kind === 'reminder') return `Reminder — intake for ${event_name}`;
  return `Final note — intake for ${event_name}`;
}

function ctaLabel(locale: Locale): string {
  return locale === 'nl' ? 'Vul de intake hier in:' : 'Fill in the intake here:';
}

export function buildInvitationEmail(args: {
  kind: InvitationKind;
  locale: Locale;
  vars: TplVars;
}): EmailContent {
  const { kind, locale, vars } = args;
  const subject = subjectFor(kind, locale, vars.event_name);
  const greet = greeting(locale, vars.first_name);
  const body = bodyCopy(kind, locale, vars.event_name);
  const cta = ctaLabel(locale);
  const sig = signoff(locale);

  const text = `${greet}\n\n${body}\n\n${cta}\n${vars.link}\n\n${sig}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4ECDF;font-family:Georgia,serif;color:#2A1B2A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="padding:48px 16px;">
    <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:24px 8px;">
        <p style="margin:0;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#2A1B2A;">${escapeHtml(greet)}</p>
        <p style="margin:18px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.75;color:#2A1B2A;white-space:pre-line;">${escapeHtml(body)}</p>
        <p style="margin:24px 0 6px;font-family:Georgia,serif;font-size:15px;color:#4A3848;">${escapeHtml(cta)}</p>
        <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;">
          <a href="${escapeHtml(vars.link)}" style="color:#A14826;text-decoration:underline;word-break:break-all;">${escapeHtml(vars.link)}</a>
        </p>
        <p style="margin:28px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#2A1B2A;white-space:pre-line;">${escapeHtml(sig)}</p>
      </td></tr>
      <tr><td align="center" style="padding:32px 8px 0;">
        <p style="margin:0;font-family:Georgia,serif;font-size:11px;color:#B6A8B4;">Songdance · songdance.co</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject, html, text };
}

export function timestampColumnFor(kind: InvitationKind): string {
  if (kind === 'invitation') return 'invitation_sent_at';
  if (kind === 'reminder') return 'reminder_sent_at';
  return 'final_sent_at';
}
