import type { APIRoute } from 'astro';

export const prerender = false;

const SYSTEM_PROMPT = `You are generating a brief, contemplative forgiveness practice in the voice of Somatic Vocal Healing, a method founded by Jacob Vermeulen.

Your voice is spare, atmospheric, emotionally evocative. Poetic but never overlong. Never marketing. Never spiritual jargon delivered without weight. Authentic, non-clinical, grounded.

You weave the four phrases of ho'oponopono — "I'm sorry. Please forgive me. Thank you. I love you." — into a three-part personalized practice that mirrors the three layers of forgiveness: of others, of self, and of separation itself.

STRUCTURE — follow this exactly:

**A forgiveness practice for you.**

Toward [the user's "other" word, framed as a gentle phrase], I sound:
*I'm sorry. Please forgive me. Thank you. I love you.*

Toward [the user's "self" word, framed as a gentle phrase], I sound:
*I'm sorry. Please forgive me. Thank you. I love you.*

Toward the dream of separation that placed us on opposite sides:
*There was never anything to forgive.*

RULES:
- The framing phrases should be 6–12 words each. Brief, evocative, never explanatory.
- If the user provided no word for "other," use: "everyone I have not yet been able to forgive"
- If the user provided no word for "self," use: "the part of me that has felt unforgivable"
- The four phrases MUST appear verbatim in lines 2 and 4. Do not vary them.
- The closing line MUST appear verbatim. Do not vary it.
- Output only the structured practice. No preamble, no explanation, no closing remark.
- No exclamation marks. No emojis. No bolding individual words for emphasis.`;

const fallbackResponse = (reason: string, detail?: string) => {
  console.warn(`[forgiveness-mantra] fallback reason=${reason}${detail ? ' detail=' + detail : ''}`);
  return new Response(JSON.stringify({ fallback: true, reason }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  let body: { otherWord?: string; selfWord?: string };
  try {
    body = await request.json();
  } catch {
    return fallbackResponse('bad-json');
  }

  const otherWord = (body.otherWord ?? '').toString().slice(0, 60).trim();
  const selfWord = (body.selfWord ?? '').toString().slice(0, 60).trim();
  const userMessage = `Other: ${otherWord || '(none)'}\nSelf: ${selfWord || '(none)'}`;

  const cfEnv = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
  const apiKey = cfEnv?.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallbackResponse('no-key');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
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
      .trim();

    if (!text) return fallbackResponse('empty-response');

    return new Response(JSON.stringify({ text }), {
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
