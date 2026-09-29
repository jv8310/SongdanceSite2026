// Draft a retreat's travel questions with the Claude API.
//
// /admin/retreats/<slug> → Intake → "Change the questions with Claude": the
// admin writes what to ask in plain words, and this turns that — together with
// the questions the retreat asks today — into a complete TransportSection.
// The reply is constrained to a JSON schema (structured outputs), converted to
// the section shape transport.ts uses, and checked by validateTransportSection;
// a draft that fails the checks gets one correction round with the errors
// spelled out. Nothing here publishes: the caller stores the result as a draft
// the admin previews and then publishes or discards.

import Anthropic from '@anthropic-ai/sdk';
import {
  TRANSPORT_TYPES,
  validateTransportSection,
  type Localized,
  type TransportQuestion,
  type TransportSection,
} from './transport';

const MODEL = 'claude-opus-5-5';

// Structured outputs need every property required and no open objects, so
// optional fields are `X | null` here and dropped when converting.
const TEXT = {
  type: 'object',
  properties: { en: { type: 'string' }, nl: { type: 'string' } },
  required: ['en', 'nl'],
  additionalProperties: false,
} as const;
const TEXT_OR_NULL = { anyOf: [TEXT, { type: 'null' }] };

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    section: {
      type: 'object',
      properties: {
        title: TEXT_OR_NULL,
        why: TEXT,
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              type: { type: 'string', enum: TRANSPORT_TYPES },
              title: TEXT,
              body: TEXT_OR_NULL,
              placeholder: TEXT_OR_NULL,
              required: { type: 'boolean' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { value: { type: 'string' }, label: TEXT },
                  required: ['value', 'label'],
                  additionalProperties: false,
                },
              },
              show_if: {
                anyOf: [
                  {
                    type: 'object',
                    properties: {
                      key: { type: 'string' },
                      value_in: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['key', 'value_in'],
                    additionalProperties: false,
                  },
                  { type: 'null' },
                ],
              },
              column: { type: 'string' },
              max_length: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
              min: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
              max: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
            },
            required: [
              'key',
              'type',
              'title',
              'body',
              'placeholder',
              'required',
              'options',
              'show_if',
              'column',
              'max_length',
              'min',
              'max',
            ],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'why', 'questions'],
      additionalProperties: false,
    },
  },
  required: ['summary', 'section'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You design the travel part of a retreat intake form for Songdance. Songdance runs small residential retreats led by Jacob; the intake is a form every booked guest fills in before they come. This part of it asks how each guest is getting there, so the team can plan airport shuttles, shared taxis and lifts. The answers land in a Google Sheet, one column per question.

You receive the retreat, the travel questions it asks today (as JSON — possibly none), the question keys that already have stored answers, and the organiser's instruction. Return the complete revised section, not a diff.

How the form works: one question per screen; a "why" sentence opens the section; a question can be shown only when an earlier single-choice question got certain answers; hidden questions are skipped and not stored.

Rules:
- Ask only what the instruction and the travel logistics need. Nothing medical, psychological or about the practice — the rest of the intake covers that.
- A question's key is its identity: the stored answers and the sheet column hang on it. Keep the key whenever a question keeps its meaning, even if you reword it. Keys that already have stored answers stay unless the organiser asks to drop that question. New keys: short English snake_case.
- Types: radio for one choice, checkboxes for several, date for a calendar day, time for a clock time, text for a short answer (a flight number, a city), textarea for open notes, number for a count. Radio and checkboxes need at least two options, each with a snake_case value and a label; every other type has an empty options list.
- show_if points at an EARLIER radio question by its key and lists the option values that reveal this question; null when always shown.
- Mark required only what the team truly needs. A required single choice must include an honest way out ("I haven't booked yet", "I'll make my own way", "Not sure yet") so nobody is blocked; notes are optional.
- Write every text in English (en) and Dutch (nl). Dutch is natural and informal ("je"), as spoken in Flanders.
- Titles are the questions themselves, short and warm. Use body only for a genuinely helpful line (for example "Local time in Egypt."); placeholder only for text, textarea and number answers (an example of the expected answer).
- "why": one or two sentences telling the guest what the answers are for. It opens the section and is also the body of the email that asks for the travel details.
- "column": a short English header for the sheet ("Arrival flight").
- Dates: min and max bound the date picker (YYYY-MM-DD). Use the retreat dates to set sensible bounds for arrival and departure, or null. max_length: null unless there is a reason.
- Tone: warm, plain and practical. No hype, no exclamation marks, no promises. Travel copy does not mention the practice itself.
- "summary": two or three plain sentences for the organiser: what you changed, and anything they should check before publishing — above all any question you removed or whose meaning you changed while it has stored answers.`;

export interface DraftInput {
  apiKey: string | undefined;
  retreat: { name: string; startsAt: string | null; endsAt: string | null };
  current: TransportSection | null;
  answeredKeys: string[];
  brief: string;
}

export type DraftResult =
  | { ok: true; section: TransportSection; summary: string }
  | { ok: false; error: string };

type OutText = { en: string; nl: string };
type OutQuestion = {
  key: string;
  type: TransportQuestion['type'];
  title: OutText;
  body: OutText | null;
  placeholder: OutText | null;
  required: boolean;
  options: { value: string; label: OutText }[];
  show_if: { key: string; value_in: string[] } | null;
  column: string;
  max_length: number | null;
  min: string | null;
  max: string | null;
};
type Output = {
  summary: string;
  section: { title: OutText | null; why: OutText; questions: OutQuestion[] };
};

function localized(t: OutText | null | undefined): Localized | undefined {
  if (!t || !t.en?.trim()) return undefined;
  return t.nl?.trim() ? { en: t.en, nl: t.nl } : { en: t.en };
}

// The schema's shape → the section shape (camelCase, optional fields absent
// rather than null). Validation happens after, on the result.
function toSection(out: Output['section']): unknown {
  return {
    title: localized(out.title),
    why: localized(out.why),
    questions: out.questions.map((q) => ({
      key: q.key,
      type: q.type,
      title: localized(q.title),
      body: localized(q.body),
      placeholder: localized(q.placeholder),
      required: q.required || undefined,
      options:
        q.type === 'radio' || q.type === 'checkboxes'
          ? q.options.map((o) => ({ value: o.value, label: localized(o.label) }))
          : undefined,
      showIf: q.show_if ? { key: q.show_if.key, valueIn: q.show_if.value_in } : undefined,
      column: q.column || undefined,
      maxLength: q.max_length ?? undefined,
      min: q.min ?? undefined,
      max: q.max ?? undefined,
    })),
  };
}

function userMessage(input: DraftInput): string {
  const r = input.retreat;
  const dates = r.startsAt ? `${r.startsAt}${r.endsAt ? ` to ${r.endsAt}` : ''}` : 'not recorded';
  return [
    `Retreat: ${r.name}`,
    `Dates: ${dates}`,
    '',
    'Travel questions it asks today (JSON):',
    input.current ? JSON.stringify(input.current, null, 2) : '(none yet)',
    '',
    `Question keys that already have stored answers: ${
      input.answeredKeys.length ? input.answeredKeys.join(', ') : '(none)'
    }`,
    '',
    "Organiser's instruction:",
    input.brief.trim(),
  ].join('\n');
}

function explainApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The Anthropic API key (ANTHROPIC_API_KEY) was not accepted.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Claude is rate-limited right now — try again in a minute.';
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return 'Claude did not answer in time — try again.';
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude API error ${err.status ?? ''}: ${err.message}`.slice(0, 300);
  }
  return err instanceof Error ? err.message.slice(0, 300) : String(err);
}

export async function draftTransportSection(input: DraftInput): Promise<DraftResult> {
  if (!input.apiKey) return { ok: false, error: 'No ANTHROPIC_API_KEY is configured.' };
  if (!input.brief.trim()) return { ok: false, error: 'Write what the travel questions should ask first.' };

  const client = new Anthropic({ apiKey: input.apiKey, timeout: 150_000, maxRetries: 1 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: userMessage(input) },
  ];

  // One correction round: a draft that is valid JSON but breaks a rule (a
  // show_if pointing at a later question, say) goes back with the errors.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // On a safety decline, re-run on Anthropic's recommended fallback
        // model rather than failing the admin's request.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages,
      });
    } catch (err) {
      return { ok: false, error: explainApiError(err) };
    }

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: 'Claude declined to draft this. Rephrase the instruction and try again.' };
    }
    if (response.stop_reason === 'max_tokens') {
      return { ok: false, error: 'The draft came out too long — ask for fewer questions.' };
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    let out: Output;
    try {
      out = JSON.parse(text) as Output;
    } catch {
      return { ok: false, error: 'Claude returned something that is not the expected JSON.' };
    }

    const check = validateTransportSection(toSection(out.section));
    if (check.ok) return { ok: true, section: check.section, summary: out.summary.trim() };
    if (attempt === 2) {
      return { ok: false, error: `The draft still breaks the form's rules: ${check.errors.slice(0, 4).join(' ')}` };
    }
    messages.push(
      { role: 'assistant', content: response.content },
      {
        role: 'user',
        content: `That section fails these checks:\n- ${check.errors.join('\n- ')}\n\nReturn the corrected complete section.`,
      },
    );
  }
  return { ok: false, error: 'No draft was produced.' };
}
