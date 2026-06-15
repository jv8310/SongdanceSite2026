// The Somatic Rising data room — the research + memo behind the concept.
// Source markdown lives in src/data/sr26/<file>; these entries drive the
// docs hub (/sr26/docs) and the per-doc renderer (/sr26/docs/[slug]).
// `order` controls listing order; the markdown files supply their own titles.

export interface Sr26Doc {
  slug: string;
  file: string; // basename in src/data/sr26/
  title: string;
  blurb: string;
  kind: string;
  order: number;
}

export const SR26_DOCS: Sr26Doc[] = [
  {
    slug: 'investor-memo',
    file: 'investor-memo.md',
    title: 'Investor Memorandum',
    blurb:
      'The thesis, the product loop, the moat, and the €900K seed raise — the whole story in one read.',
    kind: 'Memo · Seed round',
    order: 1,
  },
  {
    slug: 'market-research',
    file: 'market-research.md',
    title: 'Market Research Report',
    blurb:
      'TAM, SAM, growth rates and the cultural undercurrents — the meaning crisis, loneliness, and the somatic mainstreaming driving demand.',
    kind: 'Research · Market intelligence',
    order: 2,
  },
  {
    slug: 'competitive-landscape',
    file: 'competitive-landscape.md',
    title: 'Competitive Landscape',
    blurb:
      '40+ wellness, meditation, AI-coaching and somatic apps mapped — and the whitespace none of them fills.',
    kind: 'Research · Competitors',
    order: 3,
  },
  {
    slug: 'funding-unit-economics',
    file: 'funding-unit-economics.md',
    title: 'Funding & Unit Economics',
    blurb:
      'Round sizes, instruments, the investors who write these cheques, and the retention/CAC/LTV benchmarks that decide it.',
    kind: 'Research · Funding & economics',
    order: 4,
  },
];

export function getSr26Doc(slug: string): Sr26Doc | undefined {
  return SR26_DOCS.find((d) => d.slug === slug);
}

export const SR26_DOCS_SORTED = [...SR26_DOCS].sort((a, b) => a.order - b.order);
