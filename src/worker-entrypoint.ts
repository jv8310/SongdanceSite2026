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
  '/workshop-deutsch': '/workshop/deutsch',
};

// Canonical host for the site (June 2026 move off the site.* subdomain). The
// app now lives at the apex songdance.co; the old app host and the www. host
// 301 to it, preserving the full path + query so every old deep link, bookmark,
// and ad destination keeps working. Only fires for those exact hosts — the apex
// itself, *.workers.dev preview URLs, and localhost fall straight through.
const CANONICAL_HOST = 'songdance.co';
const LEGACY_HOSTS = new Set(['site.songdance.co', 'www.songdance.co']);

function hostRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (!LEGACY_HOSTS.has(url.hostname)) return null;
  url.hostname = CANONICAL_HOST;
  return Response.redirect(url.toString(), 301);
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
              `[workshops/cron] reminders=${r.remindersSent} abandoned=${r.abandonedSent} post=${r.postSent} no_shows=${r.noShowsMarked}`,
            );
          })
          .catch((err) => {
            console.error('[workshops/cron] run failed', err);
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
