// Calls Claude for an intake assessment. Lives in lib/ so the public
// /api/intake/submit endpoint and the admin /api/admin/reassess-intake
// endpoint can share the same wire format.

import { STEPS, type StepDef } from './steps';
import { STEP_COPY, type Locale } from './copy';
import {
  ASSESSMENT_SYSTEM_PROMPT,
  parseClassification,
  type Classification,
} from './system-prompt';
import type { EventDefinition } from './events';

const ASSESSMENT_MODEL = 'claude-opus-4-7';
const CLAUDE_TIMEOUT_MS = 90_000;

function labelForValue(step: StepDef, value: string): string {
  const opts = STEP_COPY.nl[step.key]?.options;
  if (opts && Object.prototype.hasOwnProperty.call(opts, value)) {
    return opts[value]!;
  }
  return value;
}

function renderAnswerForAssessor(step: StepDef, raw: unknown): string {
  if (raw === undefined || raw === null) return '—';
  switch (step.type) {
    case 'text':
    case 'email':
    case 'number':
    case 'textarea':
      return typeof raw === 'string' && raw.trim() ? raw.trim() : '—';
    case 'radio':
      return typeof raw === 'string' && raw ? labelForValue(step, raw) : '—';
    case 'checkboxes':
      if (Array.isArray(raw) && raw.length > 0) {
        return raw
          .filter((v): v is string => typeof v === 'string')
          .map((v) => labelForValue(step, v))
          .join(', ');
      }
      return '—';
    case 'consent': {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '—';
      const map = raw as Record<string, boolean>;
      return (
        Object.entries(map)
          .filter(([, v]) => v === true)
          .map(([k]) => k)
          .join(', ') || '—'
      );
    }
    default:
      return '—';
  }
}

export function buildAssessorUserMessage(args: {
  event: EventDefinition;
  locale: Locale;
  answers: Record<string, unknown>;
}): string {
  const { event, locale, answers } = args;
  const lines: string[] = [];
  lines.push(`Retreat: ${event.label.nl}`);
  lines.push(`Context retreat: ${event.flavour}`);
  lines.push(`Taal intake-formulier: ${locale === 'nl' ? 'Nederlands' : 'Engels'}`);
  lines.push('');
  lines.push('--- INTAKE-ANTWOORDEN ---');

  for (const step of STEPS) {
    if (step.type === 'intro' || step.type === 'pause') continue;
    const nlCopy = STEP_COPY.nl[step.key];
    const heading = nlCopy?.title ?? step.key;
    const value = renderAnswerForAssessor(step, answers[step.key]);
    lines.push('');
    lines.push(`Q: ${heading}`);
    lines.push(`A: ${value}`);
  }
  return lines.join('\n');
}

export interface AssessmentResult {
  markdown: string;
  classification: Classification | null;
  error: string | null;
}

export async function runAssessment(args: {
  apiKey: string | undefined;
  userMessage: string;
}): Promise<AssessmentResult> {
  if (!args.apiKey) {
    return { markdown: '', classification: null, error: 'no-anthropic-key' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ASSESSMENT_MODEL,
        max_tokens: 2400,
        system: ASSESSMENT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: args.userMessage }],
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      return {
        markdown: '',
        classification: null,
        error: `upstream-${upstream.status}: ${errText.slice(0, 200)}`,
      };
    }
    const data = (await upstream.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) return { markdown: '', classification: null, error: 'empty-response' };
    return { markdown: text, classification: parseClassification(text), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      markdown: '',
      classification: null,
      error: msg.includes('abort') ? 'timeout' : `fetch-error: ${msg.slice(0, 200)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
