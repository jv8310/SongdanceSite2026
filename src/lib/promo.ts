// The site sale — single source of truth. It is one time-gated switch that has
// run twice: the new-site launch sale (June to 15 July 2026, every course and
// online event) and now **Black Friday to Cyber Monday 2026**. The exported
// names still say "launch": some forty call sites read them, and they mean
// "the site sale that is live now".
//
// Black Friday 2026 (Jacob, 25 Nov 2026), Friday 27 November 00:00 Brussels
// until the end of Cyber Monday (it closes Tuesday 1 December 09:00 Brussels,
// which is midnight on the US west coast, so nobody's Monday is cut short):
//   - 50% off the workshop and masterclass seat (the order bump never);
//   - 50% off the 12-week course, the certification course and the path;
//   - 20% off the live passes of 1, 3, 6 and 12 months (LIVE_PASS_PROMO_PERCENT;
//     the monthly keeps its price);
//   - nothing else: the Grief Course, the Forgiveness Course, the journeys,
//     the albums, private sessions and retreats keep their prices
//     (PROMO_INCLUDES_SIDE_COURSES).
//
// This is applied authoritatively SERVER-SIDE in every course/workshop checkout
// endpoint (so a tampered client can never under- or over-charge), and mirrored
// in the on-page price displays so what the buyer sees is what they pay.
//
// How it interacts with the existing per-product discounts:
//   - 12-week workshop discount (20%): the promo is taken as the *better* deal
//     (max), never stacked.
//   - Certification: the promo percent off the LIST/base price, floored to a
//     round price (see applyLaunchPromoToOffer in variant.ts).
//   - A hand-crafted ?discount=N / ?adiscount=N override link still wins outright
//     (it's an explicit, intentional price), so partner/bespoke links aren't
//     changed by the sale.
//
// The window is two fixed timestamps, checked with Date.now() on both server and
// client, so the sale switches itself on and off WITHOUT a rebuild: the server
// starts and stops discounting, the client starts and stops striking, and the
// banner appears and removes itself. The statically built pages (home,
// /courses) are built before the sale opens, so anything they render for it is
// rendered whenever the sale has not ENDED yet (launchPromoRenderable) and is
// shown by the browser only inside the window.

export const LAUNCH_PROMO_PERCENT = 50;

// Opens Friday 27 November 2026, 00:00 Europe/Brussels (CET = UTC+1).
export const LAUNCH_PROMO_STARTS_AT_MS = Date.parse('2026-11-27T00:00:00+01:00');

// Closes Tuesday 1 December 2026, 09:00 Brussels = Monday midnight in Los
// Angeles: the end of Cyber Monday everywhere we sell.
export const LAUNCH_PROMO_ENDS_AT_MS = Date.parse('2026-12-01T09:00:00+01:00');

// Human label for the deadline, used in banner + price copy ("through …").
export const LAUNCH_PROMO_END_LABEL = 'Monday 30 November';

// Short badge shown on the promo banner + register callouts.
export const LAUNCH_PROMO_TAG = 'Black Friday';

// How emails and labels name the sale in a sentence ("the … runs through").
export const LAUNCH_PROMO_SALE_NAME = 'Black Friday sale';

// What the live passes (1, 3, 6 and 12 months) come down by while the sale runs.
export const LIVE_PASS_PROMO_PERCENT = 20;

// The monthly live pass during the sale: this percent off its first months
// (Jacob, 25 Nov 2026: "first two months 20% off"), for a monthly agreed while
// the sale runs, also one whose first charge falls later.
export const LIVE_PASS_MONTHLY_PROMO_MONTHS = 2;

// Whether the sale also covers the Grief Course, the Forgiveness Course and the
// journeys (the launch sale did; Black Friday does not).
export const PROMO_INCLUDES_SIDE_COURSES = false;

export function launchPromoActive(nowMs: number = Date.now()): boolean {
  return (
    Number.isFinite(LAUNCH_PROMO_STARTS_AT_MS) &&
    Number.isFinite(LAUNCH_PROMO_ENDS_AT_MS) &&
    nowMs >= LAUNCH_PROMO_STARTS_AT_MS &&
    nowMs < LAUNCH_PROMO_ENDS_AT_MS
  );
}

// True until the sale has ended, so also before it opens. For markup on the
// statically built pages only: they are built ahead of the sale, so they ship
// the banner hidden and the browser shows it inside the window.
export function launchPromoRenderable(nowMs: number = Date.now()): boolean {
  return Number.isFinite(LAUNCH_PROMO_ENDS_AT_MS) && nowMs < LAUNCH_PROMO_ENDS_AT_MS;
}

// The sale's percent on a live pass of 1, 3, 6 or 12 months, else 0.
export function livePassPromoPercent(nowMs: number = Date.now()): number {
  return launchPromoActive(nowMs) ? LIVE_PASS_PROMO_PERCENT : 0;
}

// The sale's percent on the Grief Course, the Forgiveness Course and the
// journeys: 0 unless this sale covers them.
export function sideCoursePromoPercent(nowMs: number = Date.now()): number {
  return PROMO_INCLUDES_SIDE_COURSES ? launchPromoPercent(nowMs) : 0;
}

// The promo percent if live, else 0.
export function launchPromoPercent(nowMs: number = Date.now()): number {
  return launchPromoActive(nowMs) ? LAUNCH_PROMO_PERCENT : 0;
}

// Combine the promo with a URL-override discount percent on a SIDE course (the
// Grief Course, the Forgiveness Course, a journey: its only callers) — the buyer
// gets the better of the two. While the sale leaves those courses out, this is
// the override alone.
export function withLaunchPromo(otherPercent: number, nowMs: number = Date.now()): number {
  return Math.max(otherPercent || 0, sideCoursePromoPercent(nowMs));
}

// Serializable payload set on `window.__SD_PROMO__` in the base Layout <head>,
// read by the inline (non-bundled) workshop + masterclass scripts. Bundled
// component scripts import the helpers above directly instead.
export type PromoPayload = {
  percent: number;
  startsAtMs: number;
  endsAtMs: number;
  endLabel: string;
};

export function launchPromoPayload(): PromoPayload {
  return {
    percent: LAUNCH_PROMO_PERCENT,
    startsAtMs: LAUNCH_PROMO_STARTS_AT_MS,
    endsAtMs: LAUNCH_PROMO_ENDS_AT_MS,
    endLabel: LAUNCH_PROMO_END_LABEL,
  };
}

// Banner copy (marketing mechanics — not governed by the copy book).
export const LAUNCH_PROMO_HEADLINE = `${LAUNCH_PROMO_PERCENT}% off the workshop, the masterclass, the 12-week course and the certification`;
export const LAUNCH_PROMO_SUBHEAD = `${LIVE_PASS_PROMO_PERCENT}% off live passes · through ${LAUNCH_PROMO_END_LABEL}`;
