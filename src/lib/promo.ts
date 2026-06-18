// Launch promo — single source of truth.
//
// 50% off all COURSES (and the workshop + masterclass tickets) for the new-site
// launch, running through the end of June 2026. Retreats are deliberately
// excluded (a retreat is a physical event, priced/charged on its own path that
// this module never touches).
//
// This is applied authoritatively SERVER-SIDE in every course/workshop checkout
// endpoint (so a tampered client can never under- or over-charge), and mirrored
// in the on-page price displays so what the buyer sees is what they pay.
//
// How it interacts with the existing per-product discounts:
//   - 12-week workshop discount (20%) / journeys bundle discount (20%):
//     the promo is taken as the *better* deal (max), so e.g. the bundle is
//     20% off the sum AND 50% off on top of that.
//   - Certification "mid-cohort" discount: paused during the promo and replaced
//     by 50% off the LIST/base price (see applyLaunchPromoToOffer in variant.ts).
//   - A hand-crafted ?discount=N / ?adiscount=N override link still wins outright
//     (it's an explicit, intentional price), so partner/bespoke links aren't
//     downgraded to 50%.
//
// The window is time-gated on a fixed timestamp, checked with Date.now() on both
// server and client, so the promo switches itself off at the deadline WITHOUT a
// rebuild: the server stops discounting, the client stops striking, and the
// banner removes itself.

export const LAUNCH_PROMO_PERCENT = 50;

// 23:59 on 30 June 2026, Europe/Brussels (CEST = UTC+2) → midnight, 1 July local.
export const LAUNCH_PROMO_ENDS_AT_MS = Date.parse('2026-07-01T00:00:00+02:00');

// Human label for the deadline, used in banner + price copy.
export const LAUNCH_PROMO_END_LABEL = 'June 30';

export function launchPromoActive(nowMs: number = Date.now()): boolean {
  return Number.isFinite(LAUNCH_PROMO_ENDS_AT_MS) && nowMs < LAUNCH_PROMO_ENDS_AT_MS;
}

// The promo percent if live, else 0.
export function launchPromoPercent(nowMs: number = Date.now()): number {
  return launchPromoActive(nowMs) ? LAUNCH_PROMO_PERCENT : 0;
}

// Combine the promo with any other (workshop / URL-override) discount percent —
// the buyer always gets the better of the two.
export function withLaunchPromo(otherPercent: number, nowMs: number = Date.now()): number {
  return Math.max(otherPercent || 0, launchPromoPercent(nowMs));
}

// Serializable payload set on `window.__SD_PROMO__` in the base Layout <head>,
// read by the inline (non-bundled) workshop + masterclass scripts. Bundled
// component scripts import the helpers above directly instead.
export type PromoPayload = {
  percent: number;
  endsAtMs: number;
  endLabel: string;
};

export function launchPromoPayload(): PromoPayload {
  return {
    percent: LAUNCH_PROMO_PERCENT,
    endsAtMs: LAUNCH_PROMO_ENDS_AT_MS,
    endLabel: LAUNCH_PROMO_END_LABEL,
  };
}

// Banner copy (marketing mechanics — not governed by the copy book).
export const LAUNCH_PROMO_HEADLINE = `Launch offer — ${LAUNCH_PROMO_PERCENT}% off all courses and online events`;
export const LAUNCH_PROMO_SUBHEAD = `Our new website is here — every course and online event is half price through ${LAUNCH_PROMO_END_LABEL}.`;
