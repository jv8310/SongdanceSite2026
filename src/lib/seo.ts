// Structured-data (JSON-LD) helpers — one place to build the schema.org
// objects the site emits, so their shape stays consistent across pages.
//
// Pure data. Rendering is a tiny `<script type="application/ld+json">` in the
// layout or page (the house pattern — see what-is-svh / songdeck). Everything
// here is import-type only, so importing these helpers pulls no runtime weight
// into the page bundle.
import type { EventCard, EventStatus } from './events/db';

export const SITE_URL = 'https://songdance.co';
export const SITE_NAME = 'Songdance';

// Social profiles — the `sameAs` edges that let search + AI answer engines
// resolve "Songdance" as one entity. Mirror of the footer links.
const SAME_AS = [
  'https://www.instagram.com/songdance.co',
  'https://www.youtube.com/channel/UCR9lQ2A8DkZs9noxoqEU6fQ',
  'https://facebook.com/yoursongdance/',
  'https://open.spotify.com/artist/4cHGmAtI025Fzsmnrc9ehT',
];

/** Resolve a site-relative path (or pass through an absolute URL) to absolute. */
export function abs(path: string): string {
  return path.startsWith('http') ? path : new URL(path, SITE_URL).href;
}

// Pull a price + currency out of a free-text label like "9€", "€99",
// "From €49 · live". Returns null when there's no number to show.
function parsePrice(raw: string | null | undefined): { price: string; currency: string } | null {
  if (!raw) return null;
  const m = raw.replace(/\s/g, '').match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const price = m[1].replace(',', '.');
  const currency = /£/.test(raw) ? 'GBP' : /\$/.test(raw) ? 'USD' : 'EUR';
  return { price, currency };
}

const AVAILABILITY: Record<EventStatus, string> = {
  open: 'https://schema.org/InStock',
  waitlist: 'https://schema.org/LimitedAvailability',
  closed: 'https://schema.org/SoldOut',
};

// Sitewide Organization. Feeds Google's entity graph (logo, socials, address)
// and gives AI answer engines a stable "what is Songdance" anchor. Rendered in
// the base layout, so it appears on every page.
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: abs('/brand/logo-wordmark-dark.png'),
    description:
      "Somatic Vocal Healing — the honest sound of what you feel, made out loud until it's been heard.",
    founder: { '@type': 'Person', name: 'Jacob' },
    sameAs: SAME_AS,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Beaupréstraat 13',
      postalCode: '8310',
      addressLocality: 'Brugge',
      addressCountry: 'BE',
    },
  };
}

// One Event (schema.org) from a calendar card. Online + course events are
// virtual; retreats are physical. Booking status maps onto offer availability.
// Returns null for undated/anytime cards — a schema Event needs a start date.
export function eventSchema(card: EventCard): Record<string, unknown> | null {
  if (!card.startDate) return null;
  const online = card.category !== 'retreat';

  const ev: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: card.title,
    startDate: card.startDate,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: online
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    organizer: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    location: online
      ? { '@type': 'VirtualLocation', url: card.href ? abs(card.href) : SITE_URL }
      : {
          '@type': 'Place',
          name: card.location ?? 'Retreat venue',
          ...(card.location ? { address: card.location } : {}),
        },
  };

  if (card.endDate) ev.endDate = card.endDate;
  if (card.href) ev.url = abs(card.href);
  if (card.imageUrl) ev.image = abs(card.imageUrl);
  if (card.summary) ev.description = card.summary;
  if (card.facilitators.length) {
    ev.performer = card.facilitators.map((name) => ({ '@type': 'Person', name }));
  }

  const p = parsePrice(card.price);
  if (p) {
    ev.offers = {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: p.currency,
      availability: AVAILABILITY[card.status],
      ...(card.href ? { url: abs(card.href) } : {}),
    };
  }

  return ev;
}

/** Array of Event JSON-LD for the events grid (undated cards dropped). */
export function eventsJsonLd(cards: EventCard[]): Record<string, unknown>[] {
  return cards
    .map(eventSchema)
    .filter((e): e is Record<string, unknown> => e !== null);
}

export interface CourseSeed {
  name: string;
  description: string;
  href: string;
  price?: string | null;
}

// One Course (schema.org) — name + description + provider are the required
// trio; a parseable price becomes a paid Offer.
export function courseSchema(seed: CourseSeed): Record<string, unknown> {
  const course: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: seed.name,
    description: seed.description,
    url: abs(seed.href),
    provider: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  };
  const p = parsePrice(seed.price);
  if (p) {
    course.offers = {
      '@type': 'Offer',
      category: 'Paid',
      price: p.price,
      priceCurrency: p.currency,
    };
  }
  return course;
}

/** Array of Course JSON-LD for the courses index. */
export function coursesJsonLd(seeds: CourseSeed[]): Record<string, unknown>[] {
  return seeds.map(courseSchema);
}
