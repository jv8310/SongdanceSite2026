// The 30-day money-back guarantee — single source of truth.
//
// A voluntary promise SONGDANCE makes on its self-paced online courses, on top
// of the statutory 14-day right of withdrawal (see Article 8.4.2 / Article 14
// of docs terms, rendered in src/pages/terms.astro). Keep the words here in
// sync with those articles: the guarantee is factual, not an outcome promise,
// and it EXTENDS the statutory right — it never limits or replaces it.
//
// Copy note (docs/svh-copy-book.md): a money-back guarantee is marketing
// mechanics, a craft the copy book explicitly leaves free — but the voice still
// applies. Plain, warm, a little dry. No rescue framing, no "your money back if
// it doesn't heal you" outcome promise: the promise is about FIT, not results.
//
// Consumed by the on-page badge (src/components/GuaranteeBadge.astro), the
// email note (src/lib/workshops/email-design.ts → guaranteeNote), and the
// Terms page. One edit here changes the number everywhere.

export const GUARANTEE_DAYS = 30;

// The statutory floor the guarantee sits on top of (EU distance-selling right
// of withdrawal). Named in the copy so the "extends the law" framing is honest.
export const STATUTORY_WITHDRAWAL_DAYS = 14;

export const GUARANTEE_EMAIL = 'info@songdance.co';

export const guarantee = {
  days: GUARANTEE_DAYS,

  // The title / label — used as the seal caption and headings.
  title: `${GUARANTEE_DAYS}-day money-back guarantee`,

  // A single warm line for compact spots (near a CTA, an email footnote).
  line: `Take the full ${GUARANTEE_DAYS} days. If the course isn’t for you, write to us for a full refund.`,

  // A short paragraph for the on-page card / offer boxes.
  blurb: `Give the course a real try. If within ${GUARANTEE_DAYS} days it isn’t for you, email us and we’ll refund you in full — no forms to fill, no reason required.`,

  // The same, with the honest legal note that it goes beyond the statutory right.
  blurbLong: `Give the course a real try. If within ${GUARANTEE_DAYS} days you decide it isn’t your path, write to us and we’ll refund you in full — no forms, no reason required. That’s well beyond the ${STATUTORY_WITHDRAWAL_DAYS}-day right of withdrawal the law provides; we’d rather you decide from the inside.`,

  // For FAQ lists (TWFaq, and any course FAQ).
  faq: {
    q: 'Is there a money-back guarantee?',
    a: `Yes — a ${GUARANTEE_DAYS}-day money-back guarantee. Give the course a genuine try; if within ${GUARANTEE_DAYS} days you decide it isn’t for you, write to ${GUARANTEE_EMAIL} and we’ll refund you in full. That’s well beyond the ${STATUTORY_WITHDRAWAL_DAYS}-day right of withdrawal the law provides — we’d rather you decide from the inside.`,
  },

  email: GUARANTEE_EMAIL,
} as const;

export type Guarantee = typeof guarantee;
