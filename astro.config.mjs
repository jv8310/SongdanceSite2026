// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://site.songdance.co',
  output: 'static',
  // Permanent (301) redirects from the old, inconsistent URLs to the tidied
  // structure: every online programme lives under /courses/, every retreat
  // under /retreats/, and the German workshop under /workshop/. Keeps old
  // links, bookmarks, and ad destinations working. The Cloudflare adapter
  // emits these into the build's _redirects file.
  redirects: {
    '/certification-course': { status: 301, destination: '/courses/certification' },
    '/certification-course/thanks': { status: 301, destination: '/courses/certification/thanks' },
    '/masterclass': { status: 301, destination: '/courses/masterclass' },
    '/forgiveness': { status: 301, destination: '/courses/forgiveness' },
    '/svh-german': { status: 301, destination: '/courses/12-week-de' },
    '/songdeck': { status: 301, destination: '/courses/songdeck' },
    '/ritual-of-belonging': { status: 301, destination: '/retreats/ritual-of-belonging' },
    '/workshop-deutsch': { status: 301, destination: '/workshop/deutsch' },
  },
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
