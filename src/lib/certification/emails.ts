// The words of the certification emails (November 2026). All transactional
// (they are about the student's own submission), so never suppression-gated;
// sent from the default Songdance sender with replies to support@. Previewed
// on /admin/emails → "Certification".
//
// Copy-book rules hold here as everywhere: somatic sounding is the practice,
// Somatic Vocal Healing the method; the practitioner holds space, the client
// does the healing; no outcome promises.

import { escapeHtml, PALETTE, shell, type EmailContent } from '../workshops/emails';
import { renderFeedback } from '../client/feedback-editor';
import { tidyFirstName } from '../email/names';

// The student's certification page in the member app: the status, Jacob's
// response, the certificate. (The app's route; see songdance-app.)
export const CERT_APP_URL = 'https://circle.songdance.co/certification';

const greetingText = (name?: string | null) => {
  const first = tidyFirstName(name);
  return first ? `Dear ${first},` : 'Hello,';
};
const p = (html: string) => `<p style="margin:0 0 14px;">${html}</p>`;
const label = (text: string) =>
  `<p style="margin:22px 0 8px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:${PALETTE.ember};">${escapeHtml(text)}</p>`;

// Jacob's words, laid out as the app lays them out (the same reader as the
// admin's preview), with the email's own type on each block.
function wordsHtml(text: string): string {
  return renderFeedback(text)
    .replace(/<p>/g, '<p style="margin:0 0 14px;">')
    .replace(/<h4>/g, `<h4 style="margin:18px 0 8px;font-family:Georgia,serif;font-weight:400;font-size:18px;color:${PALETTE.ink};">`)
    .replace(/<(ul|ol)>/g, '<$1 style="margin:0 0 14px;padding-left:22px;">')
    .replace(/<li>/g, '<li style="margin:0 0 6px;">')
    .replace(/<a /g, `<a style="color:${PALETTE.ember};" `);
}
const wordsText = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^##\s+/gm, '').trim();

// ── The form is in ──────────────────────────────────────────────────────────
export function certReceivedEmail(ctx: { name?: string | null; videoGiven: boolean }): EmailContent {
  const lines = [
    'Your submission for the Somatic Vocal Healing certification is in. Thank you, and congratulations on getting here.',
    ctx.videoGiven
      ? 'It is now waiting for review. Jacob looks at every session video himself, in the order they come in.'
      : 'It is now waiting for review. Jacob looks at every session video himself, in the order they come in. If you sent your video through the upload link, there is nothing more to do.',
    'Within 90 days you will hear from him, by email and on your certification page in the Songdance app: personal feedback on your session and, if all is in place, your certificate.',
    'Something to add or correct in the meantime? Just reply to this email. A person reads it.',
  ];
  const html = shell({
    preheader: 'Your certification submission is in, and waiting for review.',
    heading: 'Your submission is in',
    bodyHtml: [p(escapeHtml(greetingText(ctx.name))), ...lines.map((l) => p(escapeHtml(l))), p('With love,<br />Jacob')].join('\n'),
    cta: { label: 'Open your certification page', href: CERT_APP_URL },
  });
  const text = [greetingText(ctx.name), '', ...lines.flatMap((l) => [l, '']), `Your certification page: ${CERT_APP_URL}`, '', 'With love,', 'Jacob'].join('\n');
  return { subject: 'Your certification submission is in', html, text };
}

// ── Certified ───────────────────────────────────────────────────────────────
export function certCertifiedEmail(ctx: { name?: string | null; hasCertificate: boolean; attached?: boolean; feedback: string | null }): EmailContent {
  const opening = 'Congratulations: you are certified in Somatic Vocal Healing.';
  const second = 'I have watched your session, and it is a joy to write this to you.';
  const where = ctx.attached
    ? 'Your certificate is attached to this email. It is also on your certification page in the Songdance app, to download whenever you need it.'
    : ctx.hasCertificate
    ? 'Your certificate is ready to download on your certification page in the Songdance app.'
    : 'Your certificate will be on your certification page in the Songdance app as soon as it is added.';
  const fb = ctx.feedback?.trim() ? ctx.feedback : null;
  const html = shell({
    preheader: 'Congratulations: you are certified in Somatic Vocal Healing.',
    heading: 'You are certified',
    bodyHtml: [
      p(escapeHtml(greetingText(ctx.name))),
      p(`<strong>${escapeHtml(opening)}</strong>`),
      p(escapeHtml(second)),
      p(escapeHtml(where)),
      fb ? `${label('My feedback on your session')}${wordsHtml(fb)}` : '',
      p('Thank you for the care you brought to this. I am glad you are out there holding space.'),
      p('With love,<br />Jacob'),
    ].join('\n'),
    cta: { label: ctx.attached || !ctx.hasCertificate ? 'Open your certification page' : 'Download your certificate', href: CERT_APP_URL },
  });
  const text = [
    greetingText(ctx.name),
    '',
    opening,
    '',
    second,
    '',
    where,
    '',
    ...(fb ? ['MY FEEDBACK ON YOUR SESSION', '', wordsText(fb), ''] : []),
    'Thank you for the care you brought to this. I am glad you are out there holding space.',
    '',
    `Your certification page: ${CERT_APP_URL}`,
    '',
    'With love,',
    'Jacob',
  ].join('\n');
  return { subject: 'Congratulations, you are certified', html, text };
}

// ── Jacob's response, without a certification (yet) ─────────────────────────
export function certResponseEmail(ctx: { name?: string | null; response: string; applyUrl: string }): EmailContent {
  const intro = 'I have watched the session you sent for your Somatic Vocal Healing certification. Thank you for it. Before I certify you there is something I would like you to look at; my response is below.';
  const next = 'When you are ready, record a new session and send the form again. The same response is on your certification page in the Songdance app.';
  const html = shell({
    preheader: 'Jacob has watched your session. Please see his response.',
    heading: 'My response to your session',
    bodyHtml: [
      p(escapeHtml(greetingText(ctx.name))),
      p(escapeHtml(intro)),
      label('My response'),
      wordsHtml(ctx.response),
      p(escapeHtml(next)),
      p('Questions about any of it? Just reply to this email.'),
      p('With love,<br />Jacob'),
    ].join('\n'),
    cta: { label: 'Send the form again', href: ctx.applyUrl },
    extras: [{ label: 'Your certification page', href: CERT_APP_URL }],
  });
  const text = [
    greetingText(ctx.name),
    '',
    intro,
    '',
    'MY RESPONSE',
    '',
    wordsText(ctx.response),
    '',
    next,
    '',
    `Send the form again: ${ctx.applyUrl}`,
    `Your certification page: ${CERT_APP_URL}`,
    '',
    'Questions about any of it? Just reply to this email.',
    '',
    'With love,',
    'Jacob',
  ].join('\n');
  return { subject: 'Your certification: please see my response', html, text };
}

// ── Internal: a new submission (SD-CERT) ────────────────────────────────────
export function certInternalEmail(ctx: {
  name: string;
  email: string;
  videoUrl: string | null;
  videoUploaded: boolean;
  courseFeedback: string | null;
  testimonial: string | null;
  comments: string | null;
  windowLine: string;
  adminUrl: string;
}): EmailContent {
  const rows: Array<[string, string]> = [
    ['From', `${ctx.name} (${ctx.email})`],
    ['Video', ctx.videoUrl ?? (ctx.videoUploaded ? 'sent through the upload link (Dropbox)' : 'none given')],
    ['Window', ctx.windowLine],
    ['Feedback on the course', ctx.courseFeedback ?? '—'],
    ['Testimonial', ctx.testimonial ?? '—'],
    ['Comments', ctx.comments ?? '—'],
  ];
  const html = shell({
    preheader: `${ctx.name} sent their certification form.`,
    heading: 'New certification submission',
    bodyHtml: rows
      .map(([k, v]) => `${label(k)}<p style="margin:0 0 6px;white-space:pre-wrap;">${escapeHtml(v)}</p>`)
      .join('\n'),
    cta: { label: 'Open it in the admin', href: ctx.adminUrl },
    footerNote: 'Internal notification · Songdance',
  });
  const text = [...rows.map(([k, v]) => `${k}: ${v}`), '', ctx.adminUrl].join('\n');
  return { subject: `SD-CERT: ${ctx.name} submitted for certification`, html, text };
}
