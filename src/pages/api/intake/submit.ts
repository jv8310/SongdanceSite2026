import type { APIRoute } from 'astro';
import {
  resolveEventWithDb,
  isKnownEventWithDb,
} from '../../../lib/intake/events';
import { STEPS } from '../../../lib/intake/steps';
import type { Locale } from '../../../lib/intake/copy';
import { buildAssessorUserMessage, runAssessment } from '../../../lib/intake/assess';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASSESSOR_RECIPIENT = 'jacob@songdance.co';
const DEFAULT_FROM = 'Songdance <prayer@mail.songdance.co>';

interface SubmitBody {
  eventCode?: string;
  locale?: string;
  answers?: Record<string, unknown>;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAssessorEmailHtml(args: {
  classification: string;
  eventLabel: string;
  participantName: string;
  participantEmail: string;
  assessmentMd: string;
  rawAnswersText: string;
}): string {
  const colour = (() => {
    switch (args.classification) {
      case 'RED FLAG': return '#A14826';
      case 'FURTHER INVESTIGATION NEEDED': return '#C9603A';
      case 'NEEDS A CALL': return '#5C6A4A';
      case 'VEILIG': return '#3F4A30';
      default: return '#4A3848';
    }
  })();
  const subject = `Intake assessment — ${args.eventLabel} — ${args.participantName}`;
  void subject;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>Intake assessment</title></head>
<body style="margin:0;padding:0;background:#F4ECDF;font-family:Georgia,serif;color:#2A1B2A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4ECDF;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="background:#FAF5EA;border-radius:14px;">
      <tr><td style="padding:28px 32px 8px;">
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#7A6A78;">
          Intake assessment
        </div>
        <h1 style="margin:8px 0 0;font-family:Georgia,serif;font-weight:400;font-size:24px;line-height:1.2;color:#2A1B2A;">
          ${escapeHtml(args.eventLabel)}
        </h1>
        <div style="margin-top:14px;display:inline-block;padding:6px 14px;border-radius:999px;background:${colour};color:#F4ECDF;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.16em;text-transform:uppercase;">
          ${escapeHtml(args.classification)}
        </div>
        <p style="margin:14px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#4A3848;">
          <strong>${escapeHtml(args.participantName)}</strong> &nbsp;·&nbsp; <a href="mailto:${escapeHtml(args.participantEmail)}" style="color:#A14826;">${escapeHtml(args.participantEmail)}</a>
        </p>
      </td></tr>
      <tr><td style="padding:8px 32px 24px;">
        <hr style="border:none;border-top:1px solid rgba(42,27,42,0.14);margin:18px 0;" />
        <div style="font-family:Georgia,serif;font-size:15px;line-height:1.65;color:#2A1B2A;white-space:pre-wrap;">${escapeHtml(args.assessmentMd)}</div>
      </td></tr>
      <tr><td style="padding:8px 32px 32px;">
        <details>
          <summary style="cursor:pointer;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#7A6A78;">
            Volledige antwoorden
          </summary>
          <pre style="margin:14px 0 0;font-family:ui-monospace,monospace;font-size:12px;line-height:1.55;color:#2A1B2A;white-space:pre-wrap;background:#F4ECDF;padding:14px 16px;border-radius:8px;">${escapeHtml(args.rawAnswersText)}</pre>
        </details>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function renderAssessorEmailText(args: {
  classification: string;
  eventLabel: string;
  participantName: string;
  participantEmail: string;
  assessmentMd: string;
  rawAnswersText: string;
}): string {
  return [
    `Intake assessment — ${args.eventLabel}`,
    `Classificatie: ${args.classification}`,
    `Deelnemer: ${args.participantName} <${args.participantEmail}>`,
    '',
    '---',
    '',
    args.assessmentMd,
    '',
    '---',
    'Volledige antwoorden:',
    '',
    args.rawAnswersText,
  ].join('\n');
}

function renderConfirmationEmail(args: {
  locale: Locale;
  participantName: string;
  eventLabel: string;
}): { subject: string; html: string; text: string } {
  const isNl = args.locale === 'nl';
  const subject = isNl
    ? `Aangekomen — intake ${args.eventLabel}`
    : `Arrived — intake ${args.eventLabel}`;

  const greeting = isNl
    ? `Beste ${args.participantName},`
    : `Dear ${args.participantName},`;

  const body = isNl
    ? `Dank je voor het invullen van de intake voor ${args.eventLabel}.

Ik kijk ernaar uit je te ontmoeten tijdens de retreat.

Met warme groet,
Jacob`
    : `Thank you for completing the intake for ${args.eventLabel}.

I'm looking forward to meeting you during the retreat.

With warmth,
Jacob`;

  const text = `${greeting}\n\n${body}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F4ECDF;font-family:Georgia,serif;color:#2A1B2A;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td align="center" style="padding:48px 16px;">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:24px 8px;">
        <p style="margin:0;font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#2A1B2A;">${escapeHtml(greeting)}</p>
        <p style="margin:18px 0 0;font-family:Georgia,serif;font-size:16px;line-height:1.7;color:#2A1B2A;white-space:pre-line;">${escapeHtml(body)}</p>
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

async function sendEmail(args: {
  apiKey: string;
  from: string;
  to: string;
  replyTo?: string;
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
        headers: {
          'Auto-Submitted': 'auto-generated',
          'X-Entity-Ref-ID': `intake-${Date.now()}`,
        },
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

function genUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return json(400, { ok: false, error: 'bad-json' });
  }

  const eventCode = (body.eventCode ?? '').toString().trim();
  const locale: Locale = body.locale === 'en' ? 'en' : 'nl';
  const answers = body.answers ?? {};

  if (!eventCode) {
    return json(400, { ok: false, error: 'unknown-event' });
  }
  if (typeof answers !== 'object' || answers === null) {
    return json(400, { ok: false, error: 'bad-answers' });
  }

  const fullName = (answers.full_name ?? '').toString().trim().slice(0, 120);
  const email = (answers.email ?? '').toString().trim().slice(0, 254);
  if (!fullName) return json(400, { ok: false, error: 'missing-name' });
  if (!EMAIL_RE.test(email)) return json(400, { ok: false, error: 'bad-email' });

  // Required steps must be present.
  for (const step of STEPS) {
    if (!step.required) continue;
    const v = answers[step.key];
    if (step.type === 'consent') {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return json(400, { ok: false, error: `missing-${step.key}` });
      }
      const map = v as Record<string, boolean>;
      if (!(step.consentKeys ?? []).every((k) => map[k] === true)) {
        return json(400, { ok: false, error: 'consent-incomplete' });
      }
    } else if (step.type === 'checkboxes') {
      if (!Array.isArray(v) || v.length === 0) {
        return json(400, { ok: false, error: `missing-${step.key}` });
      }
    } else if (typeof v !== 'string' || v.trim() === '') {
      return json(400, { ok: false, error: `missing-${step.key}` });
    }
  }

  const runtime = (locals as {
    runtime?: {
      env?: Record<string, string | undefined>;
      ctx?: { waitUntil?: (p: Promise<unknown>) => void };
    };
  }).runtime;
  const cfEnv = runtime?.env;

  const db = (cfEnv as unknown as { DB?: D1Database } | undefined)?.DB
    ?? (locals as unknown as { runtime?: { env?: { DB?: D1Database } } }).runtime?.env?.DB;

  if (!(await isKnownEventWithDb(db, eventCode))) {
    return json(400, { ok: false, error: 'unknown-event' });
  }

  const event = await resolveEventWithDb(db, eventCode);
  const eventLabel = event.label[locale];

  const anthropicKey = cfEnv?.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;
  const resendKey = cfEnv?.RESEND_API_KEY ?? import.meta.env.RESEND_API_KEY;
  const from = cfEnv?.RESEND_FROM ?? import.meta.env.RESEND_FROM ?? DEFAULT_FROM;

  const id = genUuid();
  const userAgent = request.headers.get('user-agent') ?? '';
  const ip = clientAddress ?? '';

  // Persist the raw submission first — even if Claude or Resend later
  // fail, we don't lose the deelnemer's answers.
  if (db) {
    try {
      await db
        .prepare(
          `INSERT INTO intake_submissions
           (id, event_code, locale, email, full_name, payload_json, ip, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          eventCode,
          locale,
          email,
          fullName,
          JSON.stringify(answers),
          ip,
          userAgent,
        )
        .run();
    } catch (err) {
      console.error('[intake/submit] D1 insert failed', err);
      // Don't bail — we still want Jacob to receive the email.
    }
  } else {
    console.warn('[intake/submit] D1 binding missing — skipping persistence');
  }

  // ---------- Background work: Claude assessment + emails ----------
  // The deelnemer doesn't need to wait for any of this. We acknowledge
  // the submission as soon as the row is persisted; Claude (which can
  // take 30–90s) and Resend run in the background via ctx.waitUntil.
  const rawAnswersText = buildAssessorUserMessage({ event, locale, answers });

  const finishInBackground = async () => {
    const assessmentResult = await runAssessment({
      apiKey: anthropicKey,
      userMessage: rawAnswersText,
    });
    const assessmentMd = assessmentResult.markdown;
    const classification = assessmentResult.classification;
    const assessmentError = assessmentResult.error;
    if (assessmentError) {
      console.warn('[intake/submit] claude error:', assessmentError);
    }

    if (db) {
      try {
        await db
          .prepare(
            `UPDATE intake_submissions
             SET assessment_md = ?, classification = ?, assessment_error = ?
             WHERE id = ?`,
          )
          .bind(assessmentMd || null, classification, assessmentError, id)
          .run();
      } catch (err) {
        console.error('[intake/submit] D1 update failed', err);
      }
    }

    if (!resendKey) {
      console.warn('[intake/submit] RESEND_API_KEY missing — skipping emails');
      return;
    }

    const displayClass = classification ?? (assessmentError ? 'GEEN ASSESSMENT' : 'ONBEKEND');
    const assessmentForEmail =
      assessmentMd ||
      `Geen automatisch assessment beschikbaar (reden: ${assessmentError ?? 'onbekend'}).\nLees onderaan de antwoorden zelf.`;
    const subject = `Intake [${displayClass}] — ${eventLabel} — ${fullName}`;
    const assessorHtml = renderAssessorEmailHtml({
      classification: displayClass,
      eventLabel,
      participantName: fullName,
      participantEmail: email,
      assessmentMd: assessmentForEmail,
      rawAnswersText,
    });
    const assessorText = renderAssessorEmailText({
      classification: displayClass,
      eventLabel,
      participantName: fullName,
      participantEmail: email,
      assessmentMd: assessmentForEmail,
      rawAnswersText,
    });

    const conf = renderConfirmationEmail({ locale, participantName: fullName, eventLabel });

    const [assessorResult, participantResult] = await Promise.allSettled([
      sendEmail({
        apiKey: resendKey,
        from,
        to: ASSESSOR_RECIPIENT,
        replyTo: email,
        subject,
        html: assessorHtml,
        text: assessorText,
      }),
      sendEmail({
        apiKey: resendKey,
        from,
        to: email,
        replyTo: ASSESSOR_RECIPIENT,
        subject: conf.subject,
        html: conf.html,
        text: conf.text,
      }),
    ]);
    if (assessorResult.status === 'fulfilled' && !assessorResult.value.ok) {
      console.warn('[intake/submit] assessor email failed:', assessorResult.value.error);
    }
    if (participantResult.status === 'fulfilled' && !participantResult.value.ok) {
      console.warn('[intake/submit] confirmation email failed:', participantResult.value.error);
    }
  };

  if (runtime?.ctx?.waitUntil) {
    runtime.ctx.waitUntil(finishInBackground());
  } else {
    // Dev / no-worker context: run inline so the work still happens.
    await finishInBackground();
  }

  return json(200, { ok: true, id });
};
