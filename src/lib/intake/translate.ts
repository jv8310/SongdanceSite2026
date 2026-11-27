// English version of a stored intake assessment, for the assessments PDF.
//
// `intake_submissions.assessment_md` is written by the assessor, whose prompt
// and section headings are Dutch; the body is English for most intakes and
// Dutch for some. The PDF is read in English: an English body only gets its
// headings put into English (no call), a Dutch one is translated once by
// Claude and kept in `events`
// (external_id `intake-assess-en-<submission id>-<hash of the Dutch text>`).
// The hash is part of the key, so a re-run assessment gets a fresh
// translation by itself and nothing has to be invalidated. No table of its
// own: the same "answer kept in events" shape as the Drip lookups.

import Anthropic from '@anthropic-ai/sdk';
import { selectByIdsChunked } from '../db/chunked';

const MODEL = 'claude-opus-5-5';
const KIND = 'intake.assessment.translated';

const SYSTEM_PROMPT = `You translate a private intake assessment for a Somatic Vocal Healing retreat from Dutch into English. The reader is the facilitation team.

Return only the translated markdown, nothing before or after it.

Keep the structure exactly: the same headings in the same order, the same bullets, the same bold markers. Do not add, drop, soften or summarise anything; this is a translation, not an edit.

Fixed renderings:
- A first line of the form "## Assessment: <CLASSIFICATION>" stays exactly as it is, untranslated.
- "**Deelnemer:**" becomes "**Participant:**"
- "### Korte samenvatting" becomes "### Short summary"
- "### Sterktes" becomes "### Strengths"
- "### Aandachtspunten" becomes "### Points of attention"
- "### Wat ik zou bespreken in een gesprek" becomes "### What I would discuss in a conversation"
- "### Onderbouwing van de classificatie" becomes "### Rationale for the classification"
- "### Eventuele zorgen voor het facilitatieteam" becomes "### Notes for the facilitation team"
- "klankopstelling(en)" is "sound constellation(s)"; "draagkracht" is "capacity to carry"; "opvang" is "support after the retreat"; "ervaringsgericht werk" is "experiential work".
- The classification words VEILIG, NEEDS A CALL, FURTHER INVESTIGATION NEEDED and RED FLAG stay as written wherever they appear in the text, with "(safe)" after VEILIG the first time it appears in a sentence.

Words quoted from the participant are translated too, kept inside their quotation marks. Names of people, places and retreats stay as they are. Write plain, sober British English. Parts already in English stay as they are.`;

// The assessor's fixed Dutch headings, in English. Most assessments are
// written in English already (the assessor follows the intake's language) and
// only carry these headings in Dutch: those are fixed here, with no call.
const HEADINGS: Array<[RegExp, string]> = [
  [/^\*\*Deelnemer:\*\*/im, '**Participant:**'],
  [/^(#{2,3})\s+Korte samenvatting\s*$/im, '$1 Short summary'],
  [/^(#{2,3})\s+Sterktes\s*$/im, '$1 Strengths'],
  [/^(#{2,3})\s+Aandachtspunten\s*$/im, '$1 Points of attention'],
  [/^(#{2,3})\s+Wat ik zou bespreken in een gesprek\s*$/im, '$1 What I would discuss in a conversation'],
  [/^(#{2,3})\s+Onderbouwing van de classificatie\s*$/im, '$1 Rationale for the classification'],
  [/^(#{2,3})\s+Eventuele zorgen voor het facilitatieteam\s*$/im, '$1 Notes for the facilitation team'],
];

export function englishHeadings(markdown: string): string {
  let out = markdown;
  for (const [re, to] of HEADINGS) out = out.replace(re, to);
  // "…, 47, voor Ritual of Belonging" on the participant line.
  out = out.replace(/^(\*\*Participant:\*\*.*?),? voor /m, '$1, for ');
  return out;
}

const DUTCH_WORDS = /\b(het|een|niet|voor|van|deze|zijn|wordt|maar|ook|naar|bij|geen|haar|met|dat|heeft|wel|nog)\b/gi;
const ENGLISH_WORDS = /\b(the|and|with|this|that|she|has|have|which|would|from|there|not|but|are|was|their)\b/gi;

/** Whether the body (headings aside) is written in Dutch. */
export function looksDutch(markdown: string): boolean {
  const body = markdown
    .split(/\r?\n/)
    .filter((l) => !/^#{1,6}\s/.test(l))
    .join(' ');
  const nl = body.match(DUTCH_WORDS)?.length ?? 0;
  const en = body.match(ENGLISH_WORDS)?.length ?? 0;
  return nl > en;
}

async function shortHash(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function translationKey(submissionId: string, markdown: string): Promise<string> {
  return `intake-assess-en-${submissionId}-${await shortHash(markdown)}`;
}

/** The kept English versions for these submissions; a missing id has none yet. */
export async function cachedTranslations(
  db: D1Database,
  rows: Array<{ id: string; assessment_md: string | null }>,
): Promise<Map<string, string>> {
  const keyToId = new Map<string, string>();
  for (const r of rows) {
    if (r.assessment_md) keyToId.set(await translationKey(r.id, r.assessment_md), r.id);
  }
  const out = new Map<string, string>();
  if (keyToId.size === 0) return out;
  const found = await selectByIdsChunked<{ external_id: string; payload_json: string | null }>(
    db,
    [...keyToId.keys()],
    (placeholders) =>
      `SELECT external_id, payload_json FROM events WHERE external_id IN (${placeholders})`,
  );
  for (const f of found) {
    const id = keyToId.get(f.external_id);
    if (!id || !f.payload_json) continue;
    try {
      const md = (JSON.parse(f.payload_json) as { markdown?: string }).markdown;
      if (md) out.set(id, md);
    } catch {
      // An unreadable row counts as no translation.
    }
  }
  return out;
}

export type TranslateResult = { ok: true; markdown: string } | { ok: false; error: string };

function explain(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was not accepted.';
  if (err instanceof Anthropic.RateLimitError) return 'Claude is rate-limited right now.';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Claude did not answer in time.';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}`.trim();
  return err instanceof Error ? err.message.slice(0, 200) : String(err);
}

/** One assessment into English: from `events` when kept, else asked of Claude and kept. */
export async function englishAssessment(
  env: { DB: D1Database; ANTHROPIC_API_KEY?: string },
  submissionId: string,
  markdown: string,
): Promise<TranslateResult> {
  const key = await translationKey(submissionId, markdown);
  const kept = await cachedTranslations(env.DB, [{ id: submissionId, assessment_md: markdown }]);
  const hit = kept.get(submissionId);
  if (hit) return { ok: true, markdown: englishHeadings(hit) };
  if (!looksDutch(markdown)) return { ok: true, markdown: englishHeadings(markdown) };
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: 'No ANTHROPIC_API_KEY is configured.' };

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });
  let text: string;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // On a safety decline, re-run on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: markdown }],
    });
    if (response.stop_reason === 'refusal') return { ok: false, error: 'Claude declined to translate this one.' };
    if (response.stop_reason === 'max_tokens') return { ok: false, error: 'The translation came out too long.' };
    text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  } catch (err) {
    return { ok: false, error: explain(err) };
  }
  if (!text) return { ok: false, error: 'Claude returned nothing.' };

  // Two tabs translating the same person: the second insert is ignored.
  try {
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id, payload_json)
         VALUES (NULL, ?, 'admin', ?, ?)`,
      )
      .bind(KIND, key, JSON.stringify({ submission_id: submissionId, markdown: text }))
      .run();
  } catch (err) {
    console.error(`intake translation not kept for ${submissionId}: ${String(err)}`);
  }
  return { ok: true, markdown: englishHeadings(text) };
}
