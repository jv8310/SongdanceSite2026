import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  getProductBySlug,
  getRegistrationsWithBalanceDue,
} from '../../../../lib/registrations/db';
import { sendBalanceInvite } from '../../../../lib/registrations/balance';

export const prerender = false;

// Resend's default account limit is 2 req/s; pace one send per gap so the
// batch stays under the ceiling (mirrors the intake bulk-send).
const SEND_GAP_MS = 550;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Admin: email every deposit-payer (paid, balance still due) on a retreat a
// Stripe link for their remaining balance.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const productSlug = String(form.get('product_slug') ?? '').trim();
  const returnTo = safeReturnTo(String(form.get('return_to') ?? ''));
  if (!productSlug) return new Response('Missing product_slug', { status: 400 });

  const product = await getProductBySlug(env.DB, productSlug);
  if (!product) return new Response('Unknown product', { status: 404 });

  const rows = await getRegistrationsWithBalanceDue(env.DB, product.id);
  const origin = new URL(request.url).origin;

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    if (i > 0) await sleep(SEND_GAP_MS);
    const result = await sendBalanceInvite(env, rows[i]!, origin);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  const params = new URLSearchParams({
    bal_bulk: '1',
    bal_sent: String(sent),
    bal_failed: String(failed),
  });
  const sep = returnTo.includes('?') ? '&' : '?';
  return new Response(null, {
    status: 302,
    headers: { Location: `${returnTo}${sep}${params.toString()}` },
  });
};

function safeReturnTo(raw: string): string {
  if (raw.startsWith('/admin/') || raw === '/admin') return raw;
  return '/admin';
}
