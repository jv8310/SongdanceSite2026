// Transport questions — Ritual of Belonging, 27–29 November 2026 (Château
// Cortils, Blegny, near Liège).
//
// What the retreat page promises (RBPractical): anyone flying in gets help
// arranging shared taxis or shuttles with other arrivals, and people coming
// from Belgium can drive and share a car. Arrival from 14:00 on Friday, the
// retreat closes at 16:00 on Sunday. So: how are you travelling, and then
// either the arrival details (plane/train) or whether there's a seat to offer
// (car), plus when they need to leave.
//
// First draft, written from the retreat page. Refine it by telling Claude what
// to ask; see "Retreat intake — transport section" in CLAUDE.md.

import type { TransportQuestion, TransportSection } from '../transport';

const ARRIVING = ['plane', 'train'];

const questions: TransportQuestion[] = [
  {
    key: 'travel_mode',
    type: 'radio',
    required: true,
    title: {
      en: 'How are you travelling to the château?',
      nl: 'Hoe reis je naar het kasteel?',
    },
    options: [
      { value: 'car', label: { en: 'By car', nl: 'Met de auto' } },
      { value: 'plane', label: { en: 'By plane', nl: 'Met het vliegtuig' } },
      { value: 'train', label: { en: 'By train', nl: 'Met de trein' } },
      {
        value: 'other',
        label: { en: 'Another way, or not sure yet', nl: 'Anders, of nog niet zeker' },
      },
    ],
    column: 'Travelling by',
  },
  {
    key: 'car_from',
    type: 'text',
    title: { en: 'Where will you be driving from?', nl: 'Van waar vertrek je met de auto?' },
    body: {
      en: 'So we can match people who live close to each other.',
      nl: 'Zo kunnen we mensen die dicht bij elkaar wonen samenbrengen.',
    },
    placeholder: { en: 'e.g. Ghent', nl: 'bv. Gent' },
    showIf: { key: 'travel_mode', valueIn: ['car'] },
    maxLength: 120,
    column: 'Driving from',
  },
  {
    key: 'car_seats',
    type: 'radio',
    required: true,
    title: {
      en: 'Could you offer someone a lift?',
      nl: 'Kan je iemand een lift geven?',
    },
    showIf: { key: 'travel_mode', valueIn: ['car'] },
    options: [
      { value: 'one', label: { en: 'Yes — one seat', nl: 'Ja — één plaats' } },
      { value: 'two', label: { en: 'Yes — two seats', nl: 'Ja — twee plaatsen' } },
      { value: 'three_plus', label: { en: 'Yes — three or more', nl: 'Ja — drie of meer' } },
      { value: 'no', label: { en: 'No', nl: 'Nee' } },
    ],
    column: 'Seats to offer',
  },
  {
    key: 'arrival_airport',
    type: 'radio',
    required: true,
    title: { en: 'Which airport are you flying into?', nl: 'Op welke luchthaven land je?' },
    showIf: { key: 'travel_mode', valueIn: ['plane'] },
    options: [
      { value: 'brussels', label: 'Brussels (BRU)' },
      { value: 'charleroi', label: 'Brussels South Charleroi (CRL)' },
      { value: 'liege', label: 'Liège (LGG)' },
      { value: 'maastricht', label: 'Maastricht Aachen (MST)' },
      { value: 'other', label: { en: 'Another airport', nl: 'Een andere luchthaven' } },
    ],
    column: 'Airport',
  },
  {
    key: 'arrival_flight',
    type: 'text',
    title: { en: 'Your flight number?', nl: 'Je vluchtnummer?' },
    body: {
      en: 'If you’re flying into another airport, name it here too.',
      nl: 'Land je op een andere luchthaven, vermeld die hier dan ook.',
    },
    placeholder: { en: 'e.g. SN 2587', nl: 'bv. SN 2587' },
    showIf: { key: 'travel_mode', valueIn: ['plane'] },
    maxLength: 120,
    column: 'Flight',
  },
  {
    key: 'arrival_station',
    type: 'text',
    title: { en: 'Which station will you arrive at?', nl: 'In welk station kom je aan?' },
    placeholder: { en: 'e.g. Liège-Guillemins', nl: 'bv. Luik-Guillemins' },
    showIf: { key: 'travel_mode', valueIn: ['train'] },
    maxLength: 120,
    column: 'Station',
  },
  {
    key: 'arrival_date',
    type: 'date',
    required: true,
    title: { en: 'On what day do you arrive?', nl: 'Op welke dag kom je aan?' },
    body: {
      en: 'The château opens its doors on Friday 27 November from 14:00.',
      nl: 'Het kasteel opent de deuren op vrijdag 27 november vanaf 14:00.',
    },
    showIf: { key: 'travel_mode', valueIn: ARRIVING },
    min: '2026-11-20',
    max: '2026-11-27',
    column: 'Arrival date',
  },
  {
    key: 'arrival_time',
    type: 'time',
    required: true,
    title: {
      en: 'At what time does your flight land, or your train arrive?',
      nl: 'Hoe laat land je vlucht, of komt je trein aan?',
    },
    showIf: { key: 'travel_mode', valueIn: ARRIVING },
    column: 'Arrival time',
  },
  {
    key: 'departure',
    type: 'text',
    title: {
      en: 'And going home — when does your flight or train leave?',
      nl: 'En naar huis — wanneer vertrekt je vlucht of trein?',
    },
    body: {
      en: 'The retreat closes at 16:00 on Sunday 29 November.',
      nl: 'De retreat sluit op zondag 29 november om 16:00.',
    },
    placeholder: {
      en: 'e.g. Sunday 20:15, from Brussels',
      nl: 'bv. zondag 20:15, vanuit Brussel',
    },
    showIf: { key: 'travel_mode', valueIn: ARRIVING },
    maxLength: 160,
    column: 'Departure',
  },
  {
    key: 'travel_notes',
    type: 'textarea',
    title: {
      en: 'Anything else about your journey?',
      nl: 'Nog iets over je reis?',
    },
    body: {
      en: 'Travelling with someone, arriving late, needing a lift — or leave it blank.',
      nl: 'Samen reizen met iemand, later aankomen, een lift nodig — of laat leeg.',
    },
    maxLength: 1000,
    column: 'Travel notes',
  },
];

export const RITUAL_OF_BELONGING_2026: TransportSection = {
  why: {
    en: 'Château Cortils lies in the green countryside near Liège. We help arrange shared taxis for those flying in and lifts between those coming by car — so we’d like to know how you’re travelling.',
    nl: 'Kasteel Cortils ligt in het groen, vlak bij Luik. We helpen gedeelde taxi’s te regelen voor wie vliegt, en liften tussen wie met de auto komt — daarom willen we graag weten hoe je reist.',
  },
  questions,
};
