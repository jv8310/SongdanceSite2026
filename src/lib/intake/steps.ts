// Step definitions for the intake form.
//
// One screen per step. Each step has a `type` driving how it renders,
// a stable `key` used as the answer field name, and optional metadata
// (required, conditional-on, options for selects, etc.).
//
// All user-facing copy lives in copy.ts, indexed by `key`. This keeps
// the structure (step order, types, validation) language-agnostic.

export type StepType =
  | 'intro'        // narrative screen with optional cta only
  | 'pause'        // breathing pause between sections
  | 'text'         // single-line text input
  | 'email'        // email input with format validation
  | 'number'       // numeric input
  | 'textarea'     // multi-line free text
  | 'radio'        // single-select from a list
  | 'checkboxes'   // multi-select from a list
  | 'consent';     // group of required checkboxes (one screen) — also the submit step

export interface OptionDef {
  value: string;
  // No label here; labels live in copy.ts under `<step>.options.<value>`.
}

export interface StepDef {
  key: string;
  type: StepType;
  // Single-value steps: required for submit. Defaults to false.
  required?: boolean;
  // For radio/checkboxes — values are the canonical answer codes.
  options?: OptionDef[];
  // Conditional visibility: only show this step if the named step's
  // answer matches one of the values. Used for follow-up questions.
  showIf?: { stepKey: string; valueIn: string[] };
  // For text/textarea: hard max length on the client.
  maxLength?: number;
  // For consent: the list of consent keys that must all be checked.
  consentKeys?: string[];
}

export const STEPS: StepDef[] = [
  // --- Welcome
  { key: 'welcome', type: 'intro' },

  // --- Section 1: who you are
  { key: 'full_name', type: 'text', required: true, maxLength: 120 },
  { key: 'email', type: 'email', required: true, maxLength: 200 },
  { key: 'phone', type: 'text', required: true, maxLength: 40 },
  { key: 'age', type: 'number', required: true },

  // --- Pause 1
  { key: 'pause_1', type: 'pause' },

  // --- Section 2: what brings you
  { key: 'why_attracted', type: 'textarea', required: true, maxLength: 2000 },
  { key: 'what_hope', type: 'textarea', required: true, maxLength: 2000 },
  {
    key: 'prior_with_jacob',
    type: 'radio',
    required: true,
    options: [
      { value: 'yes_extensive' },
      { value: 'yes_some' },
      { value: 'no' },
    ],
  },
  {
    key: 'prior_with_jacob_detail',
    type: 'textarea',
    maxLength: 1500,
    showIf: { stepKey: 'prior_with_jacob', valueIn: ['yes_extensive', 'yes_some'] },
  },

  // --- Section 3: experiential work
  {
    key: 'experiential_modalities',
    type: 'checkboxes',
    options: [
      { value: 'breathwork' },
      { value: 'constellations' },
      { value: 'somatic_experiencing' },
      { value: 'trauma_therapy' },
      { value: 'bodywork' },
      { value: 'ritual_work' },
      { value: 'plant_medicine' },
      { value: 'other' },
      { value: 'none' },
    ],
  },
  { key: 'experiential_how_was_it', type: 'textarea', maxLength: 1500 },
  {
    key: 'current_therapy',
    type: 'radio',
    required: true,
    options: [{ value: 'yes' }, { value: 'no' }],
  },
  {
    key: 'current_therapy_discipline',
    type: 'text',
    maxLength: 200,
    showIf: { stepKey: 'current_therapy', valueIn: ['yes'] },
  },
  {
    key: 'current_therapy_discussed',
    type: 'radio',
    options: [{ value: 'yes' }, { value: 'no' }, { value: 'not_yet' }],
    showIf: { stepKey: 'current_therapy', valueIn: ['yes'] },
  },

  // --- Pause 2 (gentle transition to "how are you really")
  { key: 'pause_2', type: 'pause' },

  // --- Section 4: how are you now
  {
    key: 'sleep',
    type: 'radio',
    required: true,
    options: [
      { value: 'poor' },
      { value: 'variable' },
      { value: 'okay' },
      { value: 'good' },
    ],
  },
  {
    key: 'energy',
    type: 'radio',
    required: true,
    options: [
      { value: 'exhausted' },
      { value: 'variable' },
      { value: 'manageable' },
      { value: 'good' },
    ],
  },
  {
    key: 'life_event',
    type: 'radio',
    required: true,
    options: [{ value: 'yes' }, { value: 'no' }],
  },
  {
    key: 'life_event_detail',
    type: 'textarea',
    maxLength: 1500,
    showIf: { stepKey: 'life_event', valueIn: ['yes'] },
  },
  { key: 'self_regulation', type: 'textarea', required: true, maxLength: 1500 },
  {
    key: 'medication',
    type: 'radio',
    required: true,
    options: [{ value: 'yes' }, { value: 'no' }],
  },
  {
    key: 'medication_category',
    type: 'checkboxes',
    options: [
      { value: 'antidepressant' },
      { value: 'sleep' },
      { value: 'antipsychotic' },
      { value: 'mood_stabilizer' },
      { value: 'other' },
    ],
    showIf: { stepKey: 'medication', valueIn: ['yes'] },
  },
  {
    key: 'substances',
    type: 'radio',
    required: true,
    options: [
      { value: 'no' },
      { value: 'sometimes' },
      { value: 'yes' },
    ],
  },

  // --- Section 5: history
  {
    key: 'trauma_history',
    type: 'radio',
    required: true,
    options: [
      { value: 'none' },
      { value: 'mild' },
      { value: 'stabilized' },
      { value: 'active' },
    ],
  },
  {
    key: 'dissociation',
    type: 'radio',
    required: true,
    options: [
      { value: 'never' },
      { value: 'past_sometimes' },
      { value: 'recent' },
      { value: 'regular' },
    ],
  },
  {
    key: 'diagnoses',
    type: 'checkboxes',
    options: [
      { value: 'ptsd' },
      { value: 'cptsd' },
      { value: 'dissociative' },
      { value: 'psychosis' },
      { value: 'bipolar' },
      { value: 'borderline' },
      { value: 'severe_depression' },
      { value: 'eating_disorder' },
      { value: 'addiction' },
      { value: 'none' },
      { value: 'prefer_not_to_say' },
    ],
  },
  {
    key: 'suicidality',
    type: 'radio',
    required: true,
    options: [
      { value: 'no' },
      { value: 'transient' },
      { value: 'regular' },
    ],
  },

  // --- Section 6: practical
  {
    key: 'support_network',
    type: 'radio',
    required: true,
    options: [
      { value: 'yes' },
      { value: 'not_really' },
      { value: 'unsure' },
    ],
  },
  { key: 'physical_notes', type: 'textarea', maxLength: 1500 },
  { key: 'anything_else', type: 'textarea', maxLength: 2000 },

  // --- Section 7: consent (submit happens from this step)
  {
    key: 'consent',
    type: 'consent',
    required: true,
    consentKeys: ['consent_not_therapy', 'consent_facilitator_right', 'consent_data'],
  },
];
