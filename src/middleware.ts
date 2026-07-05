import { defineMiddleware } from 'astro:middleware';

// Safety net: an /api/* route must always answer JSON. An unhandled exception
// (a D1 blip, a duplicate-claim insert, anything unforeseen) otherwise becomes
// the platform's HTML/empty error response — and the checkout forms' res.json()
// then shows the customer browser-internal gibberish ("Unexpected end of JSON
// input" in Chrome, "The string did not match the expected pattern." in
// Safari). Pages keep Astro's normal error handling.
export const onRequest = defineMiddleware(async (context, next) => {
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
