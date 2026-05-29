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

export function createExports(manifest: unknown) {
  const base = baseCreateExports(manifest as never) as {
    default: { fetch: ExportedHandlerFetchHandler };
  };

  const scheduled: ExportedHandlerScheduledHandler<Env> = (_event, env, ctx) => {
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
  };

  return {
    default: {
      fetch: base.default.fetch,
      scheduled,
    },
  };
}
