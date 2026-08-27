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

// ---------------------------------------------------------------------------
// Pools: charging each campaign's money to the sessions it actually bought.
//
// Prospecting runs one campaign per product (a workshop campaign and a
// masterclass campaign — see lib/ads/campaigns.ts). Allocating their combined
// spend across every registration prices a masterclass seat partly out of the
// workshop budget and vice versa, so neither cost per registration is the real
// one. Each pool therefore carries a *scope*: the workshops its spend may be
// charged to. Within that scope the day-by-day pricing above is unchanged —
// that day's pool spend ÷ that day's registrations *in scope*.
//
// Pools whose scope is null (campaigns that name no product: the blank campaign
// of a legacy account-level pull, a CSV with no campaign column, a broad
// brand campaign) are charged across every registration, exactly as before.

export type SpendPool = {
  /** Identifies the pool in the returned per-pool map. */
  key: string;
  /** YYYY-MM-DD → this pool's spend that day (minor EUR). */
  spendByDate: Map<string, number>;
  /** Workshop ids this pool's spend may be charged to; null = all of them. */
  scope: Set<number> | null;
};

export type PooledAllocation = {
  /** Workshop id → euros (minor, fractional) charged to it across all pools. */
  byWorkshop: Map<number, number>;
  /** Each pool's own allocation, keyed by `SpendPool.key`. */
  pools: Map<string, DailyAllocation>;
  /**
   * Spend that fell on a day its scope took no registration on, spread evenly
   * over that scope's registrations in the window (the day model can't price
   * it; dropping it would understate cost).
   */
  unattributedEurMinor: number;
  /**
   * Spend charged to nothing: its scope took no registration in the whole
   * window, so there is no registration of that product to price it against.
   * Spreading it over the *other* product's registrations is the very
   * mis-attribution this split exists to remove, so it is reported instead.
   */
  unallocatedEurMinor: number;
};

/** Registrations restricted to a scope: same shape, only in-scope workshops. */
function scopeRegs(
  regsByDateWorkshop: Map<string, Map<number, number>>,
  regsByWorkshop: Map<number, number>,
  scope: Set<number> | null,
): { byDate: Map<string, Map<number, number>>; byWorkshop: Map<number, number> } {
  if (!scope) return { byDate: regsByDateWorkshop, byWorkshop: regsByWorkshop };
  const byDate = new Map<string, Map<number, number>>();
  for (const [date, perDay] of regsByDateWorkshop) {
    const kept = new Map<number, number>();
    for (const [id, n] of perDay) if (scope.has(id)) kept.set(id, n);
    if (kept.size > 0) byDate.set(date, kept);
  }
  const byWorkshop = new Map<number, number>();
  for (const [id, n] of regsByWorkshop) if (scope.has(id)) byWorkshop.set(id, n);
  return { byDate, byWorkshop };
}

/**
 * Allocate several scoped spend pools over the same registration grid.
 *
 * Each pool is priced day by day against the registrations inside its own
 * scope, so a workshop is only ever charged for campaigns that were buying
 * registrations for it. The per-workshop amounts sum to the pooled total minus
 * `unallocatedEurMinor`.
 */
export function allocateSpendPools(
  pools: SpendPool[],
  regsByDateWorkshop: Map<string, Map<number, number>>,
  regsByWorkshop: Map<number, number>,
): PooledAllocation {
  const byWorkshop = new Map<number, number>();
  const out = new Map<string, DailyAllocation>();
  let unattributedEurMinor = 0;
  let unallocatedEurMinor = 0;

  for (const pool of pools) {
    const scoped = scopeRegs(regsByDateWorkshop, regsByWorkshop, pool.scope);
    const alloc = allocateSpendByDay(pool.spendByDate, scoped.byDate, scoped.byWorkshop);
    out.set(pool.key, alloc);
    for (const [id, v] of alloc.byWorkshop) byWorkshop.set(id, (byWorkshop.get(id) ?? 0) + v);
    // Residue the day model couldn't price: spread inside the pool's own scope
    // when that scope has registrations to carry it, otherwise reported as
    // unallocated — a pool whose product took no registration all window has
    // nothing of its own to be charged to, and the other product's seats are
    // exactly what it must not be charged to.
    if (alloc.spreadUnattributed) unattributedEurMinor += alloc.unattributedEurMinor;
    else unallocatedEurMinor += alloc.unattributedEurMinor;
  }

  return { byWorkshop, pools: out, unattributedEurMinor, unallocatedEurMinor };
}
