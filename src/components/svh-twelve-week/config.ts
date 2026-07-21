// =========================================================
// Somatic Vocal Healing — 12-Week Course (English landing)
// Shared link targets for the page. Pricing and the registration
// flow live in the email-gated module (TWRegister) and its API
// endpoints (/api/courses/twelve-week-status + -checkout), with
// the price table in src/lib/courses/twelve-week.ts.
// =========================================================

// On-page anchor for the registration section. The nav + mid-page CTAs scroll
// here (keeping people on the page); the section carries the email-gated,
// Stripe-backed enrolment form.
export const REGISTER_ANCHOR = '#register';

// Secondary CTA — sit in on a live Vocal Healing Session first, 22€.
export const SESSION_URL = '/workshop';

// Practitioner path — the live, deepening training after the 12 weeks.
export const PRACTITIONER_URL = '/courses/certification';

// Verified reviews.
export const TRUSTPILOT_URL = 'https://www.trustpilot.com/review/songdance.co';
