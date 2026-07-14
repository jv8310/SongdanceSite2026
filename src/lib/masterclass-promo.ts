// Masterclass launch offer — a standalone, single-product promo.
//
// When the site-wide launch sale (src/lib/promo.ts) closes on 15 July 2026,
// the Professional Masterclass keeps its own 50%-off "launch offer just for
// this product" running on. This module is that offer's single source of
// truth — deliberately separate from `promo.ts` so the two never entangle:
// the launch sale ending doesn't touch this, and shortening/ending this
// doesn't touch anything else.
//
// Scope — the MASTERCLASS TICKET ONLY (live dates + the replay; both carry a
// `masterclass`-containing product slug). It never touches courses, the €9
// intro workshop, retreats, or the order bump. Applied authoritatively
// server-side in /api/workshops/register (keyed on the ticket product being a
// masterclass) and mirrored in the on-page price displays so the buyer sees
// what they pay.
//
// How it interacts with the site-wide launch promo while both are live
// (now → 15 July): the masterclass ticket takes the BETTER of the two (max),
// and both are 50%, so nothing changes in the overlap. After 15 July the
// launch promo returns 0 and this alone keeps the masterclass at 50%.
//
// Discovery surfaces (the /courses grid chip, the nav price, the Meta catalog
// feed) are deliberately NOT touched — those revert to the full €118 with the
// launch sale. This offer shows only where the masterclass is actually sold
// (the masterclass page + the /workshop page's masterclass rows + /w/<slug>),
// so the displayed price always matches the charge.
//
// Time-gated on a fixed timestamp, checked with Date.now() on server and
// client alike, so it switches itself off at the deadline WITHOUT a rebuild.

export const MASTERCLASS_PROMO_PERCENT = 50;

// Open-ended by design (owner's call, July 2026): "no fixed end yet". This is a
// far-out placeholder — a real timestamp so the client `active` derivation
// works — that the owner can shorten to a real close date at any time by
// editing this one line (then it self-expires exactly like the launch sale).
// End of 2026, 23:59 Europe/Brussels (CET = UTC+1).
export const MASTERCLASS_PROMO_ENDS_AT_MS = Date.parse('2026-12-31T23:59:59+01:00');

// Short badge + line for the on-page callout (marketing mechanics — not
// governed by the copy book). Kept factual: no deadline named (it's open),
// no fake scarcity.
export const MASTERCLASS_PROMO_TAG = 'Launch offer';

export function masterclassPromoActive(nowMs: number = Date.now()): boolean {
  return (
    Number.isFinite(MASTERCLASS_PROMO_ENDS_AT_MS) &&
    nowMs < MASTERCLASS_PROMO_ENDS_AT_MS
  );
}

// The promo percent if live, else 0.
export function masterclassPromoPercent(nowMs: number = Date.now()): number {
  return masterclassPromoActive(nowMs) ? MASTERCLASS_PROMO_PERCENT : 0;
}

// Serializable payload set on `window.__SD_MC_PROMO__` in the base Layout
// <head>, read by the inline (non-bundled) masterclass + workshop register
// scripts so the displayed price tracks the charge and self-expires at the
// deadline. Mirrors `window.__SD_PROMO__` for the launch sale.
export type MasterclassPromoPayload = {
  percent: number;
  endsAtMs: number;
};

export function masterclassPromoPayload(): MasterclassPromoPayload {
  return {
    percent: MASTERCLASS_PROMO_PERCENT,
    endsAtMs: MASTERCLASS_PROMO_ENDS_AT_MS,
  };
}
