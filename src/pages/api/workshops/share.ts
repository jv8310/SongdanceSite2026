import type { APIRoute } from 'astro';
import {
  getSharerRegistration,
  normalizeChannel,
  recordShareAction,
  verifyShareToken,
} from '../../../lib/workshops/share';

export const prerender = false;

// A share button was pressed on the countdown page. Called with sendBeacon, so
// the body may arrive as text/plain rather than JSON — parse the text either
// way, and answer 204 for everything: this is measurement, and a sharer must
// never see an error because of it.
//
// The only thing that can be posted here is "registration N pressed the
// <channel> button", and N has to be signed (share.ts) — so the worst a forged
// request can do is inflate one registrant's share count, never touch a seat,
// a price or a payment.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  try {
    const raw = await request.text();
    const body = JSON.parse(raw) as { ref?: string; channel?: string };
    const registrationId = await verifyShareToken(env.ADMIN_SESSION_SECRET, body.ref);
    if (registrationId) {
      const sharer = await getSharerRegistration(env.DB, registrationId);
      if (sharer) {
        await recordShareAction(
          env.DB,
          registrationId,
          sharer.workshop_id,
          normalizeChannel(body.channel),
        );
      }
    }
  } catch (err) {
    console.error(`workshops/share: ${String(err)}`);
  }
  return new Response(null, { status: 204 });
};
