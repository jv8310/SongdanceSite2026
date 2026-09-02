import { defineMiddleware } from 'astro:middleware';
import {
  looksLikeShareBot,
  normalizeChannel,
  parseShareCookie,
  readShareCookie,
  recordShareVisit,
  SHARE_CHANNEL_PARAM,
  SHARE_COOKIE,
  SHARE_PARAM,
  shareCookieValue,
  verifyShareToken,
} from './lib/workshops/share';

// Referral capture for the "share with a friend" link (src/lib/workshops/share.ts).
//
// It lives here rather than on /workshop and /courses/masterclass because the
// link is public and gets pasted anywhere: whichever page it lands on, the
// friend's arrival is counted once and the referral is remembered for 30 days,
// so the checkout can credit the sale even when they come back days later on a
// URL that carries nothing. Costs one searchParams read on requests without a
// ?ref= — which is all of them but the shared ones.
const SHARE_COOKIE_DAYS = 30;

async function captureReferral(context: Parameters<Parameters<typeof defineMiddleware>[0]>[0]) {
  const token = (context.url.searchParams.get(SHARE_PARAM) ?? '').trim();
  if (!token || context.url.pathname.startsWith('/api/')) return;
  if (context.request.method !== 'GET') return;
  // WhatsApp/Facebook/Telegram fetch a shared URL themselves to build the
  // preview card. Counting those would mean the number goes up when a link is
  // posted, not when someone opens it.
  if (looksLikeShareBot(context.request.headers.get('User-Agent'))) return;

  const env = context.locals.runtime?.env;
  if (!env?.DB || !env.ADMIN_SESSION_SECRET) return;

  const registrationId = await verifyShareToken(env.ADMIN_SESSION_SECRET, token);
  if (!registrationId) return;

  const channel = normalizeChannel(context.url.searchParams.get(SHARE_CHANNEL_PARAM));
  const existing = parseShareCookie(readShareCookie(context.request));
  const value = shareCookieValue(token, channel);

  context.cookies.set(SHARE_COOKIE, value, {
    path: '/',
    maxAge: SHARE_COOKIE_DAYS * 86400,
    sameSite: 'lax',
    secure: true,
    httpOnly: true,
  });

  // Already carrying this exact link? Then this is a reload or a second page on
  // the same visit (?ref= stays in the address bar), not another friend.
  if (existing && existing.token === token && existing.channel === channel) return;

  const visit = recordShareVisit(env.DB, registrationId, channel, context.url.pathname);
  const ctx: any = context.locals.runtime?.ctx;
  if (ctx?.waitUntil) ctx.waitUntil(visit);
  else await visit;
}

// Safety net: an /api/* route must always answer JSON. An unhandled exception
// (a D1 blip, a duplicate-claim insert, anything unforeseen) otherwise becomes
// the platform's HTML/empty error response — and the checkout forms' res.json()
// then shows the customer browser-internal gibberish ("Unexpected end of JSON
// input" in Chrome, "The string did not match the expected pattern." in
// Safari). Pages keep Astro's normal error handling.
export const onRequest = defineMiddleware(async (context, next) => {
  // Never let measurement break a page: a failure here is logged and dropped.
  try {
    await captureReferral(context);
  } catch (err) {
    console.error(`referral capture: ${String(err)}`);
  }
  try {
    return await next();
  } catch (err) {
    if (context.url.pathname.startsWith('/api/')) {
      console.error(
        `API error ${context.request.method} ${context.url.pathname}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      return new Response(
        JSON.stringify({
          error:
            'Something went wrong on our side. Please try again, or email info@songdance.co.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw err;
  }
});
