// /api/countdown.gif?ends=<epoch-ms>[&frames=60]
//
// An animated countdown to a deadline, rendered live as a tiny GIF (the encoder
// lives in src/lib/email/countdown-gif.ts — dependency-free, self-hosted). Used
// as the hero of the last-chance post-workshop email: the participant-discount
// window is real and at most 48h, so the clock fits HH:MM:SS and the animation
// ticks honestly down from the time remaining when the image is fetched.
//
// Caveats by design: email image proxies (notably Gmail) cache the first fetch,
// so the clock may freeze near its fetch-time value — which is why the email
// also states the deadline in words. We send no-store headers to discourage
// caching, clamp the inputs, and keep the work bounded.

import type { APIRoute } from 'astro';
import { countdownGif } from '../../lib/email/countdown-gif';

export const prerender = false;

const MAX_FRAMES = 90; // bounds the per-request work
const MAX_AHEAD_MS = 60 * 24 * 60 * 60 * 1000; // ignore deadlines >60d out (clock caps at 48h anyway)

export const GET: APIRoute = async ({ url }) => {
  const endsRaw = url.searchParams.get('ends');
  const ends = endsRaw ? Number(endsRaw) : NaN;
  const now = Date.now();

  // A sane, present-ish deadline. Anything missing/absurd → render a finished
  // clock rather than erroring, so the email never shows a broken image.
  const deadlineMs =
    Number.isFinite(ends) && ends > 0 && ends < now + MAX_AHEAD_MS ? ends : now;

  const framesRaw = url.searchParams.get('frames');
  const framesNum = framesRaw ? parseInt(framesRaw, 10) : NaN;
  const frames = Number.isFinite(framesNum)
    ? Math.min(MAX_FRAMES, Math.max(1, framesNum))
    : 60;

  const bytes = countdownGif({ deadlineMs, nowMs: now, frames });

  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      // Countdowns must not be cached — they change every second. (Image proxies
      // may ignore this, hence the deadline is also in the email text.)
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'Content-Length': String(bytes.byteLength),
    },
  });
};
