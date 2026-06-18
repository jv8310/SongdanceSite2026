import type { APIRoute } from 'astro';
import { SITE_URL } from '../lib/seo';

export const prerender = false;

// Hand-rolled sitemap. A curated list (rather than @astrojs/sitemap) so we can
// include the SSR pages (/events) and exclude funnels, thanks/success, admin,
// and dev variants — and add no build-time dependency. When a new public,
// indexable page ships, add it here.
type Entry = { path: string; priority: number; changefreq: string };

const PAGES: Entry[] = [
  { path: '/', priority: 1.0, changefreq: 'weekly' },
  { path: '/what-is-svh', priority: 0.9, changefreq: 'monthly' },
  { path: '/workshop', priority: 0.9, changefreq: 'weekly' },
  { path: '/workshop/deutsch', priority: 0.7, changefreq: 'monthly' },
  { path: '/courses', priority: 0.8, changefreq: 'weekly' },
  { path: '/courses/12-week', priority: 0.8, changefreq: 'monthly' },
  { path: '/courses/12-week-de', priority: 0.6, changefreq: 'monthly' },
  { path: '/courses/certification', priority: 0.8, changefreq: 'monthly' },
  { path: '/courses/masterclass', priority: 0.7, changefreq: 'monthly' },
  { path: '/courses/grief', priority: 0.7, changefreq: 'monthly' },
  { path: '/courses/forgiveness', priority: 0.7, changefreq: 'monthly' },
  { path: '/courses/authentic-singing', priority: 0.6, changefreq: 'monthly' },
  { path: '/courses/magical-movement', priority: 0.6, changefreq: 'monthly' },
  { path: '/courses/inner-child', priority: 0.6, changefreq: 'monthly' },
  { path: '/courses/songdeck', priority: 0.7, changefreq: 'monthly' },
  { path: '/retreats/ritual-of-belonging', priority: 0.7, changefreq: 'monthly' },
  { path: '/retreats/dolphin-and-sound', priority: 0.7, changefreq: 'monthly' },
  { path: '/retreats/klankopstellingen-gent', priority: 0.6, changefreq: 'monthly' },
  { path: '/events', priority: 0.8, changefreq: 'daily' },
  { path: '/about', priority: 0.6, changefreq: 'monthly' },
  { path: '/reviews', priority: 0.6, changefreq: 'monthly' },
  { path: '/contact', priority: 0.5, changefreq: 'monthly' },
  { path: '/terms', priority: 0.3, changefreq: 'yearly' },
  { path: '/privacy', priority: 0.3, changefreq: 'yearly' },
];

export const GET: APIRoute = () => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = PAGES.map(
    (p) =>
      `  <url>\n` +
      `    <loc>${SITE_URL}${p.path}</loc>\n` +
      `    <lastmod>${lastmod}</lastmod>\n` +
      `    <changefreq>${p.changefreq}</changefreq>\n` +
      `    <priority>${p.priority.toFixed(1)}</priority>\n` +
      `  </url>`,
  ).join('\n');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urls}\n` +
    `</urlset>\n`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
