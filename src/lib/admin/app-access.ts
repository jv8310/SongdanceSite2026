// App access — the member app's courses, Circle seats and host spaces for one
// person, read and changed from their People page (/admin/people/<email>,
// "App access"). The app (songdance-app, Worker `songdance-app-api`) owns all
// of it: this site never reads or writes the app's `app_*` tables itself. It
// asks the app through a service binding (APP_ADMIN in wrangler.jsonc →
// entrypoint SiteAdmin), which is reachable only from Workers on this
// Cloudflare account — the binding is the credential, there is no secret.
//
// Certification lives here too: whether they applied in the app (their own
// ticks), and "certified" — Jacob's word, with the certificate the student
// downloads from their certification page in the app. The file is kept in the
// app's private bucket; this site only passes it through.
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

export type AppCertCheck = 'classes' | 'practice' | 'qa' | 'quiz' | 'video' | 'applied';

export type AppCertified = {
  email: string; // the address the record sits under (may be a linked one)
  on: string; // YYYY-MM-DD
  note: string | null;
  by: string;
  certificate: { filename: string; contentType: string; sizeBytes: number; addedAt: string | null; by: string | null } | null;
  // Jacob's feedback on the session (absent from an app deployed before it).
  feedback?: { text: string; at: string | null; by: string | null } | null;
};

export type AppCertification = {
  available: boolean; // false until the app's migration app_0030 has run
  checks: Record<AppCertCheck, string | null> | null; // null without an app account
  certified: AppCertified | null;
};

export type AppMemberAccess = {
  email: string;
  account: { name: string | null; role: string; createdAt: string; lastSeenAt: string | null } | null;
  linkedEmails: string[];
  courses: AppCourse[];
  spaceSeats: Array<{ spaceKey: string; title: string; source: string; grantedBy: string | null; createdAt: string }>;
  hostSpaces: Array<{ spaceKey: string; title: string }>;
  certification?: AppCertification; // absent from an app deployed before certification
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
  certify(input: { email: string; on?: string; note?: string; feedback?: string; actor: string }): Promise<AppAnswer<AppCertified>>;
  certificationFeedback(input: { email: string; feedback: string | null; actor: string }): Promise<AppAnswer<AppCertified>>;
  uncertify(input: { email: string; reason: string; actor: string }): Promise<AppAnswer<{ removed: boolean }>>;
  addCertificate(input: { email: string; filename?: string; bytes: ArrayBuffer; actor: string }): Promise<AppAnswer<AppCertified>>;
  removeCertificate(input: { email: string; actor: string }): Promise<AppAnswer<AppCertified>>;
  certificate(input: { email: string }): Promise<AppAnswer<{ filename: string; contentType: string; bytes: ArrayBuffer }>>;
  // Jacob's Google Calendar → live sessions in the app (the app's lib/calendar-sessions.ts;
  // here, src/lib/workshops/calendar-sync.ts). Absent from an app deployed before it.
  calendarSessionTitles?(): Promise<AppAnswer<string[]>>;
  calendarSessions?(input: { actor: string; until: string; sessions: AppCalendarSessionIn[] }): Promise<AppAnswer<{ sessions: AppCalendarSessionOut[]; missing: AppCalendarMissing[] }>>;
};

export type AppCalendarSessionIn = {
  calendarEventId: string;
  calendarTitle: string;
  startsAt: string;
  endsAt: string;
  timeZone: string | null;
  joinUrl: string | null;
  passcode: string | null;
};

export type AppCalendarMissing = { eventId: string; title: string; startsAt: string; calendarTitle: string };

export type AppCalendarSessionOut = {
  calendarEventId: string;
  calendarTitle: string;
  startsAt: string;
  outcome: 'created' | 'linked' | 'updated' | 'unchanged' | 'skipped';
  eventId: string | null;
  detail: string | null;
};

/** The longest feedback the app keeps (its MAX_CERT_FEEDBACK_CHARS). */
export const MAX_CERT_FEEDBACK_CHARS = 20_000;

/** What the app takes as a certificate (its MAX_CERTIFICATE_BYTES); the app checks the bytes again. */
export const MAX_CERTIFICATE_BYTES = 20 * 1024 * 1024;

/** The five steps the student ticks before sending the form, in the app's order. */
export const CERT_STEPS: Array<{ key: AppCertCheck; label: string }> = [
  { key: 'classes', label: 'all the classes' },
  { key: 'practice', label: 'practised 3 times or more' },
  { key: 'qa', label: '6 Q&As or more' },
  { key: 'quiz', label: 'Level 3 in the quiz' },
  { key: 'video', label: 'session video ready' },
];

export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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
