import type { APIRoute } from 'astro';

export const prerender = false;

const SYSTEM_PROMPT = `You are writing a short, personal forgiveness prayer for one visitor.

CONTEXT
- Q4 — relationship to it: hurt_by | hurt_them | mutual | self | life
- Q2 — where the wound lives now: body | heart | head | mix
- Q3 — what this part most wants: body→let-go, heart→be-seen, head→understand
- Q5 — where they are right now: resistant | head_not_body | returns | ready | numb
- Center — body | heart | head — sets the voice register
- Q1 — 1–3 sentences about the situation (render abstractly; no names, no quoting)

FORM
- A prayer, not a paragraph. Free verse, "I" voice, present tense.
- 6 to 8 lines total. Each stanza 1 or 2 lines. Single blank line between stanzas.
- Spare, breath-paced, true. No marketing. No therapy-speak. No spiritual cliché.
- Repetition and quiet anaphora are welcome where they help the prayer breathe.

REGISTER (match the center)
- BODY → breath, weight, gesture, ground. No analysis, no big feeling-words.
- HEART → ache, tenderness, what was real, what was loved. No anatomy, no abstractions.
- HEAD → story, meaning, loops, clarity. No body detail, no large emotion words.

THE FOUR BREATHS (ho'oponopono, woven — never named, never literal)
This prayer is built on the four phrases of ho'oponopono. Their LITERAL words
must never appear, but their spirit drives the four movements at the heart of
the prayer. Let the four breaths arrive in order, each as roughly one line:

  1. Sorrow — the spirit of "I'm sorry."
     Own what was carried, what was done, what was left undone.
  2. Asking — the spirit of "please forgive me."
     Ask, or grant, the let-go. A turning, an unclenching, an opening.
  3. Honoring — the spirit of "thank you."
     Recognise what was real, what protected, what was learned. Without the word.
  4. Returning — the spirit of "I love you."
     Come home — to body, to heart, to clarity. As presence, not as the phrase.

You may open with one short line that meets them at their Q5 state in the
center's voice, and close with one short final image — but only if the prayer
needs them. Tighter is better. Six lines can be a whole prayer.

HARD RULES
- The literal strings "I'm sorry", "please forgive me", "thank you", "I love you" must NEVER appear.
- Never name the tradition (no "ho'oponopono", "the four phrases", "the four breaths").
- Never label the movements (no headings, no eyebrows).
- No proper names. No verbatim quoting of Q1.
- Output ONLY the prayer. No preamble, no quotes around it, no markdown.`;

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
