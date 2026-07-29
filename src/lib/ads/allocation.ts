// Charging ad spend to workshops, day by day.
//
// The old model was a single window-wide average: total prospecting spend ÷
// total registrations gave one cost per registration, and every workshop was
// charged that flat rate × its registration count. That smears an expensive
// week over a cheap one — a workshop whose seats filled on a €200/day is
// charged the same per seat as one that filled on a €20/day, so neither its
// cost nor its ROAS reflects what actually bought those registrations.
//
// The model here prices each *day* on its own: that day's spend ÷ that day's
// registrations = the cost of a registration bought that day. Every
// registration then carries the price of the day it came in, and a workshop's
// cost is the sum of what its own registrations cost. Registrations on a day
// with no spend are free (organic) — as they were.
//
// One residue: spend on a day that produced no registrations at all can't be
// charged to a registration day-by-day. Dropping it would understate cost and
// break the reconciliation with total ad spend (the per-workshop column would
// no longer sum to what was actually spent), so it is spread evenly across
// every registration in the window — the old flat-average treatment, applied
// only to the part of the spend the daily model can't place. The upshot: the
// *distribution* across workshops is day-accurate while the aggregate
// (total spend ÷ total registrations) is unchanged and still reconciles.

export type DailyAllocation = {
  /** Workshop id → this pool's euros (minor, fractional) charged to it. */
  byWorkshop: Map<number, number>;
  /**
   * Day → what one registration cost that day (minor EUR, fractional).
   * `null` when the day had spend but no registrations, so nothing can be
   * priced; a day with registrations and no spend is 0.
   */
  costPerRegistrationByDate: Map<string, number | null>;
  /** Pool euros that fell on days with no registrations at all. */
  unattributedEurMinor: number;
  /** True when that unattributed spend was spread across the window's regs. */
  spreadUnattributed: boolean;
};

/**
 * Allocate one spend pool (all campaigns, or prospecting-only) across workshops
 * by the registrations each workshop took on each day.
 *
 * @param spendByDate         YYYY-MM-DD → pool spend that day (minor EUR)
 * @param regsByDateWorkshop  YYYY-MM-DD → workshop id → registrations that day
 * @param regsByWorkshop      workshop id → registrations in the whole window
 *
 * The returned per-workshop amounts sum to the pool total whenever the window
 * holds at least one registration (fractional cents are kept — round once, at
 * the point of display).
 */
export function allocateSpendByDay(
  spendByDate: Map<string, number>,
  regsByDateWorkshop: Map<string, Map<number, number>>,
  regsByWorkshop: Map<number, number>,
): DailyAllocation {
  const byWorkshop = new Map<number, number>();
  const costPerRegistrationByDate = new Map<string, number | null>();
  const add = (id: number, v: number) => byWorkshop.set(id, (byWorkshop.get(id) ?? 0) + v);

  let unattributedEurMinor = 0;
  for (const [date, eurMinor] of spendByDate) {
    const perWorkshop = regsByDateWorkshop.get(date);
    let dayRegs = 0;
    if (perWorkshop) for (const n of perWorkshop.values()) dayRegs += n;
    if (dayRegs === 0) {
      // Spend, no registrations — nothing to price it against today.
      if (eurMinor > 0) unattributedEurMinor += eurMinor;
      costPerRegistrationByDate.set(date, eurMinor > 0 ? null : 0);
      continue;
    }
    const cpr = eurMinor / dayRegs;
    costPerRegistrationByDate.set(date, cpr);
    for (const [id, n] of perWorkshop!) add(id, cpr * n);
  }
  // Registrations on a day this pool never spent on cost nothing.
  for (const date of regsByDateWorkshop.keys()) {
    if (!costPerRegistrationByDate.has(date)) costPerRegistrationByDate.set(date, 0);
  }

  let totalRegs = 0;
  for (const n of regsByWorkshop.values()) totalRegs += n;
  const spreadUnattributed = unattributedEurMinor > 0 && totalRegs > 0;
  if (spreadUnattributed) {
    const per = unattributedEurMinor / totalRegs;
    for (const [id, n] of regsByWorkshop) add(id, per * n);
  }

  return { byWorkshop, costPerRegistrationByDate, unattributedEurMinor, spreadUnattributed };
}
