import type { APIRoute } from 'astro';

export const prerender = false;

const SYSTEM_PROMPT = `You are writing a personalized forgiveness prayer for a single visitor.

CONTEXT FROM THE QUIZ
The visitor described their situation in 1-3 sentences. They named:
- Their relationship to it (Q4 = hurt_by, hurt_them, mutual, self, life)
- Where the wound lives in them now (Q2 = body, heart, head, mix)
- What this part of them most wants (Q3 = body→letting-go, heart→being-seen, head→understanding)
- Where they are right now (Q5 = resistant, head_not_body, returns, ready, numb)

A "dominant center" is computed from their answers (body, heart, or head). That sets the prayer's voice register.

VOICE
- Spare, atmospheric, embodied. Never marketing. Never therapeutic jargon. Never spiritual cliché.
- Free verse. Each stanza 1-3 lines. Stanzas separated by a single blank line.
- 9-12 lines total. Concise. Each line should land.
- "I" voice throughout.

REGISTER (use the visitor's center)
- BODY → physical, breath, weight, gesture, posture, tightness, ground. Avoid abstract feeling-words and meaning-making.
- HEART → relational, the ache, the tenderness, the love, what was real. Avoid bodily detail or abstract concepts.
- HEAD → understanding, story, meaning, clarity, the loops. Avoid bodily detail or strong feeling-words.

INTERNAL ARC (NEVER named on the surface)
The prayer follows a four-movement spine. Each movement carries the spirit of one of the four phrases of ho'oponopono — but the phrases themselves NEVER appear literally. The movements are NEVER labeled in the output.

1. Opening — meets them at their Q5 readiness state in their center's voice. (1-2 lines.)
2. Naming — names the situation in one line, abstracted from Q1. Never use a real name. Never quote the visitor verbatim. (1 line.)
3. Acknowledgment — owns what was carried. Carries the spirit of "I'm sorry" without ever saying it. (1-2 lines.)
4. Release — the asking, or granting, of the let-go. Carries the spirit of "please forgive me" without ever saying it. (1-2 lines.)
5. Honoring — gratitude for what was real, what protected, what was learned. Carries the spirit of "thank you" through gestures of recognition and honoring — but the words "thank you" must not appear. (1-2 lines.)
6. Return — coming home — to body, to love, to clarity. Carries the spirit of "I love you" as presence and tenderness, never as the words. (1-2 lines.)
7. Closing — short final image, in the center's voice. (1 line.)

HARD RULES
- The literal phrases "I'm sorry", "please forgive me", "thank you", "I love you" must NEVER appear in the output. Their spirit shows in your verbs and movement, not in the words.
- Never name the tradition (no "ho'oponopono", "the four phrases", "three layers").
- Never name the movements (no headings, no eyebrows, no labels).
- Render Q1 abstractly. No proper names. No verbatim quotes from the visitor.
- Output ONLY the prayer. No preamble. No quotes around it. No markdown.`;

const RELATIONSHIPS = new Set(['hurt_by', 'hurt_them', 'mutual', 'self', 'life']);
const Q2_VALUES = new Set(['body', 'heart', 'head', 'mix']);
const Q3_VALUES = new Set(['body', 'heart', 'head']);
const Q5_VALUES = new Set(['resistant', 'head_not_body', 'returns', 'ready', 'numb']);
const CENTER_VALUES = new Set(['body', 'heart', 'head']);

const FORBIDDEN = [
  /\bI'?m sorry\b/i,
  /\bplease forgive me\b/i,
  /\bthank you\b/i,
  /\bI love you\b/i,
];

const fallbackResponse = (reason: string, detail?: string) => {
  console.warn(`[forgiveness-prayer] fallback reason=${reason}${detail ? ' detail=' + detail : ''}`);
  return new Response(JSON.stringify({ fallback: true, reason }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  let body: { q1?: string; q2?: string; q3?: string; q4?: string; q5?: string; center?: string };
  try {
    body = await request.json();
  } catch {
    return fallbackResponse('bad-json');
  }

  const q1 = (body.q1 ?? '').toString().slice(0, 600).trim();
  const q2 = (body.q2 ?? '').toString().trim();
  const q3 = (body.q3 ?? '').toString().trim();
  const q4 = (body.q4 ?? '').toString().trim();
  const q5 = (body.q5 ?? '').toString().trim();
  const center = (body.center ?? '').toString().trim();

  if (
    !q1 ||
    !RELATIONSHIPS.has(q4) ||
    !Q2_VALUES.has(q2) ||
    !Q3_VALUES.has(q3) ||
    !Q5_VALUES.has(q5) ||
    !CENTER_VALUES.has(center)
  ) {
    return fallbackResponse('bad-input');
  }

  const cfEnv = (locals as { runtime?: { env?: Record<string, string | undefined> } }).runtime?.env;
  const apiKey = cfEnv?.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallbackResponse('no-key');
  }

  const userMessage = [
    `Center (voice register): ${center}`,
    `Q4 relationship: ${q4}`,
    `Q2 where the wound lives: ${q2}`,
    `Q3 what this part wants: ${q3}`,
    `Q5 readiness: ${q5}`,
    '',
    'Visitor description (Q1):',
    q1,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

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
      .trim()
      .replace(/^["'“‘]+|["'”’]+$/g, '')
      .trim();

    if (!text) return fallbackResponse('empty-response');

    // Hard guard against the model leaking literal phrases.
    if (FORBIDDEN.some((re) => re.test(text))) {
      return fallbackResponse('literal-phrase', text.slice(0, 200));
    }

    return new Response(JSON.stringify({ prayer: text }), {
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
