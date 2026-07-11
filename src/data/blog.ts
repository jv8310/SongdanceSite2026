// Single source of truth for the Journal (blog). Each article lives in its own
// bespoke page under src/pages/blog/<slug>.astro; this list is the metadata the
// index (/blog) renders from and the place other pages cross-link to. Add an
// article = add its page + one entry here. The index shows them oldest → newest
// by `date`; entries that share a date fall back to this array's order, so keep
// the array itself in chronological (oldest-first) order.

export interface BlogPost {
  slug: string;
  /** Canonical path, e.g. /blog/before-there-was-upala */
  href: string;
  title: string;
  /** One or two sentences for the index card + social/meta description. */
  excerpt: string;
  /** ISO date (YYYY-MM-DD) — used for sorting and <time>. */
  date: string;
  /** Human label shown on the page + card, e.g. "1 July 2026". */
  dateLabel: string;
  /** Public /media path for the hero + index thumbnail + OG image. */
  hero: string;
  heroAlt: string;
  /** Rough reading time in minutes, shown in the byline. */
  readingMinutes: number;
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'before-there-was-upala',
    href: '/blog/before-there-was-upala',
    title: 'Before any of this, there was Upala',
    excerpt:
      'How the Authentic Singing Journey began — with no money, a borrowed year, and the voice of the person who started it all.',
    date: '2026-07-01',
    dateLabel: '1 July 2026',
    hero: '/media/library/jacob-upala-speaker.webp',
    heroAlt: 'Jacob and Upala together at golden hour, mid-song, on a rooftop.',
    readingMinutes: 3,
  },
  {
    slug: 'the-story-wasnt-over',
    href: '/blog/the-story-wasnt-over',
    title: "The story wasn't over",
    excerpt:
      'What came after the Authentic Singing Journey — losing the thread, finding it again, and the two journeys that followed. At the heart of the movement journey: the way Upala moved.',
    date: '2026-07-07',
    dateLabel: '7 July 2026',
    hero: '/media/library/jacob-jumps.webp',
    heroAlt: 'Jacob leaping beside a mountain river at golden hour, arms flung wide.',
    readingMinutes: 3,
  },
  {
    slug: 'the-part-ive-never-told',
    href: '/blog/the-part-ive-never-told',
    title: "The part I've never told",
    excerpt:
      "The chapter about Upala I've kept mostly to myself — her longing for something freer, the loss, and the Grief Course that grew from meeting grief in the body, through sound.",
    date: '2026-07-07',
    dateLabel: '7 July 2026',
    hero: '/media/library/upala-on-rock.webp',
    heroAlt: 'Upala sounding, barefoot on a rock by a mountain river.',
    readingMinutes: 4,
  },
  {
    slug: 'the-birth-of-somatic-sounding',
    href: '/blog/the-birth-of-somatic-sounding',
    title: 'The birth of somatic sounding',
    excerpt:
      'The last chapter — grieving out loud after Upala, and the practice that grew from it: making the sound of what the body holds. How Somatic Vocal Healing was born.',
    date: '2026-07-11',
    dateLabel: '11 July 2026',
    hero: '/media/library/svh-retreat-sounding-jacob-sunset.webp',
    heroAlt: 'Jacob with his hands on his heart, sounding at golden hour.',
    readingMinutes: 5,
  },
];

// Oldest first — the reading order the Journal index uses (part one → the latest
// chapter). Stable sort, so posts sharing a date keep the chronological order of
// the array above.
export const blogPostsByDateAsc: BlogPost[] = [...blogPosts].sort((a, b) =>
  a.date.localeCompare(b.date),
);

export function findPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
