// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

// NOTE: redirects for the old (pre-tidy) URLs are handled in the custom worker
// entrypoint (src/worker-entrypoint.ts), not here. Astro's `redirects` config
// normalises trailing slashes away and, for redirects to prerendered pages,
// only emits an exact slashless _redirects rule — so the trailing-slash form of
// an old URL (the directory-format form most inbound links use) would 404. The
// worker matches /old and /old/ uniformly. See that file for the URL map.
export default defineConfig({
  site: 'https://site.songdance.co',
  output: 'static',
  adapter: cloudflare({
    imageService: 'compile',
    // Custom worker entrypoint so the generated worker also exports a
    // `scheduled` handler for the hourly intake-assessment Cron trigger.
    workerEntryPoint: {
      path: './src/worker-entrypoint.ts',
    },
  }),
  integrations: [react()],
});
