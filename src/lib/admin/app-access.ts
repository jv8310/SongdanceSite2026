// App access — the member app's courses, Circle seats and host spaces for one
// person, read and changed from their People page (/admin/people/<email>,
// "App access"). The app (songdance-app, Worker `songdance-app-api`) owns all
// of it: this site never reads or writes the app's `app_*` tables itself. It
// asks the app through a service binding (APP_ADMIN in wrangler.jsonc →
// entrypoint SiteAdmin), which is reachable only from Workers on this
// Cloudflare account — the binding is the credential, there is no secret.
//
// Every change runs through the same code as the app's own admin tools and is
// written to the app's audit log as `site:<the admin's sign-in email>`.
// Answers are plain data ({ ok, data } | { ok, error, message }); a binding
// that is missing (local `astro dev`) or an app that does not answer yet (the
// site deployed before the app's entrypoint) reads as "not connected", never
// as a 500 on the People page.

export type AppCourseState = 'active' | 'waiting-activation' | 'starts-later' | 'ended' | 'revoked';

export type AppCourse = {
  id: string;
  product: string;
  label: string;
  email: string;
  source: string;
  state: AppCourseState;
  startsAt: string | null;
  activatedAt: string | null;
  activateChoice: string | null;
  endsAt: string | null;
  graceUntil: string | null;
  liveUntil: string | null;
  liveSetByAdmin?: string | null; // the last day of the live sessions an admin set (extra time)
  hasLiveWindow?: boolean;        // the 12-week / certification course: its live sessions run out
  revokedAt: string | null;
  revokeReason: string | null;
  note: string | null;
  by: string | null;
  isCertification: boolean;
};

export type AppMemberAccess = {
  email: string;
  account: { name: string | null; role: string; createdAt: string; lastSeenAt: string | null } | null;
  linkedEmails: string[];
  courses: AppCourse[];
  spaceSeats: Array<{ spaceKey: string; title: string; source: string; grantedBy: string | null; createdAt: string }>;
  hostSpaces: Array<{ spaceKey: string; title: string }>;
  catalogue: {
    products: Array<{ key: string; label: string }>;
    spaces: Array<{ key: string; title: string; audience: string; archived: boolean }>;
  };
};

export type AppAnswer<T> = { ok: true; data: T } | { ok: false; error: string; message: string };

type DateField = string | null | undefined;

// The methods the app's SiteAdmin entrypoint offers (apps/api/src/site-admin-entrypoint.ts).
export type AppAdminBinding = {
  member(input: { email: string }): Promise<AppAnswer<AppMemberAccess>>;
  grantCourse(input: { email: string; product: string; startsAt?: string; endsAt?: string; liveMonths?: number; note: string; actor: string }): Promise<AppAnswer<AppCourse>>;
  revokeCourse(input: { email: string; entitlementId: string; reason: string; actor: string }): Promise<AppAnswer<AppCourse>>;
  setCourseDates(input: { email: string; entitlementId: string; startsAt?: DateField; activatedAt?: DateField; endsAt?: DateField; liveUntil?: DateField; actor: string }): Promise<AppAnswer<AppCourse>>;
  extendCourse(input: { email: string; entitlementId: string; months: number; actor: string }): Promise<AppAnswer<AppCourse>>;
  revokeOrder(input: { email: string; courseRegistrationId: number; reason: string; actor: string }): Promise<AppAnswer<{ revoked: AppCourse[] }>>;
  seatInSpace(input: { email: string; spaceKey: string; note: string; actor: string }): Promise<AppAnswer<{ created: boolean; hasAccount: boolean }>>;
  unseatFromSpace(input: { email: string; spaceKey: string; reason: string; actor: string }): Promise<AppAnswer<{ revoked: number }>>;
  addHost(input: { email: string; spaceKey: string; actor: string }): Promise<AppAnswer<{ role: string }>>;
  removeHost(input: { email: string; spaceKey: string; actor: string }): Promise<AppAnswer<{ removed: boolean }>>;
};

export const APP_NOT_CONNECTED =
  'The member app does not answer here. On songdance.co this means the app has not been deployed with its SiteAdmin entrypoint yet; in local development there is no app to ask.';

export function appAdmin(env: { APP_ADMIN?: unknown }): AppAdminBinding | null {
  return (env.APP_ADMIN as AppAdminBinding | undefined) ?? null;
}

// One call to the app, with a missing binding and a failing call both turned
// into an answer the page can print.
export async function askApp<T>(
  env: { APP_ADMIN?: unknown },
  call: (app: AppAdminBinding) => Promise<AppAnswer<T>>,
): Promise<AppAnswer<T>> {
  const app = appAdmin(env);
  if (!app) return { ok: false, error: 'not-connected', message: APP_NOT_CONNECTED };
  try {
    return await call(app);
  } catch (err) {
    console.error('[app-access] the app did not answer', err);
    return { ok: false, error: 'not-connected', message: APP_NOT_CONNECTED };
  }
}

export const STATE_LABEL: Record<AppCourseState, string> = {
  active: 'open',
  'waiting-activation': 'waiting for activation',
  'starts-later': 'starts later',
  ended: 'ended',
  revoked: 'revoked',
};

// The site's pill colours: paid = open, pending = waiting, cancelled = closed.
export const STATE_PILL: Record<AppCourseState, string> = {
  active: 'paid',
  'waiting-activation': 'pending',
  'starts-later': 'pending',
  ended: 'cancelled',
  revoked: 'cancelled',
};

export function sourceLabel(source: string): string {
  if (source === 'site-order') return 'Order on songdance.co';
  if (source === 'workshop-order') return 'Bought with a workshop seat';
  if (source === 'drip') return 'Drip tag (bought before the site)';
  if (source === 'admin') return 'Added by hand';
  if (source === 'import') return 'Brought over from Mighty';
  return source;
}

// Who did it, without the 'site:' / 'mcp:' prefix the app's audit log keeps.
export function actorLabel(actor: string | null): string | null {
  if (!actor) return null;
  if (actor.startsWith('site:')) return actor.slice(5);
  if (actor.startsWith('mcp:')) return 'Claude (MCP)';
  if (actor === 'import') return 'the Mighty import';
  return 'an app admin';
}

// The day part of a stored instant, for <input type="date"> and for reading.
export function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}
