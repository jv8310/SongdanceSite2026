// Course URL discounts — two params, mirroring the workshop ticket
// (src/lib/workshops/discount.ts):
//
//   ?discount=N    Bespoke owner link, 1–99. Whoever holds the URL controls
//                  the price; it's still a paid checkout (≥ 1% is charged).
//
//   ?adiscount=N   Owner secret, 1–100. The param NAME ("adiscount") is the
//                  secret — not guessable, meant to be shared sparingly. It is
//                  the ONLY way to reach 100%, which is a *free* checkout: no
//                  Stripe session, the registration is fulfilled directly (see
//                  src/lib/courses/free-checkout.ts).
//
// Enforcement lives server-side in every course checkout endpoint; the page
// reads only mirror the price so the buyer sees what they'll pay. A 100% on the
// public ?discount param is deliberately rejected, so no one can edit a shared
// discount link up to free.

export const COURSE_PUBLIC_DISCOUNT_PARAM = 'discount';
export const COURSE_SECRET_DISCOUNT_PARAM = 'adiscount';

// Parse a percent value (string or number) to an integer in 1–max, or 0 if it
// is junk / out of range.
export function clampCoursePct(
  v: string | number | null | undefined,
  max: number,
): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > max) return 0;
  return n;
}

// Resolve the effective course URL discount (0 = none) from raw param values.
// The owner's secret param wins (1–100); the public param only ever yields
// 1–99. A value of 100 can therefore only ever come from ?adiscount.
export function resolveCourseDiscountPercent(raw: {
  discount?: string | number | null;
  adiscount?: string | number | null;
}): number {
  const secret = clampCoursePct(raw.adiscount, 100);
  if (secret) return secret;
  return clampCoursePct(raw.discount, 99);
}

// True when the secret param asks for a full (100%) comp — the trigger for the
// free-checkout path. Only ?adiscount can satisfy this.
export function isFreeCourseCheckout(raw: {
  discount?: string | number | null;
  adiscount?: string | number | null;
}): boolean {
  return clampCoursePct(raw.adiscount, 100) === 100;
}

// ── Client side ────────────────────────────────────────────────────────────
// Both course pricing surfaces read the SAME two params from the URL, and both
// must ask the pricing endpoints for the same percent — the certification page
// resolves its decision either from its own lookup or from the teaser's
// (whichever runs; with `?email=` in the URL only the teaser does). When one of
// them forgot to pass the override, the page priced at full price while the
// checkout charged the discount — the link looked inert. So the reading lives
// here, once.
//
// `shownPct` is what the page displays and sends to the pricing endpoints:
// the secret param wins at 1–99, else the public one. 100 is the complimentary
// place — it has its own banner and free-checkout path and never feeds price
// math (the endpoints only honour 1–99 anyway).
export function readCourseUrlDiscount(search: string): {
  discountPct: number;
  adiscountPct: number;
  shownPct: number;
  isFreeComp: boolean;
} {
  let discountPct = 0;
  let adiscountPct = 0;
  try {
    const params = new URLSearchParams(search);
    discountPct = clampCoursePct(params.get(COURSE_PUBLIC_DISCOUNT_PARAM), 99);
    adiscountPct = clampCoursePct(params.get(COURSE_SECRET_DISCOUNT_PARAM), 100);
  } catch {}
  return {
    discountPct,
    adiscountPct,
    shownPct: adiscountPct > 0 && adiscountPct < 100 ? adiscountPct : discountPct,
    isFreeComp: adiscountPct === 100,
  };
}
