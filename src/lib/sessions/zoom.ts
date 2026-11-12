// Zoom for the individual sessions — one meeting of its own per booking,
// through a Zoom "Server-to-Server OAuth" app on Jacob's Zoom account.
//
// Setup (Zoom side, once): marketplace.zoom.us → Develop → Build App →
// Server-to-Server OAuth; scopes `meeting:write:meeting:admin` (create),
// `meeting:update:meeting:admin` and `meeting:delete:meeting:admin` (or the
// classic `meeting:write:admin`); activate it. Then three secrets on the
// worker: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET. Optional
// ZOOM_USER: whose meetings they are (an email or user id; default `me`, the
// account owner).
//
// Without them nothing breaks: the booking takes the Zoom link pasted on the
// "Boekingen" event, else the standard link set on /admin/sessions
// (resolveJoinLink in ./confirm.ts).

export type ZoomEnv = {
  ZOOM_ACCOUNT_ID?: string;
  ZOOM_CLIENT_ID?: string;
  ZOOM_CLIENT_SECRET?: string;
  ZOOM_USER?: string;
};

export function zoomConfigured(env: ZoomEnv): boolean {
  return !!(env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET);
}

// Tokens live an hour; keep one per isolate for 50 minutes.
let cached: { token: string; until: number; key: string } | null = null;

async function zoomToken(env: ZoomEnv): Promise<string> {
  const key = `${env.ZOOM_ACCOUNT_ID}:${env.ZOOM_CLIENT_ID}`;
  if (cached && cached.key === key && cached.until > Date.now()) return cached.token;
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(env.ZOOM_ACCOUNT_ID!)}`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`)}` },
    },
  );
  if (!res.ok) throw new Error(`Zoom token: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: body.access_token, until: Date.now() + 50 * 60_000, key };
  return body.access_token;
}

export type ZoomMeeting = { id: string; joinUrl: string; passcode: string | null };

// "2026-11-12T09:00:00Z" — Zoom wants no milliseconds.
const zoomTime = (iso: string) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function createZoomMeeting(
  env: ZoomEnv,
  input: { topic: string; agenda?: string; startUtc: string; durationMin: number },
): Promise<ZoomMeeting> {
  const user = encodeURIComponent(env.ZOOM_USER?.trim() || 'me');
  const res = await fetch(`https://api.zoom.us/v2/users/${user}/meetings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await zoomToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: input.topic.slice(0, 200),
      agenda: (input.agenda ?? '').slice(0, 2000),
      type: 2, // scheduled
      start_time: zoomTime(input.startUtc),
      timezone: 'UTC',
      duration: input.durationMin,
      settings: {
        join_before_host: false,
        waiting_room: true,
        host_video: true,
        participant_video: true,
        mute_upon_entry: false,
        auto_recording: 'none',
        approval_type: 2, // no registration
      },
    }),
  });
  if (!res.ok) throw new Error(`Zoom create meeting: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const m = (await res.json()) as { id: number | string; join_url: string; password?: string };
  return { id: String(m.id), joinUrl: m.join_url, passcode: m.password || null };
}

export async function updateZoomMeeting(
  env: ZoomEnv,
  meetingId: string,
  input: { startUtc: string; durationMin: number; topic?: string },
): Promise<void> {
  const res = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${await zoomToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start_time: zoomTime(input.startUtc),
      timezone: 'UTC',
      duration: input.durationMin,
      ...(input.topic ? { topic: input.topic.slice(0, 200) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Zoom update meeting: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

export async function deleteZoomMeeting(env: ZoomEnv, meetingId: string): Promise<void> {
  const res = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await zoomToken(env)}` },
  });
  // 404 = already gone (deleted in Zoom itself).
  if (!res.ok && res.status !== 404) {
    throw new Error(`Zoom delete meeting: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

// For the admin page: can we get a token at all?
export async function zoomCheck(env: ZoomEnv): Promise<{ ok: boolean; message: string }> {
  if (!zoomConfigured(env)) return { ok: false, message: 'Not connected — ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET are not set.' };
  try {
    cached = null;
    await zoomToken(env);
    return { ok: true, message: 'Connected — every booking gets a Zoom meeting of its own.' };
  } catch (err) {
    return { ok: false, message: String(err).replace(/^Error:\s*/, '') };
  }
}
