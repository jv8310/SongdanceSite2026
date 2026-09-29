// Retreat-specific transport questions for the intake.
//
// The intake (steps.ts) is the same screening for every retreat; how people
// get *to* a retreat is not — a boat in the Red Sea needs flight numbers for
// the airport shuttle, a château in the Ardennes needs to know who is driving
// and has a seat to spare. So each retreat that needs it gets its own
// TransportSection, written on instruction ("for the boat, ask for…") in its
// own file under ./transport/ and registered in TRANSPORT_SECTIONS below by the
// retreat's PRODUCT slug (the same key as /admin/retreats/<slug>).
//
// A registered section does three things:
//   • its questions join the intake form, just before "anything else" — or are
//     served on their own at /intake?…&only=transport for a guest who already
//     sent the intake (or whose flight changed);
//   • the answers land in intake_transport_answers, one row per person, the
//     latest answer winning;
//   • that table is mirrored to the retreat's Google Sheet (transport-sheet.ts),
//     one column per question.
//
// The assessor never sees them: assess.ts walks the base STEPS only, so a
// flight time can't colour a screening.
//
// Rules for a section (see CLAUDE.md "Retreat intake — transport section"):
//   • A question's `key` is its identity — the stored answer and the sheet
//     column hang on it. Rename the wording freely; change a key only when the
//     question genuinely changes, because answers under the old key stop
//     showing.
//   • `showIf` points at another question of the SAME section by its key, and
//     only at a radio (the value compared is a single string).
//   • Every string can be one language (`'…'`) or both (`{ en, nl }`); the
//     form shows the guest's language and falls back to English.

import type { Locale, StepCopy } from './copy';
import type { StepDef } from './steps';
import { DOLPHIN_AND_SOUND_2026 } from './transport/dolphin-and-sound-2026';
import { RITUAL_OF_BELONGING_2026 } from './transport/ritual-of-belonging-2026';

export type Localized = string | { en: string; nl?: string };

export type TransportQuestionType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'time'
  | 'radio'
  | 'checkboxes';

export interface TransportOption {
  value: string;
  label: Localized;
}

export interface TransportQuestion {
  // Stable id (snake_case). The stored answer and the sheet column key on it.
  key: string;
  type: TransportQuestionType;
  title: Localized;
  body?: Localized;
  placeholder?: Localized;
  required?: boolean;
  options?: TransportOption[];
  // Only ask when another question of this section (a radio) was answered
  // with one of these values.
  showIf?: { key: string; valueIn: string[] };
  // The sheet's column header. Defaults to the English title.
  column?: string;
  maxLength?: number;
  // For dates: the range the picker offers (YYYY-MM-DD).
  min?: string;
  max?: string;
}

export interface TransportSection {
  // Heading of the screen that opens the section. Defaults to "Getting there."
  title?: Localized;
  // Why we ask — one or two retreat-specific sentences. Opens the section on
  // the form AND is the heart of the travel-questions email.
  why: Localized;
  questions: TransportQuestion[];
  // The language the sheet writes option labels in. Default 'en'.
  sheetLocale?: Locale;
}

// Keyed by the retreat's product slug (products.slug). An intake that isn't
// linked to a product can still carry a section by using its own intake slug
// as the key.
export const TRANSPORT_SECTIONS: Record<string, TransportSection> = {
  'dolphin-and-sound-2026': DOLPHIN_AND_SOUND_2026,
  'ritual-of-belonging-2026': RITUAL_OF_BELONGING_2026,
};

export function transportSectionFor(keys: {
  productSlug?: string | null;
  eventCode?: string | null;
}): TransportSection | null {
  for (const k of [keys.productSlug, keys.eventCode]) {
    if (k && Object.prototype.hasOwnProperty.call(TRANSPORT_SECTIONS, k)) {
      return TRANSPORT_SECTIONS[k]!;
    }
  }
  return null;
}

export function tr(text: Localized | undefined, locale: Locale): string | undefined {
  if (text === undefined) return undefined;
  if (typeof text === 'string') return text;
  return (locale === 'nl' ? text.nl : undefined) ?? text.en;
}

// Transport answers travel in the same answers object as the screening, so
// their keys are namespaced to never collide with a base step.
export const TRANSPORT_PREFIX = 'transport_';
const INTRO_KEY = 'transport_intro';

export function transportStepKey(q: TransportQuestion | string): string {
  return TRANSPORT_PREFIX + (typeof q === 'string' ? q : q.key);
}

export function columnFor(q: TransportQuestion): string {
  return q.column ?? tr(q.title, 'en') ?? q.key;
}

const DEFAULT_TITLE: Record<Locale, string> = {
  nl: 'Hoe je er komt.',
  en: 'Getting there.',
};

const DONE_COPY: Record<Locale, StepCopy> = {
  nl: {
    title: 'Dank je.',
    body:
      'Je reisgegevens zijn binnen. Verandert er nog iets, open dan dezelfde link opnieuw en stuur de nieuwe gegevens.',
  },
  en: {
    title: 'Thank you.',
    body:
      'Your travel details are with us. If anything changes, open the same link again and send the new details.',
  },
};

// The section as intake steps + their copy, in one language. `opening` is the
// type of the first screen: a 'pause' inside the full intake (a breath between
// sections), an 'intro' when the section is the whole form.
function sectionSteps(
  section: TransportSection,
  locale: Locale,
  opening: 'pause' | 'intro',
): { steps: StepDef[]; copy: Record<string, StepCopy> } {
  const steps: StepDef[] = [{ key: INTRO_KEY, type: opening }];
  const copy: Record<string, StepCopy> = {
    [INTRO_KEY]: {
      title: tr(section.title, locale) ?? DEFAULT_TITLE[locale],
      body: tr(section.why, locale),
    },
  };
  for (const q of section.questions) {
    const key = transportStepKey(q);
    steps.push({
      key,
      type: q.type,
      required: q.required,
      options: q.options?.map((o) => ({ value: o.value })),
      showIf: q.showIf
        ? { stepKey: transportStepKey(q.showIf.key), valueIn: q.showIf.valueIn }
        : undefined,
      maxLength: q.maxLength,
      min: q.min,
      max: q.max,
    });
    copy[key] = {
      title: tr(q.title, locale),
      body: tr(q.body, locale),
      placeholder: tr(q.placeholder, locale),
      options: q.options
        ? Object.fromEntries(q.options.map((o) => [o.value, tr(o.label, locale) ?? o.value]))
        : undefined,
    };
  }
  return { steps, copy };
}

// The full intake with the section spliced in just before "anything else", so
// the form still closes on the open question and the agreements.
export function intakeStepsWithTransport(
  base: StepDef[],
  baseCopy: Record<string, StepCopy>,
  section: TransportSection | null,
  locale: Locale,
): { steps: StepDef[]; copy: Record<string, StepCopy> } {
  if (!section) return { steps: base, copy: baseCopy };
  const part = sectionSteps(section, locale, 'pause');
  const at = base.findIndex((s) => s.key === 'anything_else');
  const cut = at === -1 ? base.findIndex((s) => s.type === 'consent') : at;
  const steps =
    cut === -1
      ? [...base, ...part.steps]
      : [...base.slice(0, cut), ...part.steps, ...base.slice(cut)];
  return { steps, copy: { ...baseCopy, ...part.copy } };
}

// The section on its own: opening screen, name + email (hidden when an
// invitation link prefills them), the questions, then a "thank you".
export function transportOnlySteps(
  base: StepDef[],
  baseCopy: Record<string, StepCopy>,
  section: TransportSection,
  locale: Locale,
): { steps: StepDef[]; copy: Record<string, StepCopy> } {
  const part = sectionSteps(section, locale, 'intro');
  const identity = base.filter((s) => s.key === 'full_name' || s.key === 'email');
  const [opening, ...questions] = part.steps;
  return {
    steps: [opening!, ...identity, ...questions],
    copy: {
      full_name: baseCopy.full_name ?? {},
      email: baseCopy.email ?? {},
      ...part.copy,
      done: DONE_COPY[locale],
    },
  };
}

// ---------- Answers ----------

export type TransportAnswers = Record<string, string | string[]>;

function isVisible(q: TransportQuestion, answers: TransportAnswers): boolean {
  if (!q.showIf) return true;
  const dep = answers[q.showIf.key];
  return typeof dep === 'string' && q.showIf.valueIn.includes(dep);
}

// Pull the section's answers out of a submitted answers object (prefixed
// keys), keeping only what the section asks for, in the shape it asks for, and
// only for questions the guest was actually shown. Returned keys are the
// questions' own (unprefixed) keys — the stored and synced shape.
export function transportAnswersFrom(
  section: TransportSection,
  raw: Record<string, unknown>,
): TransportAnswers {
  const out: TransportAnswers = {};
  for (const q of section.questions) {
    const v = raw[transportStepKey(q)];
    if (q.type === 'checkboxes') {
      if (!Array.isArray(v)) continue;
      const allowed = new Set((q.options ?? []).map((o) => o.value));
      const picked = v.filter((x): x is string => typeof x === 'string' && allowed.has(x));
      if (picked.length > 0) out[q.key] = picked;
      continue;
    }
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (!s) continue;
    if (q.type === 'radio') {
      if ((q.options ?? []).some((o) => o.value === s)) out[q.key] = s;
      continue;
    }
    out[q.key] = s.slice(0, q.maxLength ?? (q.type === 'textarea' ? 2000 : 300));
  }
  // Second pass: drop answers to questions that ended up hidden (a guest who
  // picked "by plane", typed a flight, then went back and chose "by car").
  for (const q of section.questions) {
    if (out[q.key] !== undefined && !isVisible(q, out)) delete out[q.key];
  }
  return out;
}

// The first required question that is shown but unanswered, or null.
export function missingTransportAnswer(
  section: TransportSection,
  answers: TransportAnswers,
): string | null {
  for (const q of section.questions) {
    if (!q.required || !isVisible(q, answers)) continue;
    const v = answers[q.key];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) return q.key;
  }
  return null;
}

// One answer as a readable string (option labels, not codes). Empty when the
// question wasn't answered or wasn't shown.
export function renderTransportAnswer(
  q: TransportQuestion,
  answers: TransportAnswers,
  locale: Locale,
): string {
  const v = answers[q.key];
  if (v === undefined || !isVisible(q, answers)) return '';
  const label = (code: string) =>
    tr(q.options?.find((o) => o.value === code)?.label, locale) ?? code;
  if (Array.isArray(v)) return v.map(label).join(', ');
  if (q.type === 'radio') return label(v);
  return v;
}

export function transportQA(
  section: TransportSection,
  answers: TransportAnswers,
  locale: Locale = 'en',
): { question: string; answer: string }[] {
  return section.questions
    .filter((q) => isVisible(q, answers))
    .map((q) => ({
      question: columnFor(q),
      answer: renderTransportAnswer(q, answers, locale) || '—',
    }));
}

export function parseTransportAnswers(json: string | null | undefined): TransportAnswers {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as TransportAnswers) : {};
  } catch {
    return {};
  }
}

// ---------- Storage ----------

export interface TransportRow {
  id: string;
  event_code: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  locale: string;
  answers_json: string;
  source: string;
  created_at: string;
  updated_at: string;
}

// Upsert one person's answers for one retreat — the latest form wins, from
// whichever of the two doors it came through. A phone number is kept when the
// newer form didn't ask for one (the travel-only form doesn't).
export async function saveTransportAnswers(
  db: D1Database,
  args: {
    eventCode: string;
    email: string;
    fullName: string | null;
    phone: string | null;
    locale: Locale;
    answers: TransportAnswers;
    source: 'intake' | 'transport';
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO intake_transport_answers
         (id, event_code, email, full_name, phone, locale, answers_json, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_code, email) DO UPDATE SET
         full_name    = COALESCE(excluded.full_name, intake_transport_answers.full_name),
         phone        = COALESCE(excluded.phone, intake_transport_answers.phone),
         locale       = excluded.locale,
         answers_json = excluded.answers_json,
         source       = excluded.source,
         updated_at   = datetime('now')`,
    )
    .bind(
      crypto.randomUUID(),
      args.eventCode,
      args.email.trim().toLowerCase(),
      args.fullName || null,
      args.phone || null,
      args.locale,
      JSON.stringify(args.answers),
      args.source,
    )
    .run();
}

export async function listTransportRows(
  db: D1Database,
  eventCode: string,
): Promise<TransportRow[]> {
  const q = await db
    .prepare(
      `SELECT * FROM intake_transport_answers
        WHERE event_code = ?
        ORDER BY created_at, id`,
    )
    .bind(eventCode)
    .all<TransportRow>();
  return q.results ?? [];
}
