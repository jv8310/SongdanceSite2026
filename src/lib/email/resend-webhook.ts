// Verifies Resend webhook signatures. Resend signs webhooks with Svix, so the
// scheme is the standard Svix one:
//
//   signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`
//   signature     = base64( HMAC-SHA256(secretBytes, signedContent) )
//
// The signing secret is shown in the Resend dashboard as `whsec_<base64>`; the
// bytes after the prefix are the HMAC key. The `svix-signature` header carries
// one or more space-separated `v1,<base64sig>` entries (key rotation), any of
// which may match. We also bound the timestamp to guard against replay.

const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SvixHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export function readSvixHeaders(headers: Headers): SvixHeaders {
  return {
    id: headers.get('svix-id') ?? headers.get('webhook-id'),
    timestamp: headers.get('svix-timestamp') ?? headers.get('webhook-timestamp'),
    signature: headers.get('svix-signature') ?? headers.get('webhook-signature'),
  };
}

export async function verifyResendWebhook(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const tsNum = parseInt(timestamp, 10);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > TOLERANCE_SECONDS) return false;

  const secretB64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let keyBytes: Uint8Array<ArrayBuffer>;
  try {
    keyBytes = base64ToBytes(secretB64);
  } catch {
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${timestamp}.${rawBody}`));
  const expected = bytesToBase64(mac);

  // Header is a space-separated list of `v1,<sig>` entries.
  return signature.split(' ').some((entry) => {
    const comma = entry.indexOf(',');
    const sig = comma === -1 ? entry : entry.slice(comma + 1);
    return timingSafeEqual(sig, expected);
  });
}
