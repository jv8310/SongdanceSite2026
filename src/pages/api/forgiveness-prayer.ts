import type { APIRoute } from 'astro';

export const prerender = false;

const SYSTEM_PROMPT = `You are writing a single line that opens a personalized forgiveness prayer.

CONTEXT
- The visitor described their situation in one or two sentences.
- They told us their relationship to it (one of: hurt_by, hurt_them, mutual, self, life).
- The line you write is the SECOND line the visitor will read, just after a one-sentence opening that meets them where they are.

VOICE
- Spare, atmospheric, embodied. Never marketing. Never therapeutic jargon. Never spiritual cliche.
- One sentence. 12-22 words. Ends with a period.
- Renders ONE specific concrete detail from the visitor's description, abstracted (a role, a kind of weight, a season, a gesture). Never names a real name or quotes the visitor verbatim.

PATTERN BY RELATIONSHIP
- hurt_by:    "This is about [them], and the part of me that is still tied to this."
- hurt_them:  "This is about [them], and the part of me that acted from pain — who didn't know better at the time."
- mutual:     "This is about what passed between us. About my share in it. About what neither of us knew how to do differently."
- self:       "This is about me — about the one I have been hardest on."
- life:       "This is about what happened. About the part of me that has been at war with it ever since."

Use the matching pattern as a structural template. Replace bracketed parts with abstracted detail from the visitor's description. Output only the finished line. No preamble, no quotes, no markdown.`;

const RELATIONSHIPS = new Set(['hurt_by', 'hurt_them', 'mutual', 'self', 'life']);

const fallbackResponse = (reason: string, detail?: string) => {
  console.warn(`[forgiveness-prayer] fallback reason=${reason}${detail ? ' detail=' + detail : ''}`);
  return new Response(JSON.stringify({ fallback: true, reason }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  let body: { q1?: string; q4?: string };
  try {
    body = await request.json();
  } catch {
    return fallbackResponse('bad-json');
  }

  const q1 = (body.q1 ?? '').toString().slice(0, 600).trim();
  const q4 = (body.q4 ?? '').toString().trim();
  if (!q1 || !RELATIONSHIPS.has(q4)) {
    return fallbackResponse('bad-input');
  }

  const cfEnv = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
  const apiKey = cfEnv?.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallbackResponse('no-key');
  }

  const userMessage = `Relationship: ${q4}\n\nVisitor description:\n${q1}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      return fallbackResponse('upstream-' + upstream.status, errText.slice(0, 200));
    }

    const data = (await upstream.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim()
      .replace(/^["'“‘]+|["'”’]+$/g, '')
      .trim();

    if (!text) return fallbackResponse('empty-response');

    return new Response(JSON.stringify({ namingLine: text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fallbackResponse(msg.includes('abort') ? 'timeout' : 'fetch-error', msg.slice(0, 200));
  } finally {
    clearTimeout(timer);
  }
};
