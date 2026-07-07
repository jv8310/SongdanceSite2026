// Custom Cloudflare worker entrypoint.
//
// Astro's Cloudflare adapter normally uses its own
// `@astrojs/cloudflare/entrypoints/server.js`, which exports a worker
// with only a `fetch` handler. We wrap it so the generated worker also
// exposes a `scheduled` handler — that's what the hourly Cron trigger
// (see `triggers.crons` in wrangler.jsonc) invokes to assess any intake
// submissions that never got classified.
//
// Wired up via `adapter: cloudflare({ workerEntryPoint: { path } })` in
// astro.config.mjs. The adapter calls `createExports(manifest)` at
// worker init and uses the `default` export as the worker object.

import { createExports as baseCreateExports } from '@astrojs/cloudflare/entrypoints/server.js';
import { assessPendingSubmissions } from './lib/intake/sweep';
import { runWorkshopCron } from './lib/workshops/cron';
import { runBroadcasts } from './lib/broadcasts/cron';
import { runDripOrderBackfill } from './lib/orders/drip-backfill';
import { runMasterclassSeatMove } from './lib/workshops/masterclass-move';
import { runReports } from './lib/workshops/reports';
import { reconcileOrderNotifications } from './lib/orders/reconcile';
import { fxRatesStale, refreshFxRates } from './lib/admin/fx';

const WORKSHOP_CRON = '*/5 * * * *';

// Permanent (301) redirects from the old, inconsistent URLs to the tidied
// structure (June 2026): every online programme lives under /courses/, every
// retreat under /retreats/, and the German workshop under /workshop/. Keeps old
// links, bookmarks, and ad destinations working.
//
// Handled here rather than via Astro's `redirects` config: that config collapses
// the trailing slash and, for redirects whose destination is a prerendered page,
// only emits an exact slashless _redirects rule — so /old/ (the directory-format
// form most inbound links use) would fall through to the worker and 404. Matching
// here covers both /old and /old/ in one place.
const MOVED_URLS: Record<string, string> = {
  '/certification-course': '/courses/certification',
  '/certification-course/thanks': '/courses/certification/thanks',
  '/masterclass': '/courses/masterclass',
  '/forgiveness': '/courses/forgiveness',
  '/svh-german': '/courses/12-week-de',
  '/songdeck': '/courses/songdeck',
  '/ritual-of-belonging': '/retreats/ritual-of-belonging',
  '/dolphin-retreat': '/retreats/dolphin-and-sound',
  '/workshop-deutsch': '/workshop/deutsch',
};

// Canonical host for the site (June 2026 move off the site.* subdomain). The
// app now lives at the apex songdance.co; the old app host and the www. host
// redirect to it, preserving the full path + query so every old deep link,
// bookmark, and ad destination keeps working. Only fires for those exact hosts
// — the apex itself, *.workers.dev preview URLs, and localhost fall straight
// through.
//
// 308 (not 301) so the method AND body survive the hop: a form POST from a
// stale tab still open on the old host (e.g. the certification email check)
// replays intact to the apex instead of being downgraded to a bodyless GET,
// which previously surfaced as a spurious "server error" on the page.
const CANONICAL_HOST = 'songdance.co';
const LEGACY_HOSTS = new Set(['site.songdance.co', 'www.songdance.co']);

// Paths that must be served on the legacy host rather than redirected to the
// apex. A *prerendered* page (e.g. /access, the retreat landing pages) is served
// straight from Cloudflare's static-asset layer WITHOUT invoking this worker, so
// on www./site. it loads without ever getting the host redirect. Its in-page
// fetch()/XHR calls to /api/* then DO reach the worker (they aren't static
// assets) — and a 308 to the apex turns that same-origin call into a cross-origin
// one, which the browser's CORS/preflight rules block. That surfaces as
// "That didn't go through" on /access and dead checkout buttons on the retreat
// pages. Serving these on the legacy host (same worker, same D1/R2) lets the call
// succeed same-origin; checkout success/cancel URLs are built from
// PUBLIC_BASE_URL, so the visitor still lands back on the apex afterwards. Page
// navigations keep redirecting to the apex below. (The complete fix is a
// zone-level redirect rule that never serves the legacy host at all; this keeps
// every form working until then, and is a harmless belt-and-suspenders after.)
const HOST_REDIRECT_EXEMPT = ['/api/', '/media/'];

function hostRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (!LEGACY_HOSTS.has(url.hostname)) return null;
  if (HOST_REDIRECT_EXEMPT.some((p) => url.pathname.startsWith(p))) return null;
  url.hostname = CANONICAL_HOST;
  return Response.redirect(url.toString(), 308);
}

// If the request path is a moved URL (with or without a trailing slash), return
// a 301 to its new home, preserving any query string. Otherwise null.
function movedRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  // Normalise a trailing slash for lookup, but never the bare root.
  const path =
    url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const destination = MOVED_URLS[path];
  if (!destination) return null;
  const target = new URL(destination, url.origin);
  target.search = url.search;
  return Response.redirect(target.toString(), 301);
}

export function createExports(manifest: unknown) {
  const base = baseCreateExports(manifest as never) as {
    default: { fetch: ExportedHandlerFetchHandler };
  };

  const scheduled: ExportedHandlerScheduledHandler<Env> = (event, env, ctx) => {
    // Dispatch by cron string (see wrangler.jsonc triggers). The 5-minute
    // trigger drives the workshop reminder cadence + post-workshop emails;
    // the hourly trigger keeps sweeping unassessed intake submissions.
    if (event.cron === WORKSHOP_CRON) {
      ctx.waitUntil(
        runWorkshopCron(env)
          .then((r) => {
            console.log(
              `[workshops/cron] reminders=${r.remindersSent} abandoned=${r.abandonedSent} course_abandoned=${r.courseAbandonedSent} post=${r.postSent} no_shows=${r.noShowsMarked} briefings=${r.briefingsSent}`,
            );
          })
          .catch((err) => {
            console.error('[workshops/cron] run failed', err);
          }),
      );
      // Drain any in-flight marketing broadcast on the same tick — paced, held
      // to each recipient's local window, auto-paused on bounce/complaint spikes.
      ctx.waitUntil(
        runBroadcasts(env)
          .then((r) => {
            if (r.sent || r.paused || r.done) {
              console.log(`[broadcasts/cron] sent=${r.sent} paused=${r.paused} done=${r.done}`);
            }
          })
          .catch((err) => {
            console.error('[broadcasts/cron] run failed', err);
          }),
      );
      // One-shot historical Drip order backfill (gated by DRIP_BACKFILL_ENABLED).
      // No-ops entirely until the owner turns it on; self-stops when drained.
      ctx.waitUntil(
        runDripOrderBackfill(env)
          .then((r) => {
            if (!r.skipped && (r.sent || r.failed)) {
              console.log(`[drip/backfill] sent=${r.sent} failed=${r.failed} remaining=${r.remaining}`);
            }
          })
          .catch((err) => {
            console.error('[drip/backfill] run failed', err);
          }),
      );
      // One-shot masterclass seat move (gated by MASTERCLASS_MOVE_ENABLED):
      // move secured seats from masterclass-4 onto masterclass-5 and email each
      // person their seat has moved. No-ops entirely until enabled; self-stops
      // once the seeded queue (migration 0059) is drained.
      ctx.waitUntil(
        runMasterclassSeatMove(env)
          .then((r) => {
            if (!r.skipped && (r.moved || r.failed || r.noop)) {
              console.log(
                `[masterclass/move] moved=${r.moved} noop=${r.noop} failed=${r.failed} remaining=${r.remaining}`,
              );
            }
          })
          .catch((err) => {
            console.error('[masterclass/move] run failed', err);
          }),
      );
      return;
    }

    ctx.waitUntil(
      assessPendingSubmissions({
        db: env.DB,
        apiKey: env.ANTHROPIC_API_KEY,
      })
        .then((r) => {
          console.log(
            `[intake/sweep] cron run — found ${r.found}, assessed ${r.assessed}, failed ${r.failed}, skipped ${r.skipped}`,
          );
        })
        .catch((err) => {
          console.error('[intake/sweep] cron run failed', err);
        }),
    );

    // Daily FX refresh for the order overview's EUR net column. Riding the
    // hourly trigger and guarded by staleness, so it actually hits the ECB
    // (via frankfurter.app) about once a day.
    ctx.waitUntil(
      fxRatesStale(env.DB)
        .then((stale) =>
          stale
            ? refreshFxRates(env.DB).then((r) =>
                console.log(`[fx] refreshed ${r.updated} rates`),
              )
            : undefined,
        )
        .catch((err) => {
          console.error('[fx] refresh failed', err);
        }),
    );

    // Internal "SD-REPORT" digests: a daily registrations/sales/bumps snapshot
    // every morning, plus a weekly one on Tuesdays. Rides the hourly trigger and
    // self-gates to the first tick at/after 08:00 Brussels; idempotent per day.
    ctx.waitUntil(
      runReports(env)
        .then((r) => {
          if (r.daily || r.weekly) {
            console.log(`[reports] daily=${r.daily} weekly=${r.weekly}`);
          }
        })
        .catch((err) => {
          console.error('[reports] run failed', err);
        }),
    );

    // Safety net: re-send any internal SD-ORDER notification (course/retreat)
    // that never went out in the last week. Bounded + idempotent, so a steady
    // state finds nothing; catches a webhook/Resend blip that dropped one.
    ctx.waitUntil(
      reconcileOrderNotifications(env)
        .then((r) => {
          if (r.course || r.retreat) {
            console.log(`[orders/reconcile] resent course=${r.course} retreat=${r.retreat}`);
          }
        })
        .catch((err) => {
          console.error('[orders/reconcile] run failed', err);
        }),
    );
  };

  const fetch: ExportedHandlerFetchHandler<Env> = (request, env, ctx) => {
    // Canonicalise the host first (old site.* / www. → apex), then the old
    // per-path redirects, then hand off to the Astro-generated worker.
    const hostRedir = hostRedirect(request as Request);
    if (hostRedir) return hostRedir;
    const redirect = movedRedirect(request as Request);
    if (redirect) return redirect;
    return base.default.fetch(request, env, ctx);
  };

  return {
    default: {
      fetch,
      scheduled,
    },
  };
}
