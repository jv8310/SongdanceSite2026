// Transport questions — Dolphin & Sound, 1–8 November 2026 (the Nooraya,
// Sataya Bay, Red Sea).
//
// What the retreat page promises (DSPractical): guests fly into Marsa Alam
// (preferred, ~3 h to the harbour) or Hurghada (~5 h), and an airport shuttle
// brings them to the boat and back. So the shuttle needs, per person: which
// airport, when they land, the flight number — and the same for the way home.
//
// First draft, written from the retreat page. Refine it by telling Claude what
// to ask; see "Retreat intake — transport section" in CLAUDE.md.

import type { TransportQuestion, TransportSection } from '../transport';

const AIRPORT_OPTIONS = [
  {
    value: 'marsa_alam',
    label: {
      en: 'Marsa Alam (RMF) — about 3 hours to the harbour',
      nl: 'Marsa Alam (RMF) — ongeveer 3 uur naar de haven',
    },
  },
  {
    value: 'hurghada',
    label: {
      en: 'Hurghada (HRG) — about 5 hours to the harbour',
      nl: 'Hurghada (HRG) — ongeveer 5 uur naar de haven',
    },
  },
  {
    value: 'not_booked',
    label: { en: 'I haven’t booked my flight yet', nl: 'Ik heb mijn vlucht nog niet geboekt' },
  },
  {
    value: 'own_way',
    label: {
      en: 'I’ll make my own way — no shuttle needed',
      nl: 'Ik regel het zelf — geen shuttle nodig',
    },
  },
];

const FLYING = ['marsa_alam', 'hurghada'];

const questions: TransportQuestion[] = [
  {
    key: 'arrival_airport',
    type: 'radio',
    required: true,
    title: {
      en: 'Which airport are you flying into?',
      nl: 'Op welke luchthaven land je?',
    },
    body: {
      en: 'The retreat begins on Sunday 1 November.',
      nl: 'De retreat begint op zondag 1 november.',
    },
    options: AIRPORT_OPTIONS,
    column: 'Arrival airport',
  },
  {
    key: 'arrival_date',
    type: 'date',
    required: true,
    title: { en: 'On what day do you land?', nl: 'Op welke dag land je?' },
    showIf: { key: 'arrival_airport', valueIn: FLYING },
    min: '2026-10-01',
    max: '2026-11-01',
    column: 'Arrival date',
  },
  {
    key: 'arrival_time',
    type: 'time',
    required: true,
    title: { en: 'What time does your flight land?', nl: 'Hoe laat land je vlucht?' },
    body: { en: 'Local time in Egypt.', nl: 'Lokale tijd in Egypte.' },
    showIf: { key: 'arrival_airport', valueIn: FLYING },
    column: 'Arrival time',
  },
  {
    key: 'arrival_flight',
    type: 'text',
    required: true,
    title: { en: 'Your flight number?', nl: 'Je vluchtnummer?' },
    placeholder: { en: 'e.g. SM 2481', nl: 'bv. SM 2481' },
    showIf: { key: 'arrival_airport', valueIn: FLYING },
    maxLength: 40,
    column: 'Arrival flight',
  },
  {
    key: 'departure_airport',
    type: 'radio',
    required: true,
    title: {
      en: 'And going home — which airport do you fly out from?',
      nl: 'En naar huis — vanaf welke luchthaven vlieg je terug?',
    },
    body: {
      en: 'The retreat ends on Sunday 8 November.',
      nl: 'De retreat eindigt op zondag 8 november.',
    },
    options: AIRPORT_OPTIONS,
    column: 'Departure airport',
  },
  {
    key: 'departure_date',
    type: 'date',
    required: true,
    title: { en: 'On what day do you fly home?', nl: 'Op welke dag vlieg je terug?' },
    showIf: { key: 'departure_airport', valueIn: FLYING },
    min: '2026-11-08',
    max: '2026-11-30',
    column: 'Departure date',
  },
  {
    key: 'departure_time',
    type: 'time',
    required: true,
    title: { en: 'What time does your flight leave?', nl: 'Hoe laat vertrekt je vlucht?' },
    body: { en: 'Local time in Egypt.', nl: 'Lokale tijd in Egypte.' },
    showIf: { key: 'departure_airport', valueIn: FLYING },
    column: 'Departure time',
  },
  {
    key: 'departure_flight',
    type: 'text',
    required: true,
    title: { en: 'Your flight number home?', nl: 'Je vluchtnummer terug?' },
    placeholder: { en: 'e.g. SM 2482', nl: 'bv. SM 2482' },
    showIf: { key: 'departure_airport', valueIn: FLYING },
    maxLength: 40,
    column: 'Departure flight',
  },
  {
    key: 'travel_notes',
    type: 'textarea',
    title: {
      en: 'Anything else the shuttle should know?',
      nl: 'Nog iets dat de shuttle moet weten?',
    },
    body: {
      en: 'Arriving a day early, travelling with someone, extra luggage — or leave it blank.',
      nl: 'Een dag vroeger aankomen, samen reizen met iemand, extra bagage — of laat leeg.',
    },
    maxLength: 1000,
    column: 'Travel notes',
  },
];

export const DOLPHIN_AND_SOUND_2026: TransportSection = {
  why: {
    en: 'A shuttle collects everyone at the airport and brings you to the harbour, where the Nooraya is waiting — and takes you back at the end. To plan it around your flights, we need to know when you land and when you fly home.',
    nl: 'Een shuttle haalt iedereen op aan de luchthaven en brengt je naar de haven, waar de Nooraya wacht — en brengt je op het einde terug. Om die rond je vluchten te plannen, moeten we weten wanneer je landt en wanneer je terugvliegt.',
  },
  questions,
};
