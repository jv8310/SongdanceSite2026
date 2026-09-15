import { defineMiddleware } from 'astro:middleware';
import {
  getSessionEmail,
  isDocumentNavigation,
  loginUrl,
  nextFromReferer,
  readCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionExpiry,
  shouldRenewSession,
  signSession,
  verifySession,
} from './lib/registrations/auth';
import {
  readCookie as readAdsCookie,
  SESSION_COOKIE as ADS_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS as ADS_SESSION_MAX_AGE_SECONDS,
  sessionExpiry as adsSessionExpiry,
  shouldRenewSession as shouldRenewAdsSession,
  signSession as signAdsSession,
  verifySession as verifyAdsSession,
} from './lib/ads/auth';
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

// Keeping an admin signed in, and keeping their place when a session does lapse.
//
// The admin session is 30 days (src/lib/registrations/auth.ts) and every admin
// *page* handles expiry by redirecting to the login form — but an admin form
// *POST* answers a bare 401, so a button pressed on a tab that has been open
// for weeks ("Mark paid" on a retreat balance, say) lands on a white page
// reading "Unauthorized", with nothing to click and the row you were working
// on lost.
//
// Two halves, both here so no endpoint has to know about either:
//
//   • slideAdminSession — a valid session is re-issued as the admin is used,
//     so the 30 days run from last use rather than from login: a device used
//     at all within a month never has to sign in again. It covers admin page
//     views AND the /api/admin/* calls those pages make, because plenty of
//     admin work (uploading a track, saving an event, sending a broadcast)
//     is fetch() traffic that used to let the clock run down underneath it.
//     The re-sign is throttled to once a day per device (shouldRenewSession),
//     so it isn't a Set-Cookie on every admin response.
//   • loginRedirectForNavigation — a 401 from /api/admin/* that is answering a
//     top-level navigation becomes a redirect to the login form, carrying the
//     page it came from, so signing in lands back where the button was. A
//     fetch()/XHR caller is left alone: its 401 is what its own error handling
//     expects, and a redirect would give it the login HTML instead.

const ADMIN_API_PREFIX = '/api/admin/';

async function slideAdminSession(
  context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
) {
  const path = context.url.pathname;
  const isAdminPage = path === '/admin' || path.startsWith('/admin/');
  const isAdminApi = path.startsWith(ADMIN_API_PREFIX);
  if (!isAdminPage && !isAdminApi) return;
  // The login form and its endpoint issue their own cookie; nothing to slide.
  if (path === '/admin/login' || path === `${ADMIN_API_PREFIX}login`) return;
  // An admin page renews on the navigation that loads it; an admin API call
  // renews whatever its method, since that is the work being done.
  if (isAdminPage && (context.request.method !== 'GET' || !isDocumentNavigation(context.request))) {
    return;
  }

  const secret = context.locals.runtime?.env?.ADMIN_SESSION_SECRET;
  if (!secret) return;
  const cookie = readCookie(context.request);
  if (!(await verifySession(secret, cookie))) return;
  // Still has most of its life left — leave the cookie alone.
  if (!shouldRenewSession(cookie)) return;

  // Re-sign for the same admin, so "signed in as" keeps naming the right
  // person; a legacy subject-less cookie renews as itself.
  const subject = (await getSessionEmail(secret, cookie)) ?? 'admin';
  const token = await signSession(secret, sessionExpiry(), subject);
  context.cookies.set(SESSION_COOKIE, token, {
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}

// The /ads dashboard has its own password gate and its own 30-day cookie
// (src/lib/ads/auth.ts). Slide it the same way, so the ads manager's month
// runs from their last visit rather than from the day they typed the
// password — otherwise a dashboard someone checks weekly still locks them
// out every 30 days for no reason.
async function slideAdsSession(
  context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
) {
  const path = context.url.pathname;
  if (path !== '/ads' && !path.startsWith('/ads/')) return;
  if (path === '/ads/login') return;
  if (context.request.method !== 'GET') return;
  if (!isDocumentNavigation(context.request)) return;

  const secret = context.locals.runtime?.env?.ADMIN_SESSION_SECRET;
  if (!secret) return;
  const cookie = readAdsCookie(context.request);
  if (!(await verifyAdsSession(secret, cookie))) return;
  if (!shouldRenewAdsSession(cookie)) return;

  const token = await signAdsSession(secret, adsSessionExpiry());
  context.cookies.set(ADS_SESSION_COOKIE, token, {
    path: '/',
    maxAge: ADS_SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}

function loginRedirectForNavigation(
  context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
  response: Response,
): Response {
  if (!isDocumentNavigation(context.request)) return response;

  // A form POST to an admin endpoint on a lapsed session: 401 → the login
  // form, carrying the page the form was on.
  if (response.status === 401 && context.url.pathname.startsWith(ADMIN_API_PREFIX)) {
    return new Response(null, {
      status: 302,
      headers: { Location: loginUrl(nextFromReferer(context.request)) },
    });
  }

  // An admin *page* on a lapsed session already redirects to the login form,
  // but every one of them (31 pages) sends you to a bare /admin/login and so
  // loses where you were. Name the destination here instead of in each page.
  if (isRedirect(response.status) && response.headers.get('Location') === '/admin/login') {
    const target = loginUrl(`${context.url.pathname}${context.url.search}`);
    // Only rebuild when there is something to change. Sign-out also redirects
    // to a bare /admin/login and carries the cookie-clearing Set-Cookie, and
    // copying headers through `new Headers` is exactly where a Set-Cookie gets
    // folded into a single comma-joined value — so leave that response alone.
    if (target !== '/admin/login') {
      const headers = new Headers(response.headers);
      headers.set('Location', target);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
  }

  return response;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
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
  // Never let the session slide break a page either.
  try {
    await slideAdminSession(context);
    await slideAdsSession(context);
  } catch (err) {
    console.error(`admin session slide: ${String(err)}`);
  }
  try {
    return loginRedirectForNavigation(context, await next());
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
