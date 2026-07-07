// Single source of truth for the Journal (blog). Each article lives in its own
// bespoke page under src/pages/blog/<slug>.astro; this list is the metadata the
// index (/blog) renders from and the place other pages cross-link to. Add an
// article = add its page + one entry here (newest first is handled by sorting
// on `date`, so order in the array doesn't matter).

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
];

// Newest first — the order the index and any "latest" listings should use.
export const blogPostsByDate: BlogPost[] = [...blogPosts].sort((a, b) =>
  b.date.localeCompare(a.date),
);

export function findPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
