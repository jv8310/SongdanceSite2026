// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
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
