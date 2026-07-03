// Abandoned-cart nudges for the considered-purchase courses. The 5-minute cron
// (see src/lib/workshops/cron.ts → runCourseAbandonedCheckouts) sends the same
// two-touch pair the workshops use, but for course checkouts that reached Stripe
// and never paid.
//
// Only the thematic CourseProductSlug courses are nudged — the flagship,
// multi-step, email-gated buys where a recovery email is worth the send. The
// low-price impulse journeys (JourneySlug: asj/mmj/inner-child/…) are
// intentionally left out: their checkout is a single step with no email gate.
//
// Course rows carry no access token, so "resume" is the course page with an
// ?email= prefill — the same link the post-workshop emails use, which reveals
// the person's price and fills the register form. #register scrolls to it.

export type AbandonedCourseMeta = { path: string; name: string };

// product_slug → { landing path, human name for the copy }. Keys are the
// thematic CourseProductSlug values (see ./db). cc-bundle shares the cert page.
export const ABANDONED_COURSES: Record<string, AbandonedCourseMeta> = {
  'svh-12week': { path: '/courses/12-week', name: 'the 12-Week Somatic Vocal Healing Course' },
  'cc-cert': { path: '/courses/certification', name: 'the Somatic Vocal Healing Certification' },
  'cc-bundle': { path: '/courses/certification', name: 'the Somatic Vocal Healing Certification' },
  'grief-course': { path: '/courses/grief', name: 'the Grief Course' },
};

// The slugs we nudge — for the SQL IN (…) filter in the cron.
export const ABANDONED_COURSE_SLUGS = Object.keys(ABANDONED_COURSES);

export function abandonedCourseMeta(slug: string): AbandonedCourseMeta | null {
  return ABANDONED_COURSES[slug] ?? null;
}

// The resume link for an abandoned course checkout: the course landing page with
// the buyer's email prefilled, scrolled to the register form. Returns null for a
// slug we don't nudge (a journey), so the caller can skip it.
export function courseResumeUrl(base: string, slug: string, email: string): string | null {
  const meta = abandonedCourseMeta(slug);
  if (!meta) return null;
  return `${base.replace(/\/$/, '')}${meta.path}?email=${encodeURIComponent(email)}#register`;
}
