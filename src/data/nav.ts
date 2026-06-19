// Single source of truth for the site navigation menu. Shared by the desktop
// header dropdown + mobile drawer (Nav.astro) and the floating site menu that
// landing pages surface through a hamburger (SiteMenu.astro), so the three
// renderings can never drift apart.
//
// data-sd-price opts a label into the client-side currency localization
// (PriceSync). Every priced course carries its MarketingProduct token;
// forgiveness has no price yet, so it stays untagged.
import type { MarketingProduct } from '../lib/workshops/marketing-prices';

export interface NavCourse {
  href: string;
  label: string;
  price?: MarketingProduct;
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
      { href: '/courses/masterclass', label: 'Professional Masterclass — 118€', price: 'masterclass' },
    ],
  },
  {
    title: 'Courses by Theme',
    items: [
      { href: '/courses/grief', label: 'Grief Course — €99', price: 'grief' },
      { href: '/courses/forgiveness', label: 'Forgiveness Course' },
    ],
  },
  {
    title: 'Guided Musical Journeys',
    items: [
      { href: '/courses/authentic-singing', label: 'Authentic Singing Journey — €99', price: 'asj' },
      { href: '/courses/magical-movement', label: 'Magical Movement Journey — €49', price: 'mmj' },
      { href: '/courses/inner-child', label: 'Inner Child Journey — €29', price: 'inner-child' },
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
  { href: '/access', label: 'Login / Access products' },
];

export const navCta: NavCourse = { href: '/workshop', label: 'Try a workshop — 9€', price: 'ticket' };
