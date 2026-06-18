// Single source of truth for the site navigation menu. Shared by the desktop
// header dropdown + mobile drawer (Nav.astro) and the floating site menu that
// landing pages surface through a hamburger (SiteMenu.astro), so the three
// renderings can never drift apart.
//
// data-sd-price opts a label into the client-side currency localization
// (PriceSync) — only the workshop ticket and the masterclass carry a price token.

export interface NavCourse {
  href: string;
  label: string;
  price?: 'ticket' | 'masterclass';
}

export interface NavCourseGroup {
  title: string;
  items: NavCourse[];
}

export interface NavLink {
  href: string;
  label: string;
}

// The Courses menu — same three sections as the /courses page, so the menu
// reads as a table of contents.
export const courseMenu: NavCourseGroup[] = [
  {
    title: 'Somatic Vocal Healing',
    items: [
      { href: '/workshop', label: 'Vocal Healing Workshop — 9€', price: 'ticket' },
      { href: '/courses/12-week', label: '12-Week Course' },
      { href: '/courses/certification', label: 'Practitioner Training' },
      { href: '/courses/masterclass', label: 'Professional Masterclass — 29€', price: 'masterclass' },
    ],
  },
  {
    title: 'Courses by Theme',
    items: [
      { href: '/courses/grief', label: 'Grief Course — €99' },
      { href: '/courses/forgiveness', label: 'Forgiveness Course' },
    ],
  },
  {
    title: 'Guided Musical Journeys',
    items: [
      { href: '/courses/authentic-singing', label: 'Authentic Singing Journey — €99' },
      { href: '/courses/magical-movement', label: 'Magical Movement Journey — €49' },
      { href: '/courses/inner-child', label: 'Inner Child Journey — €29' },
    ],
  },
];

export const coursesAllHref = '/courses';

// Standalone top-level links, in display order. The Courses group is rendered
// between "What is SVH" and the rest (see the menu renderers).
export const topLink: NavLink = { href: '/what-is-svh', label: 'What is SVH' };
export const tailLinks: NavLink[] = [
  { href: '/events', label: 'Events' },
  { href: '/courses/songdeck', label: 'Songdeck' },
  { href: '/about', label: 'About' },
];

export const navCta: NavCourse = { href: '/workshop', label: 'Try a workshop — 9€', price: 'ticket' };
