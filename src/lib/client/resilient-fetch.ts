// Browser-side resilient POST for the conversion-critical course forms.
//
// The certification "see your price" lookup and the checkout calls used to do a
// bare `fetch()` with no timeout and no retry. On a flaky mobile connection a
// single dropped packet or a stalled request surfaced to the visitor as a hard
// "We could not reach the server" — and they bounced. (The server itself is
// already resilient: the Drip lookup is bounded by its own 8s timeout and falls
// back to the newcomer offer, so a reachable Worker almost always answers.)
//
// This wraps the call so a transient failure is retried a few times with
// backoff, and each attempt is bounded by its own timeout via AbortController
// (used directly rather than `AbortSignal.timeout`, which older mobile Safari
// lacks) — a stalled request aborts and retries instead of hanging until the OS
// kills the socket.
//
// 4xx responses are real answers (validation, a 404, …) and are returned as-is;
// only genuine network failures and 5xx/edge hiccups are retried.

export type ResilientOpts = {
  // Max attempts, including the first. Default 3.
  retries?: number;
  // Per-attempt timeout in ms. Default 12000.
  timeoutMs?: number;
  // Called before each attempt with the 1-based attempt number and the total,
  // so a caller can update a progress indicator (e.g. "Reconnecting…").
  onAttempt?: (attempt: number, total: number) => void;
  // External abort (e.g. the visitor navigated away). When it fires we stop
  // retrying and propagate the abort rather than swallowing it.
  signal?: AbortSignal;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// 600ms → 1200ms → … capped at 3s, with light jitter so concurrent retries
// don't all fire on the same tick.
function backoffMs(attempt: number): number {
  const base = Math.min(600 * 2 ** (attempt - 1), 3000);
  return base + Math.floor(Math.random() * 250);
}

export async function postJsonResilient(
  url: string,
  body: unknown,
  opts: ResilientOpts = {},
): Promise<Response> {
  const total = Math.max(1, opts.retries ?? 3);
  const timeoutMs = opts.timeoutMs ?? 12000;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= total; attempt++) {
    opts.onAttempt?.(attempt, total);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onExternalAbort);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // A 5xx is usually a transient edge/cold-start hiccup — worth another go.
      // Any other status (2xx, 4xx) is a definitive answer; return it.
      if (res.status >= 500 && attempt < total) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(backoffMs(attempt));
        continue;
      }
      return res;
    } catch (err) {
      // A caller-driven abort is final — never retry or swallow it.
      if (opts.signal?.aborted) throw err;
      lastErr = err;
      if (attempt < total) await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastErr ?? new Error('Network request failed');
}
