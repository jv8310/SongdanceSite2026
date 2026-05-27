// Registry of retreats that have an intake. The `code` is what arrives
// in the URL (?event=<code>); the labels are shown back to the deelnemer
// in their language and embedded in the Claude assessment so the
// assessor knows which container we're vetting for.
//
// To add a new retreat: append an entry here and (optionally) tune the
// `flavour` field — short notes appended to the assessment system prompt
// so Claude knows the specific container's intensity profile.

export type EventCode = string;

export interface EventDefinition {
  code: EventCode;
  label: { nl: string; en: string };
  // 1–2 lines that ground the assessor about THIS specific container.
  flavour: string;
}

export const EVENTS: Record<EventCode, EventDefinition> = {
  klankopstellingen2026: {
    code: 'klankopstellingen2026',
    label: {
      nl: 'Klankopstellingen 2026',
      en: 'Sound Constellations 2026',
    },
    flavour:
      'Klankopstellingen: meerdaags groepswerk waarin stem, klank en opstellingsvormen samen het zenuwstelsel diep aanspreken. Ancestraal materiaal komt vaak in beweging. Intensiteit: hoog. Groep ~12.',
  },
  'svh-retreat-2026': {
    code: 'svh-retreat-2026',
    label: {
      nl: 'Somatic Vocal Healing Retreat 2026',
      en: 'Somatic Vocal Healing Retreat 2026',
    },
    flavour:
      'Meerdaagse SVH retreat met intentionele stem en klank op het zenuwstelsel. Diepe somatische lagen mogelijk. Intensiteit: hoog.',
  },
  'ritual-of-belonging-2026': {
    code: 'ritual-of-belonging-2026',
    label: {
      nl: 'Ritual of Belonging 2026',
      en: 'Ritual of Belonging 2026',
    },
    flavour:
      'Ritueel groepswerk rond verbondenheid en behoren. Werkt met ancestraal en relationeel materiaal. Intensiteit: medium-hoog.',
  },
  'certification-course-2026': {
    code: 'certification-course-2026',
    label: {
      nl: 'SVH Certification Course 2026',
      en: 'SVH Certification Course 2026',
    },
    flavour:
      'Beroepsopleiding over een jaar — combinatie van persoonlijk werk en facilitatieleren. Beoordeling kijkt zowel naar deelnemersgeschiktheid als naar bredere stabiliteit voor een jaarlang traject.',
  },
};

const FALLBACK_LABEL: EventDefinition['label'] = {
  nl: 'Songdance Retreat',
  en: 'Songdance Retreat',
};

export function resolveEvent(code: string | null | undefined): EventDefinition {
  const trimmed = (code ?? '').trim();
  if (trimmed && Object.prototype.hasOwnProperty.call(EVENTS, trimmed)) {
    return EVENTS[trimmed];
  }
  return {
    code: trimmed || 'unknown',
    label: FALLBACK_LABEL,
    flavour:
      'Onbekend event-code. Beoordeel met algemene SVH-zorgvuldigheid; flag de onbekende route in de samenvatting.',
  };
}

export function isKnownEvent(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVENTS, code);
}
