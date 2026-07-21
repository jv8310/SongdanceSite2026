// Masterclass launch offer — a standalone, single-product promo.
//
// ENDED (owner's call, 21 July 2026). After the July repricing the masterclass
// full price is €44 and the €22 intro workshop is exactly half of it, so a
// 50%-off masterclass landed at €22 — the same figure as the workshop, which
// cheapened it and read as a mistake. The offer is therefore closed: the
// masterclass now shows and charges its full price (€44) everywhere.
//
// The window below is set to a past timestamp, so `masterclassPromoActive`
// returns false on server and client alike and the discount switches itself
// off WITHOUT any other change — the on-page callout stops rendering, the price
// strikes disappear, and /api/workshops/register charges full price. To bring
// the offer back, move the timestamp into the future again (that's the only
// line that needs editing).
//
// Scope, when live — the MASTERCLASS TICKET ONLY (live dates + the replay; both
// carry a `masterclass`-containing product slug). It never touched courses, the
// €22 intro workshop, retreats, or the order bump. Applied server-side in
// /api/workshops/register (keyed on the ticket product being a masterclass) and
// mirrored in the on-page price displays. Discovery surfaces (the /courses grid
// chip, the nav price, the Meta catalog feed) were never touched — those always
// showed the full €44.

export const MASTERCLASS_PROMO_PERCENT = 50;

// Closed 21 July 2026 — a past timestamp, so the offer is inactive on server and
// client. Move it into the future to re-open the offer (it self-expires exactly
// like the launch sale). 00:00 Europe/Brussels (CEST = UTC+2) on 21 July 2026.
export const MASTERCLASS_PROMO_ENDS_AT_MS = Date.parse('2026-07-21T00:00:00+02:00');

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
