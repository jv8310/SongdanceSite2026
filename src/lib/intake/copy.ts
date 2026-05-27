// All deelnemer-facing copy for the intake form, in NL and EN.
//
// Structure: COPY[locale].steps[<stepKey>] = { title, body?, placeholder?, options? }
// Plus a few shared strings (buttons, progress, errors).

export type Locale = 'nl' | 'en';

export const LOCALES: Locale[] = ['nl', 'en'];

export function resolveLocale(input: string | null | undefined): Locale {
  const lc = (input ?? '').toLowerCase().trim();
  if (lc === 'en') return 'en';
  return 'nl';
}

export interface StepCopy {
  // Big heading (or null on minimal screens).
  title?: string;
  // Intro / instructional paragraph.
  body?: string;
  // Placeholder for text/textarea inputs.
  placeholder?: string;
  // Micro-text shown beneath sensitive questions.
  microNote?: string;
  // Label-per-value map for radios / checkboxes.
  options?: Record<string, string>;
  // For consent screens: text per consent key.
  consents?: Record<string, string>;
  // Optional secondary label (e.g. for the number unit).
  hint?: string;
}

export interface SharedCopy {
  brand: string;
  navHome: string;
  langSwitchTo: string; // label of the OTHER language
  progressOf: (current: number, total: number) => string;
  next: string;
  back: string;
  submit: string;
  required: string;
  emailInvalid: string;
  numberInvalid: string;
  selectOne: string;
  consentRequired: string;
  submittingTitle: string;
  submittingBody: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
  forEventLabel: string;
  optional: string;
  // Crisis micro-note used near suicidality / dissociation questions.
  crisisNote: string;
}

export const SHARED: Record<Locale, SharedCopy> = {
  nl: {
    brand: 'Songdance',
    navHome: 'Naar songdance.co',
    langSwitchTo: 'EN',
    progressOf: (a, b) => `${a} van ${b}`,
    next: 'Verder',
    back: 'Terug',
    submit: 'Verzenden',
    required: 'Dit veld is nodig om verder te kunnen.',
    emailInvalid: 'Dat ziet er nog niet als een e-mailadres uit.',
    numberInvalid: 'Vul alsjeblieft een getal in.',
    selectOne: 'Kies één antwoord.',
    consentRequired: 'Vink elk vakje aan om te bevestigen.',
    submittingTitle: 'Aan het verzenden…',
    submittingBody: 'Even geduld. We lezen je antwoorden met zorg.',
    errorTitle: 'Iets liep niet helemaal goed',
    errorBody:
      'Je antwoorden zijn niet binnengekomen. Probeer het opnieuw — of stuur ze direct naar jacob@songdance.co.',
    errorRetry: 'Opnieuw proberen',
    forEventLabel: 'Intake voor',
    optional: '(optioneel)',
    crisisNote:
      'Als deze vraag iets in beweging brengt en je wil nu met iemand spreken: in Nederland bereik je 113 Zelfmoordpreventie op 0800-0113 (gratis, 24/7). In België: Zelfmoordlijn 1813.',
  },
  en: {
    brand: 'Songdance',
    navHome: 'To songdance.co',
    langSwitchTo: 'NL',
    progressOf: (a, b) => `${a} of ${b}`,
    next: 'Continue',
    back: 'Back',
    submit: 'Send',
    required: 'This one is needed before we can continue.',
    emailInvalid: 'That doesn’t look like an email address yet.',
    numberInvalid: 'Please enter a number.',
    selectOne: 'Choose one answer.',
    consentRequired: 'Please tick each box to confirm.',
    submittingTitle: 'Sending…',
    submittingBody: 'One moment. We read what you share with care.',
    errorTitle: 'Something didn’t go through',
    errorBody:
      'Your answers didn’t reach us. Try again — or write directly to jacob@songdance.co.',
    errorRetry: 'Try again',
    forEventLabel: 'Intake for',
    optional: '(optional)',
    crisisNote:
      'If reading this stirs something and you want to talk now: in the US/Canada call or text 988. In the UK, Samaritans at 116 123. In the EU, the European emergency number 112 can route you to mental-health support.',
  },
};

// ---------- NL step copy ----------
const NL: Record<string, StepCopy> = {
  welcome: {
    title: 'Voor we beginnen.',
    body:
      'Dit formulier is een eerste kennismaking. We vragen je een aantal dingen om goed te kunnen dragen wat je meebrengt.\n\nNeem je tijd. Sommige vragen mogen even landen voor je antwoordt. Er is geen goed of fout.\n\nReken op ongeveer vijftien minuten.',
  },

  full_name: {
    title: 'Hoe heet je?',
    placeholder: 'Voor- en achternaam',
  },
  email: {
    title: 'Op welk e-mailadres mogen we je antwoorden?',
    placeholder: 'jij@voorbeeld.nl',
  },
  phone: {
    title: 'Op welk telefoonnummer kunnen we je bereiken?',
    placeholder: '+31 6 …',
  },
  age: {
    title: 'Wat is je leeftijd?',
    hint: 'jaar',
  },

  pause_1: {
    title: 'Adempauze.',
    body:
      'Voel even hoe je hier zit. Voeten op de grond. Een ademhaling die mag uitstromen.\n\nKlaar?',
  },

  why_attracted: {
    title: 'Wat trekt je aan in deze retreat?',
    body: 'Schrijf vanuit wat er bij je opkomt — niet vanuit wat goed klinkt.',
    placeholder: 'Wat trok jouw aandacht? Wat resoneerde?',
  },
  what_hope: {
    title: 'Wat hoop je dat er kan bewegen of helen in deze dagen?',
    placeholder: 'Geen perfect antwoord nodig. Een tastend antwoord is welkom.',
  },
  prior_with_jacob: {
    title:
      'Heb je eerder met Klankopstellingen, Somatic Vocal Healing of een ander werk van Jacob gewerkt?',
    options: {
      yes_extensive: 'Ja, uitgebreid',
      yes_some: 'Ja, beperkt',
      no: 'Nee, dit is mijn eerste keer',
    },
  },
  prior_with_jacob_detail: {
    title: 'Wat heb je daar al uit meegenomen?',
    placeholder: 'Wat veranderde, wat zette door, wat blijft je bij…',
  },

  experiential_modalities: {
    title: 'Heb je eerder lichaamsgericht of ervaringsgericht werk gedaan?',
    body: 'Vink aan wat van toepassing is.',
    options: {
      breathwork: 'Ademwerk',
      constellations: 'Opstellingen',
      somatic_experiencing: 'Somatic Experiencing',
      trauma_therapy: 'Traumatherapie',
      bodywork: 'Lichaamswerk',
      ritual_work: 'Ritueel werk',
      plant_medicine: 'Plantmedicijn-werk',
      other: 'Iets anders',
      none: 'Geen ervaring',
    },
  },
  experiential_how_was_it: {
    title: 'Hoe was dat voor jou — wat ging makkelijk, wat was uitdagend?',
    placeholder: 'Schrijf in een paar zinnen wat naar boven komt.',
  },
  current_therapy: {
    title: 'Ben je momenteel in therapeutische of psychiatrische begeleiding?',
    options: { yes: 'Ja', no: 'Nee' },
  },
  current_therapy_discipline: {
    title: 'Bij welke discipline ongeveer?',
    placeholder:
      'Bv. psycholoog, traumatherapeut, psychiater, somatisch therapeut, ander…',
  },
  current_therapy_discussed: {
    title: 'Heb je deze retreat met je begeleider besproken?',
    options: { yes: 'Ja', no: 'Nee', not_yet: 'Nog niet' },
  },

  pause_2: {
    title: 'De volgende vragen.',
    body:
      'Wat nu komt, gaat over hoe het op dit moment écht met je gaat. Antwoord vanuit je lichaam, niet vanuit wat goed klinkt.\n\nNiets hier is op zichzelf een uitsluitingsgrond — het gaat om afstemming.',
  },

  sleep: {
    title: 'Hoe slaap je de laatste weken?',
    options: {
      poor: 'Slecht',
      variable: 'Wisselend',
      okay: 'Redelijk',
      good: 'Goed',
    },
  },
  energy: {
    title: 'Hoe is je energie de laatste weken?',
    options: {
      exhausted: 'Uitgeput',
      variable: 'Wisselend',
      manageable: 'Draaglijk',
      good: 'Goed',
    },
  },
  life_event: {
    title:
      'Is er iets ingrijpends gebeurd in je leven in de laatste zes maanden?',
    body:
      'Denk aan verlies, scheiding, ziekte, ontslag, verhuis, geboorte, of iets anders dat veel deed.',
    options: { yes: 'Ja', no: 'Nee' },
  },
  life_event_detail: {
    title: 'Wil je in een paar zinnen vertellen wat?',
    placeholder: 'Een korte aanduiding volstaat.',
  },
  self_regulation: {
    title: 'Hoe vind je momenteel rust als iets je raakt?',
    body:
      'Wat doe je, waar ga je heen, wie of wat helpt je? Beschrijf het in jouw eigen woorden.',
    placeholder:
      'Bv. wandelen, ademen, een vriend bellen, in bad, schrijven, niets — gewoon doorademen…',
  },
  medication: {
    title:
      'Gebruik je momenteel medicatie die je geestelijke toestand beïnvloedt?',
    options: { yes: 'Ja', no: 'Nee' },
  },
  medication_category: {
    title: 'Welke categorie ongeveer?',
    body: 'Geen specifieke naam of dosering nodig — alleen de categorie.',
    options: {
      antidepressant: 'Antidepressiva',
      sleep: 'Slaapmedicatie',
      antipsychotic: 'Antipsychotica',
      mood_stabilizer: 'Stemmingsstabilisatoren',
      other: 'Iets anders',
    },
  },
  substances: {
    title:
      'Drink je alcohol of gebruik je recreatieve middelen op een manier waar je zelf zorgen over hebt?',
    options: { no: 'Nee', sometimes: 'Soms', yes: 'Ja' },
  },

  trauma_history: {
    title:
      'Heb je een geschiedenis met traumatische ervaringen die je nu nog beïnvloeden?',
    options: {
      none: 'Nee',
      mild: 'Mild',
      stabilized: 'Aanwezig maar gestabiliseerd',
      active: 'Nog actief in mijn systeem',
    },
  },
  dissociation: {
    title:
      'Heb je momenten gehad van dissociatie — het gevoel buiten jezelf te staan, weg te zakken, of jezelf niet meer te voelen?',
    options: {
      never: 'Nooit',
      past_sometimes: 'Soms in het verleden',
      recent: 'Recent nog',
      regular: 'Regelmatig',
    },
  },
  diagnoses: {
    title:
      'Ben je ooit gediagnosticeerd met of behandeld voor een van het volgende?',
    body: 'Vink aan wat van toepassing is — of laat alles leeg.',
    options: {
      ptsd: 'PTSS',
      cptsd: 'Complexe PTSS',
      dissociative: 'Dissociatieve stoornis',
      psychosis: 'Psychose of psychotische episode',
      bipolar: 'Bipolaire stoornis',
      borderline: 'Borderline persoonlijkheidsstoornis',
      severe_depression: 'Ernstige depressie',
      eating_disorder: 'Eetstoornis',
      addiction: 'Verslaving',
      none: 'Geen van deze',
      prefer_not_to_say: 'Liever niet zeggen',
    },
  },
  suicidality: {
    title:
      'Heb je momenteel suïcidale gedachten of gedachten over zelfbeschadiging?',
    options: {
      no: 'Nee',
      transient: 'Soms voorbijgaand',
      regular: 'Ja, regelmatig',
    },
    microNote:
      'Als deze vraag iets in beweging brengt en je wil nu met iemand spreken: in Nederland bereik je 113 Zelfmoordpreventie op 0800-0113 (gratis, 24/7). In België: Zelfmoordlijn 1813.',
  },

  support_network: {
    title:
      'Heb je iemand in je leven die je kan opvangen na de retreat, mocht er veel in beweging komen?',
    options: {
      yes: 'Ja',
      not_really: 'Niet echt',
      unsure: 'Weet ik niet',
    },
  },
  physical_notes: {
    title: 'Is er iets fysieks dat we moeten weten?',
    body:
      'Denk aan zwangerschap, recente operatie, ernstige migraine, epilepsie, hartconditie, of iets anders.',
    placeholder: 'Laat leeg als er niets is.',
  },
  anything_else: {
    title:
      'Is er iets dat je wil dat we weten, en waar nergens naar gevraagd is?',
    placeholder: 'Schrijf wat het ook is, of laat leeg.',
  },

  consent: {
    title: 'Tot slot, drie afspraken.',
    body: 'Vink elk vakje aan om te bevestigen — daarna mag je verzenden.',
    consents: {
      consent_not_therapy:
        'Ik begrijp dat deze retreat geen vervanging is voor individuele (trauma)therapie.',
      consent_facilitator_right:
        'Ik begrijp dat Jacob en het team het recht behouden om mijn deelname uit te stellen of door te verwijzen wanneer dat zorgzamer is.',
      consent_data:
        'Ik geef toestemming dat deze informatie vertrouwelijk verwerkt wordt door Jacob en het facilitatieteam.',
    },
  },

  done: {
    title: 'Aangekomen.',
    body:
      'Je antwoorden zijn bij ons. Je hoort binnen enkele dagen van ons.',
  },
};

// ---------- EN step copy ----------
const EN: Record<string, StepCopy> = {
  welcome: {
    title: 'Before we begin.',
    body:
      'This form is a first meeting. We ask a number of things so we can hold well what you bring.\n\nTake your time. Some questions deserve a moment before you answer. There’s no right or wrong.\n\nExpect about fifteen minutes.',
  },

  full_name: {
    title: 'What’s your name?',
    placeholder: 'First and last name',
  },
  email: {
    title: 'Where can we email you?',
    placeholder: 'you@example.com',
  },
  phone: {
    title: 'What phone number can we reach you on?',
    placeholder: '+31 6 …',
  },
  age: {
    title: 'How old are you?',
    hint: 'years',
  },

  pause_1: {
    title: 'A breath.',
    body:
      'Feel how you’re sitting. Feet on the ground. A breath that may flow out.\n\nReady?',
  },

  why_attracted: {
    title: 'What draws you to this retreat?',
    body: 'Write from what arises — not from what sounds good.',
    placeholder: 'What caught your attention? What resonated?',
  },
  what_hope: {
    title: 'What do you hope might move or heal in these days?',
    placeholder: 'No perfect answer needed. A tentative one is welcome.',
  },
  prior_with_jacob: {
    title:
      'Have you worked before with Sound Constellations, Somatic Vocal Healing, or other work by Jacob?',
    options: {
      yes_extensive: 'Yes, extensively',
      yes_some: 'Yes, a little',
      no: 'No, this is my first time',
    },
  },
  prior_with_jacob_detail: {
    title: 'What did you take from it?',
    placeholder: 'What shifted, what carried on, what stays with you…',
  },

  experiential_modalities: {
    title: 'Have you done body-based or experiential work before?',
    body: 'Tick anything that applies.',
    options: {
      breathwork: 'Breathwork',
      constellations: 'Constellations',
      somatic_experiencing: 'Somatic Experiencing',
      trauma_therapy: 'Trauma therapy',
      bodywork: 'Bodywork',
      ritual_work: 'Ritual work',
      plant_medicine: 'Plant-medicine work',
      other: 'Something else',
      none: 'No experience',
    },
  },
  experiential_how_was_it: {
    title: 'How was that for you — what came easily, what was challenging?',
    placeholder: 'A few sentences. Whatever comes.',
  },
  current_therapy: {
    title: 'Are you currently in therapeutic or psychiatric care?',
    options: { yes: 'Yes', no: 'No' },
  },
  current_therapy_discipline: {
    title: 'Roughly what kind of practitioner?',
    placeholder:
      'E.g. psychologist, trauma therapist, psychiatrist, somatic therapist, other…',
  },
  current_therapy_discussed: {
    title: 'Have you discussed this retreat with them?',
    options: { yes: 'Yes', no: 'No', not_yet: 'Not yet' },
  },

  pause_2: {
    title: 'The next questions.',
    body:
      'What’s coming is about how you’re actually doing right now. Answer from your body, not from what sounds good.\n\nNothing here is an exclusion in itself — it’s about attunement.',
  },

  sleep: {
    title: 'How have you been sleeping these past weeks?',
    options: {
      poor: 'Poorly',
      variable: 'Variable',
      okay: 'Okay',
      good: 'Well',
    },
  },
  energy: {
    title: 'How is your energy these past weeks?',
    options: {
      exhausted: 'Exhausted',
      variable: 'Variable',
      manageable: 'Manageable',
      good: 'Good',
    },
  },
  life_event: {
    title: 'Has anything significant happened in your life in the last six months?',
    body:
      'Loss, separation, illness, job change, moving, birth, or something else that touched you deeply.',
    options: { yes: 'Yes', no: 'No' },
  },
  life_event_detail: {
    title: 'Would you say a few sentences about what?',
    placeholder: 'A short pointer is enough.',
  },
  self_regulation: {
    title: 'How do you find rest when something touches you?',
    body:
      'What do you do, where do you go, who or what helps? Describe it in your own words.',
    placeholder:
      'E.g. walking, breathing, calling a friend, a bath, writing, nothing — just breathing through…',
  },
  medication: {
    title: 'Are you currently taking medication that affects your mental state?',
    options: { yes: 'Yes', no: 'No' },
  },
  medication_category: {
    title: 'Roughly which category?',
    body: 'No specific name or dose needed — just the category.',
    options: {
      antidepressant: 'Antidepressants',
      sleep: 'Sleep medication',
      antipsychotic: 'Antipsychotics',
      mood_stabilizer: 'Mood stabilizers',
      other: 'Something else',
    },
  },
  substances: {
    title:
      'Do you drink alcohol or use recreational substances in a way that concerns you?',
    options: { no: 'No', sometimes: 'Sometimes', yes: 'Yes' },
  },

  trauma_history: {
    title:
      'Do you have a history of traumatic experiences that still affect you now?',
    options: {
      none: 'No',
      mild: 'Mild',
      stabilized: 'Present but stabilized',
      active: 'Still active in my system',
    },
  },
  dissociation: {
    title:
      'Have you had moments of dissociation — feeling outside yourself, slipping away, or no longer feeling yourself?',
    options: {
      never: 'Never',
      past_sometimes: 'Sometimes in the past',
      recent: 'Recently',
      regular: 'Regularly',
    },
  },
  diagnoses: {
    title: 'Have you ever been diagnosed with or treated for any of the following?',
    body: 'Tick what applies — or leave it all blank.',
    options: {
      ptsd: 'PTSD',
      cptsd: 'Complex PTSD',
      dissociative: 'Dissociative disorder',
      psychosis: 'Psychosis or psychotic episode',
      bipolar: 'Bipolar disorder',
      borderline: 'Borderline personality disorder',
      severe_depression: 'Severe depression',
      eating_disorder: 'Eating disorder',
      addiction: 'Addiction',
      none: 'None of these',
      prefer_not_to_say: 'Prefer not to say',
    },
  },
  suicidality: {
    title:
      'Are you currently having thoughts of suicide or self-harm?',
    options: {
      no: 'No',
      transient: 'Sometimes, passing',
      regular: 'Yes, regularly',
    },
    microNote:
      'If reading this stirs something and you want to talk now: in the US/Canada call or text 988. In the UK, Samaritans at 116 123. In the EU, the European emergency number 112 can route you to mental-health support.',
  },

  support_network: {
    title:
      'Do you have someone in your life who can hold you after the retreat, should much come into motion?',
    options: {
      yes: 'Yes',
      not_really: 'Not really',
      unsure: 'Unsure',
    },
  },
  physical_notes: {
    title: 'Is there anything physical we should know?',
    body:
      'Pregnancy, recent surgery, severe migraine, epilepsy, heart condition, or anything else.',
    placeholder: 'Leave blank if there’s nothing.',
  },
  anything_else: {
    title: 'Is there anything you want us to know that we haven’t asked?',
    placeholder: 'Write whatever it is, or leave blank.',
  },

  consent: {
    title: 'Finally, three agreements.',
    body: 'Tick each box to confirm — then you can send.',
    consents: {
      consent_not_therapy:
        'I understand that this retreat is not a substitute for individual (trauma) therapy.',
      consent_facilitator_right:
        'I understand that Jacob and the team reserve the right to postpone my participation or refer me elsewhere when that is more caring.',
      consent_data:
        'I consent to this information being processed confidentially by Jacob and the facilitation team.',
    },
  },

  done: {
    title: 'Arrived.',
    body:
      'Your answers are with us. You’ll hear from us within a few days.',
  },
};

export const STEP_COPY: Record<Locale, Record<string, StepCopy>> = {
  nl: NL,
  en: EN,
};

export function stepCopy(locale: Locale, key: string): StepCopy {
  return STEP_COPY[locale][key] ?? {};
}
