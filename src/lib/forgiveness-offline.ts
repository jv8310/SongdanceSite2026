// /forgiveness-for-you (the forgiveness prayer lead magnet) is offline while
// it's reworked (October 2026). Everything is kept — the page, the
// ThreeLayersWalk app, both APIs and the Drip tagging — but only a signed-in
// admin can open the page or call its APIs. Everyone else is sent to the
// course page (a 302, so it can come back) and the APIs answer 404.
// Flip this to true to put it back online.
import { readCookie, verifySession } from './registrations/auth';

export const FORGIVENESS_FOR_YOU_ONLINE = false;

export async function forgivenessForYouOpen(request: Request, env: any): Promise<boolean> {
  if (FORGIVENESS_FOR_YOU_ONLINE) return true;
  const secret = env?.ADMIN_SESSION_SECRET ?? import.meta.env.ADMIN_SESSION_SECRET;
  if (!secret) return false;
  return verifySession(secret, readCookie(request));
}
