// Who a broadcast comes from (migration 0098). A broadcast may name its own
// sender — a name and the part before the @ — and its own reply-to; NULL means
// the default, env MARKETING_FROM ("Jacob from Songdance" <info@m.songdance.co>)
// replying to MARKETING_REPLY_TO (support@songdance.co).
//
// The domain is never stored or typed: it is read from MARKETING_FROM at send
// time, so a broadcast can only ever go out from the verified marketing domain
// (m.songdance.co). The code's own MARKETING_FROM_DEFAULT points at the
// transactional mail.songdance.co, so it is deliberately NOT where the domain
// comes from — the fallback here is m.songdance.co.
//
// Every preset replies to the default (support@songdance.co); the reply-to is
// editable per broadcast whichever sender is picked. A stored value that no
// longer validates falls back to the default silently: one bad row must never
// make Resend reject a whole batch.

import { MARKETING_FROM_DEFAULT, MARKETING_REPLY_TO_DEFAULT } from '../workshops/emails';

export const MARKETING_SENDER_DOMAIN_FALLBACK = 'm.songdance.co';

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const NAME_RE = /^[\p{L}\p{M}\p{N} &'’.\-!]+$/u;
const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

// The domain inside <…@domain> of env.MARKETING_FROM (or a bare address there),
// else m.songdance.co.
export function marketingSenderDomain(env: { MARKETING_FROM?: string }): string {
  const raw = (env.MARKETING_FROM ?? '').trim();
  const m = raw.match(/<[^<>@\s]+@([^<>@\s]+)>/) ?? raw.match(/^[^<>@\s]+@([^<>@\s]+)$/);
  const domain = (m?.[1] ?? '').toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : MARKETING_SENDER_DOMAIN_FALLBACK;
}

export type SenderFields = { from_name: string | null; from_local: string | null; reply_to: string | null };

// Presets carry a name and an address only; the reply-to stays whatever the
// broadcast says (default: support@songdance.co).
export const SENDER_PRESETS: Array<{ key: string; label: string; from_name: string | null; from_local: string | null }> = [
  { key: 'default', label: 'Jacob from Songdance — info@ (default)', from_name: null, from_local: null },
  { key: 'jacob-nl', label: 'Jacob van Songdance — info@', from_name: 'Jacob van Songdance', from_local: 'info' },
  { key: 'lorenz-carmen', label: 'Lorenz & Carmen — deutsch@', from_name: 'Lorenz & Carmen', from_local: 'deutsch' },
];

// The preset whose name and address match, else 'custom'.
export function presetKeyFor(f: { from_name?: string | null; from_local?: string | null }): string {
  const name = (f.from_name ?? '').trim();
  const local = (f.from_local ?? '').trim().toLowerCase();
  for (const p of SENDER_PRESETS) {
    if ((p.from_name ?? '') === name && (p.from_local ?? '') === local) return p.key;
  }
  return 'custom';
}

function validName(v: string): boolean {
  return v.length >= 1 && v.length <= 80 && NAME_RE.test(v);
}
function validLocal(v: string): boolean {
  return LOCAL_RE.test(v);
}
function validReplyTo(v: string): boolean {
  return v.length <= 254 && EMAIL_RE.test(v);
}

// Validate what a compose form (or the app) posted. A known preset → its name
// and address; 'custom' → the typed ones, checked. The reply-to is checked
// either way.
export function resolveSenderInput(
  input: { preset?: unknown; from_name?: unknown; from_local?: unknown; reply_to?: unknown },
  _env?: { MARKETING_FROM?: string },
): { ok: true; fields: SenderFields } | { ok: false; error: string } {
  const replyRaw = String(input.reply_to ?? '').trim().toLowerCase();
  let reply_to: string | null = null;
  if (replyRaw) {
    if (!validReplyTo(replyRaw)) return { ok: false, error: "The reply-to address doesn't look like an email address." };
    reply_to = replyRaw;
  }

  const presetKey = String(input.preset ?? '').trim() || 'default';
  const preset = SENDER_PRESETS.find((p) => p.key === presetKey);
  if (preset) return { ok: true, fields: { from_name: preset.from_name, from_local: preset.from_local, reply_to } };
  if (presetKey !== 'custom') return { ok: false, error: 'Pick a sender from the list.' };

  const name = String(input.from_name ?? '').trim();
  const local = String(input.from_local ?? '').trim().toLowerCase();
  if (!name && !local) return { ok: true, fields: { from_name: null, from_local: null, reply_to } };
  if (!name || !local) {
    return { ok: false, error: 'A sender needs both a name and an address (or neither, for the default).' };
  }
  if (!validName(name)) {
    return { ok: false, error: "The sender name may use letters, numbers, spaces and & ' . - ! (up to 80 characters)." };
  }
  if (!validLocal(local)) {
    return { ok: false, error: 'The address before the @ may use letters, numbers, dots, dashes and underscores.' };
  }
  return { ok: true, fields: { from_name: name, from_local: local, reply_to } };
}

// The From and Reply-To a broadcast goes out with.
export function broadcastSender(
  b: { from_name?: string | null; from_local?: string | null; reply_to?: string | null },
  env: { MARKETING_FROM?: string; MARKETING_REPLY_TO?: string },
): { from: string; replyTo: string; isDefault: boolean } {
  const name = (b.from_name ?? '').trim();
  const local = (b.from_local ?? '').trim().toLowerCase();
  const custom = !!name && !!local && validName(name) && validLocal(local);
  const from = custom
    ? `"${name}" <${local}@${marketingSenderDomain(env)}>`
    : env.MARKETING_FROM || MARKETING_FROM_DEFAULT;
  const reply = (b.reply_to ?? '').trim().toLowerCase();
  const replyTo = reply && validReplyTo(reply) ? reply : env.MARKETING_REPLY_TO || MARKETING_REPLY_TO_DEFAULT;
  return { from, replyTo, isDefault: !custom };
}
