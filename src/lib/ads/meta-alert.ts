// "Your ad numbers have stopped being true" — the email that makes a broken
// Meta pull impossible to miss.
//
// The sibling of the SD-REPORT digests, and deliberately separate from
// meta-health.ts: the health record is read by two dashboard pages on every
// load, so it must stay free of the email/report machinery imported here.
//
// Why an email at all: the failure mode this guards against is *silence*. When
// the token expired on 2026-09-07, /admin/stats and /ads kept rendering — with
// two days of missing spend and therefore flattering ROAS on every card. The
// daily digest kept arriving with the same understated ad spend. Nothing was
// red anywhere. So the alert goes to the same inbox as the digest, at most once
// a day, and only while something is actually wrong.

import { localHour } from '../workshops/time';
import { sendEmail } from '../workshops/resend';
import { reportRecipients, type ReportEnv } from '../workshops/reports';
import { readMetaAdsHealth, type MetaAdsHealth } from './meta-health';

const BUSINESS_TZ = 'Europe/Brussels';
// An hour before the SD-REPORT digest, so a broken pull is known before the
// numbers it distorts land in the same inbox.
const ALERT_LOCAL_HOUR = 7;
const DEFAULT_BASE_URL = 'https://songdance.co';

export type MetaAlertEnv = ReportEnv & {
  META_AD_ACCOUNT_ID?: string;
  META_ADS_TOKEN?: string;
  META_ACCESS_TOKEN?: string;
};

export type MetaAlertResult = { sent: boolean; level: MetaAdsHealth['level']; reason?: string };

function businessDate(now: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ }).format(new Date(now));
}

// Once per Brussels day, claimed in the events log exactly like the digests.
// Released on a send failure so a later tick in the same day retries.
async function claim(db: D1Database, externalId: string): Promise<boolean> {
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
       VALUES (NULL, 'ads.alert.sent', 'system', ?, 'pending')`,
    )
    .bind(externalId)
    .run();
  return (ins.meta?.changes ?? 0) > 0;
}

async function release(db: D1Database, externalId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM events WHERE external_id = ? AND kind = 'ads.alert.sent'`)
    .bind(externalId)
    .run();
}

/**
 * Called from the hourly cron. Mails the report recipients once a day while the
 * Meta pull is down (or the token is about to expire), and no-ops entirely
 * while it is healthy. Never throws.
 */
export async function runMetaAdsAlert(env: MetaAlertEnv, now = Date.now()): Promise<MetaAlertResult> {
  const configured = Boolean(
    (env.META_AD_ACCOUNT_ID ?? '').trim() && ((env.META_ADS_TOKEN ?? env.META_ACCESS_TOKEN ?? '').trim()),
  );
  if (!configured || !env.RESEND_API_KEY) return { sent: false, level: 'off', reason: 'not_configured' };
  if (localHour(BUSINESS_TZ, now) < ALERT_LOCAL_HOUR) return { sent: false, level: 'ok', reason: 'not_due' };

  let health: MetaAdsHealth;
  try {
    health = await readMetaAdsHealth(env.DB, { configured: true, now });
  } catch {
    return { sent: false, level: 'ok', reason: 'unreadable' };
  }
  if (health.level === 'ok' || health.level === 'off' || !health.headline) {
    return { sent: false, level: health.level, reason: 'healthy' };
  }

  // One alert a day, and a fresh one each day it stays broken — a single email
  // that is never repeated would be forgotten by the afternoon.
  const externalId = `meta-ads-alert-${businessDate(now)}`;
  let claimed = false;
  try {
    claimed = await claim(env.DB, externalId);
  } catch {
    return { sent: false, level: health.level, reason: 'claim_failed' };
  }
  if (!claimed) return { sent: false, level: health.level, reason: 'already_sent' };

  const baseUrl = (env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL.trim()) || DEFAULT_BASE_URL;
  const content = buildMetaAlertEmail(health, baseUrl);
  try {
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      to: reportRecipients(env),
      replyTo: env.RESEND_REPLY_TO,
      subject: content.subject,
      html: content.html,
      text: content.text,
      entityRefId: externalId,
    });
    return { sent: true, level: health.level };
  } catch (err) {
    await release(env.DB, externalId).catch(() => {});
    return { sent: false, level: health.level, reason: `send_failed: ${String(err)}` };
  }
}

// ── The words ───────────────────────────────────────────────────────────────
// Internal ops mail, so plain and specific: what stopped, since when, what it
// does to the figures, and the exact fix.

export function buildMetaAlertEmail(
  health: MetaAdsHealth,
  baseUrl = DEFAULT_BASE_URL,
): { subject: string; html: string; text: string } {
  const down = health.level === 'down';
  const subject = down
    ? 'SD-ALERT: Meta ad spend has stopped updating'
    : 'SD-ALERT: the Meta ads token needs rotating';
  const since = health.lastOkAt
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZone: BUSINESS_TZ,
      }).format(new Date(health.lastOkAt))
    : 'never';

  const consequence = down
    ? 'Until it is fixed, every ROAS, cost-per-registration and “net after ads” figure on /admin/stats, /ads and the daily SD-REPORT is computed against ad spend that stopped growing — so they all read better than they are.'
    : 'Nothing is wrong yet. When the token expires the ad-spend pull stops, and the figures start reading better than they are.';

  const lines = [
    health.headline ?? '',
    '',
    `Last successful pull: ${since}.`,
    health.error ? `Meta said: ${health.error.message}` : '',
    '',
    consequence,
    '',
    health.action ? `Fix: ${health.action}` : '',
    '',
    `${baseUrl}/admin/stats#ad-spend`,
  ].filter((l) => l !== undefined);

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#241c12;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6ded2;border-radius:12px;overflow:hidden;">
    <div style="background:${down ? '#8c2f1d' : '#8a6a1f'};color:#fff;padding:16px 20px;font-weight:600;font-size:15px;">
      ${down ? 'Meta ad spend has stopped updating' : 'The Meta ads token needs rotating'}
    </div>
    <div style="padding:20px;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 14px;"><strong>${escapeHtml(health.headline ?? '')}</strong></p>
      <p style="margin:0 0 14px;">Last successful pull: <strong>${escapeHtml(since)}</strong>.</p>
      ${health.error ? `<p style="margin:0 0 14px;color:#6b5c49;">Meta said: <code style="font-size:12px;">${escapeHtml(health.error.message)}</code></p>` : ''}
      <p style="margin:0 0 14px;">${escapeHtml(consequence)}</p>
      ${health.action ? `<p style="margin:0 0 18px;padding:12px 14px;background:#f6f2ec;border-radius:8px;">${escapeHtml(health.action)}</p>` : ''}
      <p style="margin:0;"><a href="${baseUrl}/admin/stats" style="color:#8c2f1d;font-weight:600;">Open the ad-spend panel →</a></p>
    </div>
  </div>
</body></html>`;

  return { subject, html, text: lines.join('\n') };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Sample for the /admin/emails preview + test-send, so this alert is reviewed
// like every other email rather than first seen on the day it fires.
export function sampleMetaAlertHealth(): MetaAdsHealth {
  return {
    level: 'down',
    configured: true,
    lastOkAt: '2026-09-07T04:12:00.000Z',
    staleHours: 44,
    error: {
      at: '2026-09-09T04:10:00.000Z',
      kind: 'token',
      message:
        'Meta Insights: 400 The token has expired on Monday, 07-Sep-26 23:54:40 PDT. ' +
        'The current time is Wednesday, 09-Sep-26 00:50:48 PDT. (code 190)',
    },
    tokenExpiresAt: '2026-09-07T00:00:00.000Z',
    tokenNeverExpires: false,
    daysToExpiry: -2,
    headline: 'Meta ad spend has stopped updating — the access token expired on 7 Sept 2026.',
    action:
      'Create a System User token in Meta Business Settings (System users → your user → ' +
      'Generate new token → the ad account\u2019s app → permission ads_read → Token expiration: Never), ' +
      'then set it: wrangler secret put META_ADS_TOKEN — and press \u201cPull from Meta now\u201d to confirm.',
  };
}
