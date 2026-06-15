// Access gate for the private Somatic Rising investor area (/sr26).
//
// This is a separate project that, for now, borrows the Songdance site's
// admin auth infrastructure: the same ADMIN_PASSWORD unlocks it and the same
// HMAC-signed `sd_admin` session cookie grants access (so an admin session
// also opens /sr26, and vice versa). If the two ever need to part ways, give
// this its own password + cookie — nothing else here would have to change.

import { readCookie, verifySession } from '../registrations/auth';

/** True when the request carries a valid admin/sr26 session cookie. */
export function isSr26Authed(request: Request, env: Env): Promise<boolean> {
  return verifySession(env.ADMIN_SESSION_SECRET, readCookie(request));
}

/** Only allow post-login redirects to stay inside the /sr26 area. */
export function safeNext(next: string | null | undefined): string {
  if (typeof next === 'string' && /^\/sr26(\/|$|\?)/.test(next)) return next;
  return '/sr26';
}
