// The site's half of giving a free live pass from the member app's MCP tools,
// so Claude can do what "Give a free live pass" on /admin/people/<email> does.
// Reached only through the AppBridge entrypoint (src/worker-entrypoint.ts),
// never over HTTP. The pass itself is lib/courses/live-pass-grant.ts, the same
// function the admin form runs; the answer has the same shape as the other
// AppBridge answers ({ ok: false, error, message } on a refusal, never a throw).

import { grantLivePass, type GrantEnv, type GrantLivePassAnswer } from '../courses/live-pass-grant';

export async function grantLivePassFromApp(
  env: GrantEnv,
  input: { email?: unknown; months?: unknown; extend?: unknown; note?: unknown; actor?: unknown; notify?: unknown },
): Promise<GrantLivePassAnswer> {
  const actor = String(input?.actor ?? '').trim().slice(0, 120) || 'unknown';
  return grantLivePass(env, { ...(input ?? {}), actor: `app:${actor}` });
}
