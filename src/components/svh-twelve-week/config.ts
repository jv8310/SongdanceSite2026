// =========================================================
// Somatic Vocal Healing — 12-Week Course (English landing)
// Shared, load-bearing values for the bespoke landing page.
// Kept in one place so the two items the copy brief flags as
// [CONFIRM] — the price and the enrolment URL — have a single
// source of truth and are trivial to finalise.
// =========================================================

// Where the "Register" / "Begin" buttons send the buyer.
//
// TODO(confirm): the brief specifies enrolment runs through Mighty Network.
// Swap ENROLL_URL for the exact Mighty Network checkout URL once confirmed.
// Until then it points at the site's existing course-intake listing so the
// primary CTA always resolves to a real page (never a 404).
export const ENROLL_URL = '/events?filter=course';

// On-page anchor for the registration section. The nav + mid-page CTAs scroll
// here (keeping people on the page); the section itself carries ENROLL_URL.
export const REGISTER_ANCHOR = '#register';

// Secondary CTA — sit in on a live Vocal Healing Session first, 9€.
export const SESSION_URL = '/workshop';

// Practitioner path — the live, deepening training after the 12 weeks.
export const PRACTITIONER_URL = '/certification-course';

// Verified reviews.
export const TRUSTPILOT_URL = 'https://www.trustpilot.com/review/songdance.co';

// Price.
//
// TODO(confirm): the brief leaves [CONFIRM price]. The old page never stated a
// flat number — only "three monthly installments". Until a number is decided,
// PRICE stays null and the page shows the honest installments-and-lifetime
// framing (no invented figure). Set PRICE to a string like '€1,200' to show it.
export const PRICE: string | null = null;

// Whether three-monthly-installment paying is offered (it is — per the brief).
export const INSTALLMENTS = true;
