// Single source of truth for the SVH Certification Course class schedule
// and the CEEE deepening session schedule. Imported by the date-aware
// grid components (CCClasses, CCCeee) and by the variant-gate API when it
// needs to report the "next upcoming" class to a returning student.
//
// All ISO datetimes carry an explicit offset (CET = +01:00, CEST = +02:00)
// so the date logic works the same on the server and the client.

export type ScheduledItem = {
  number: number;
  title?: string;
  description?: string;
  datetime: string | null;       // ISO 8601 with explicit offset, or null for TBC
  durationMinutes?: number;
  timeLabel?: string;            // human label, e.g. "7:00pm CEST"
  monthLabel?: string;           // used when datetime is null
};

export const SVH_CERT_CLASSES: ScheduledItem[] = [
  {
    number: 1,
    title: 'A Healing Journey',
    description:
      'The architecture of a session. Mapping, the journey, and the rare transpersonal layer. Sounding vs. singing. Why we welcome the imperfections.',
    datetime: '2026-01-30T19:00:00+01:00',
    durationMinutes: 120,
    timeLabel: '7:00pm CET',
  },
  {
    number: 2,
    title: 'Receiving Information from Sound',
    description:
      'The art of listening. Context and the relational field. Shadow, fixation, and projection. Ego tears vs. authentic grief. Self-care after deep work.',
    datetime: '2026-02-22T19:00:00+01:00',
    durationMinutes: 120,
    timeLabel: '7:00pm CET',
  },
  {
    number: 3,
    title: 'Emotional Expertise: Grief & Pain',
    description:
      'A deep dive into the core emotions, with grief and pain at the centre. Why grief oscillates and pain does not. How to hold space for each — and when one is hiding the other.',
    datetime: '2026-03-25T09:30:00+01:00',
    durationMinutes: 120,
    timeLabel: '9:30am CET',
  },
  {
    number: 4,
    title: 'Shock & Disease Causality',
    description:
      "A different way of looking at how the body responds to life. The phenomenon of shock as a primary feeling. How to work with shock through sounding — and where the responsible practitioner draws a clear line. Held with care; offered as inquiry, not medicine.",
    datetime: '2026-04-19T19:00:00+02:00',
    durationMinutes: 120,
    timeLabel: '7:00pm CEST',
  },
  {
    number: 5,
    title: 'The ABC of Healing: Working with the Layers',
    description:
      'The ABC framework — the child, the child grown to adult, and the now. How to untangle compassion and anger toward a parent. How to give back what does not belong with you. Templates for systemic and family constellation work woven into a sounding session.',
    datetime: '2026-05-26T19:00:00+02:00',
    durationMinutes: 120,
    timeLabel: '7:00pm CEST',
  },
  {
    number: 6,
    title: 'Therapeutic Foundations',
    description:
      'Safe and responsible facilitation. Space holding. The volume button, co-regulation, and what to do when a client goes into overwhelm. The ethical container of the work.',
    datetime: '2026-06-28T19:00:00+02:00',
    durationMinutes: 120,
    timeLabel: '7:00pm CEST',
  },
  {
    number: 7,
    title: 'Healing Templates',
    description:
      "Practical templates for working with the most common patterns clients bring. Inner-child work, ancestral work, working with the body's signals.",
    datetime: '2026-07-08T09:30:00+02:00',
    durationMinutes: 120,
    timeLabel: '9:30am CEST',
  },
  {
    number: 8,
    title: 'Supervised Practice',
    description:
      'Students lead sessions in front of the group and receive direct feedback from Jacob and Karen. This is where the work becomes real.',
    datetime: '2026-09-06T19:00:00+02:00',
    durationMinutes: 120,
    timeLabel: '7:00pm CEST',
  },
  {
    number: 9,
    title: 'Integration & Certification',
    description:
      'Bringing it all together. Reflection, integration, next steps — and the door to becoming a certified practitioner.',
    datetime: '2026-10-04T19:00:00+02:00',
    durationMinutes: 120,
    timeLabel: '7:00pm CEST',
  },
];

export const SVH_CEEE_SESSIONS: ScheduledItem[] = [
  { number: 6, datetime: '2026-06-16T19:00:00+02:00', durationMinutes: 120, timeLabel: '7:00pm CEST' },
  { number: 7, datetime: '2026-07-22T19:00:00+02:00', durationMinutes: 120, timeLabel: '7:00pm CEST' },
  { number: 8, datetime: '2026-08-24T19:00:00+02:00', durationMinutes: 120, timeLabel: '7:00pm CEST' },
  { number: 9, datetime: '2026-09-25T19:00:00+02:00', durationMinutes: 120, timeLabel: '7:00pm CEST' },
  { number: 10, datetime: null, monthLabel: 'October 2026' },
  { number: 11, datetime: null, monthLabel: 'November 2026' },
  { number: 12, datetime: null, monthLabel: 'December 2026' },
];

export type CardState =
  | 'past'
  | 'live'
  | 'almost-live'
  | 'tomorrow'
  | 'upcoming'
  | 'tbc';

export function computeCardState(item: ScheduledItem, now: Date = new Date()): CardState {
  if (!item.datetime) return 'tbc';
  const start = new Date(item.datetime);
  const end = new Date(start.getTime() + (item.durationMinutes ?? 120) * 60_000);
  const oneHourBefore = new Date(start.getTime() - 60 * 60_000);
  const twentyFourBefore = new Date(start.getTime() - 24 * 60 * 60_000);

  if (now >= start && now < end) return 'live';
  if (now >= oneHourBefore && now < start) return 'almost-live';
  if (now >= twentyFourBefore && now < oneHourBefore) return 'tomorrow';
  if (now >= end) return 'past';
  return 'upcoming';
}

export function getNextUpcoming(
  items: ScheduledItem[],
  now: Date = new Date(),
): ScheduledItem | null {
  const active = items.filter((it) => {
    const s = computeCardState(it, now);
    return s === 'live' || s === 'almost-live' || s === 'tomorrow' || s === 'upcoming';
  });
  active.sort((a, b) => {
    const ad = a.datetime ? new Date(a.datetime).getTime() : Infinity;
    const bd = b.datetime ? new Date(b.datetime).getTime() : Infinity;
    return ad - bd;
  });
  return active[0] ?? null;
}

export function formatDateLabel(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
