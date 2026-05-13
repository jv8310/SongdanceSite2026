export type Product = {
  id: number;
  slug: string;
  type: 'retreat' | 'course' | 'workshop' | 'digital';
  name: string;
  description: string | null;
  currency: string;
  vat_rate: number;
  starts_at: string | null;
  ends_at: string | null;
  drip_tag: string | null;
  active: number;
};

export type Tier = {
  id: number;
  product_id: number;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  capacity: number;
  sort_order: number;
  active: number;
};

export type SpecialRole = 'fire_keeper' | 'cook_help';

export type InventoryUnit = {
  id: number;
  tier_id: number;
  name: string;
  capacity: number;          // physical beds in the room
  notes: string | null;
  status: 'available' | 'reserved' | 'inactive';
  sort_order: number;
  solo_tier_id: number | null;    // tier when sold as a single room
  shared_tier_id: number | null;  // tier when sold bed-by-bed
  role: SpecialRole | null;       // 'fire_keeper' (Paviljoen) | 'cook_help' (Room 5.2)
};

// "mode" is a runtime concept derived from current bookings on the room:
//   reserved / inactive  → set by inventory_units.status
//   open                 → 0 active registrations
//   solo                 → at least 1 reg whose tier matches solo_tier_id
//   shared               → at least 1 reg whose tier matches shared_tier_id
export type RoomMode = 'open' | 'solo' | 'shared' | 'reserved' | 'inactive';

export type RoomWithMode = InventoryUnit & {
  beds_sold: number;
  mode: RoomMode;
};

export type Registration = {
  id: number;
  product_id: number;
  tier_id: number;
  inventory_unit_id: number | null;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  phone_country: string | null;
  country: string | null;
  company_name: string | null;
  vat_number: string | null;
  address: string | null;
  roommate_pref: string | null;
  dietary: string | null;
  notes: string | null;
  consent_framework: number;
  consent_terms: number;
  consent_at: string | null;
  role: SpecialRole | null;
  role_discount_cents: number;
  status:
    | 'pending'
    | 'paid'
    | 'cancelled'
    | 'refunded'
    | 'waitlist'
    | 'expired';
  amount_cents: number;
  currency: string;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  quaderno_invoice_id: string | null;
  hold_expires_at: string | null;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
};

export async function getProductBySlug(db: D1Database, slug: string) {
  return db
    .prepare('SELECT * FROM products WHERE slug = ? AND active = 1')
    .bind(slug)
    .first<Product>();
}

export async function getTiersForProduct(db: D1Database, productId: number) {
  const r = await db
    .prepare(
      'SELECT * FROM tiers WHERE product_id = ? AND active = 1 ORDER BY sort_order, id',
    )
    .bind(productId)
    .all<Tier>();
  return r.results ?? [];
}

export async function getTierBySlug(
  db: D1Database,
  productId: number,
  slug: string,
) {
  return db
    .prepare(
      'SELECT * FROM tiers WHERE product_id = ? AND slug = ? AND active = 1',
    )
    .bind(productId, slug)
    .first<Tier>();
}

export async function getTierAvailability(db: D1Database, tierId: number) {
  const tier = await db
    .prepare('SELECT capacity FROM tiers WHERE id = ?')
    .bind(tierId)
    .first<{ capacity: number }>();
  if (!tier) return { capacity: 0, taken: 0, remaining: 0 };

  const counted = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM registrations
        WHERE tier_id = ?
          AND status IN ('paid','pending')
          AND (status = 'paid' OR hold_expires_at IS NULL OR hold_expires_at > datetime('now'))`,
    )
    .bind(tierId)
    .first<{ n: number }>();
  const taken = counted?.n ?? 0;
  return {
    capacity: tier.capacity,
    taken,
    remaining: Math.max(0, tier.capacity - taken),
  };
}

export async function createPendingRegistration(
  db: D1Database,
  data: {
    product_id: number;
    tier_id: number;
    inventory_unit_id: number | null;
    first_name: string;
    last_name: string;
    email: string;
    phone: string | null;
    phone_country: string | null;
    country: string | null;
    company_name: string | null;
    vat_number: string | null;
    address: string | null;
    roommate_pref?: string | null;
    dietary: string | null;
    notes: string | null;
    consent_framework: boolean;
    consent_terms: boolean;
    role?: SpecialRole | null;
    role_discount_cents?: number;
    amount_cents: number;
    currency: string;
    hold_minutes: number;
  },
) {
  const holdExpires = new Date(
    Date.now() + data.hold_minutes * 60 * 1000,
  ).toISOString();
  const fullName = `${data.first_name} ${data.last_name}`.trim();
  const consentAt =
    data.consent_framework && data.consent_terms
      ? new Date().toISOString()
      : null;
  const r = await db
    .prepare(
      `INSERT INTO registrations
        (product_id, tier_id, inventory_unit_id, name, first_name, last_name, email,
         phone, phone_country, country,
         company_name, vat_number, address,
         roommate_pref, dietary, notes,
         consent_framework, consent_terms, consent_at,
         role, role_discount_cents,
         status, amount_cents, currency, hold_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      data.product_id,
      data.tier_id,
      data.inventory_unit_id,
      fullName,
      data.first_name,
      data.last_name,
      data.email,
      data.phone,
      data.phone_country,
      data.country,
      data.company_name,
      data.vat_number,
      data.address,
      data.roommate_pref ?? null,
      data.dietary,
      data.notes,
      data.consent_framework ? 1 : 0,
      data.consent_terms ? 1 : 0,
      consentAt,
      data.role ?? null,
      data.role_discount_cents ?? 0,
      data.amount_cents,
      data.currency,
      holdExpires,
    )
    .first<{ id: number }>();
  if (!r) throw new Error('Failed to create registration');
  return r.id;
}

export async function attachStripeSession(
  db: D1Database,
  registrationId: number,
  sessionId: string,
) {
  await db
    .prepare(
      'UPDATE registrations SET stripe_session_id = ? WHERE id = ?',
    )
    .bind(sessionId, registrationId)
    .run();
}

export async function markRegistrationPaid(
  db: D1Database,
  registrationId: number,
  paymentIntent: string,
) {
  await db
    .prepare(
      `UPDATE registrations
          SET status = 'paid',
              stripe_payment_intent = ?,
              paid_at = datetime('now'),
              hold_expires_at = NULL
        WHERE id = ?
          AND status IN ('pending','expired')`,
    )
    .bind(paymentIntent, registrationId)
    .run();
}

export async function setQuadernoInvoice(
  db: D1Database,
  registrationId: number,
  invoiceId: string,
) {
  await db
    .prepare(
      'UPDATE registrations SET quaderno_invoice_id = ? WHERE id = ?',
    )
    .bind(invoiceId, registrationId)
    .run();
}

export async function getRegistrationBySession(
  db: D1Database,
  sessionId: string,
) {
  return db
    .prepare('SELECT * FROM registrations WHERE stripe_session_id = ?')
    .bind(sessionId)
    .first<Registration>();
}

export async function getRegistrationById(db: D1Database, id: number) {
  return db
    .prepare('SELECT * FROM registrations WHERE id = ?')
    .bind(id)
    .first<Registration>();
}

export async function logEvent(
  db: D1Database,
  data: {
    registration_id: number | null;
    kind: string;
    source?: string;
    external_id?: string | null;
    payload?: unknown;
  },
) {
  await db
    .prepare(
      `INSERT INTO events (registration_id, kind, source, external_id, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      data.registration_id,
      data.kind,
      data.source ?? 'system',
      data.external_id ?? null,
      data.payload ? JSON.stringify(data.payload) : null,
    )
    .run();
}

export async function eventExists(db: D1Database, externalId: string) {
  const r = await db
    .prepare('SELECT 1 AS one FROM events WHERE external_id = ?')
    .bind(externalId)
    .first<{ one: number }>();
  return !!r;
}

// ─────────────────────────────────────────────────────────────────────
//  Smart room model: live per-tier availability + auto room-assignment
// ─────────────────────────────────────────────────────────────────────

// Load every room for a product, joined with its current beds_sold count
// and the tier_id of any active booking on it. Used to derive each room's
// runtime mode (open / solo / shared / reserved / inactive).
export async function getRoomsWithMode(
  db: D1Database,
  productId: number,
): Promise<RoomWithMode[]> {
  const sql = `
    SELECT iu.id, iu.tier_id, iu.name, iu.capacity, iu.notes, iu.status,
           iu.sort_order, iu.solo_tier_id, iu.shared_tier_id, iu.role,
           COALESCE(b.beds_sold, 0)   AS beds_sold,
           b.first_tier_id            AS first_tier_id
      FROM inventory_units iu
      LEFT JOIN (
        SELECT inventory_unit_id,
               COUNT(*) AS beds_sold,
               MAX(tier_id) AS first_tier_id
          FROM registrations r
         WHERE r.status IN ('paid','pending')
           AND (r.status = 'paid'
                OR r.hold_expires_at IS NULL
                OR r.hold_expires_at > datetime('now'))
           AND r.inventory_unit_id IS NOT NULL
         GROUP BY inventory_unit_id
      ) b ON b.inventory_unit_id = iu.id
     WHERE EXISTS (
       SELECT 1 FROM tiers t
        WHERE t.id = iu.tier_id AND t.product_id = ?
     )
     ORDER BY iu.sort_order, iu.id
  `;
  const res = await db.prepare(sql).bind(productId).all<
    InventoryUnit & { beds_sold: number; first_tier_id: number | null }
  >();
  const rows = res.results ?? [];
  return rows.map((r) => ({
    ...r,
    mode: deriveRoomMode(r),
  }));
}

function deriveRoomMode(r: {
  status: 'available' | 'reserved' | 'inactive';
  beds_sold: number;
  first_tier_id: number | null;
  solo_tier_id: number | null;
  shared_tier_id: number | null;
}): RoomMode {
  if (r.status === 'reserved') return 'reserved';
  if (r.status === 'inactive') return 'inactive';
  if (r.beds_sold === 0) return 'open';
  // Has at least one booking — decide solo vs shared by which tier matches.
  if (r.first_tier_id != null && r.first_tier_id === r.solo_tier_id) return 'solo';
  if (r.first_tier_id != null && r.first_tier_id === r.shared_tier_id) return 'shared';
  // Defensive fallback: a single-tier room can only be the one mode it supports.
  return r.solo_tier_id ? 'solo' : 'shared';
}

export type TierAvailability = {
  tier: Tier;
  remaining: number;
  capacity: number;
};

// Per-tier remaining bed counts, computed from the room model.
//   Solo-tier (PE / PSB): count of OPEN rooms eligible as that solo tier.
//   Shared-tier (SB / CS): sum of free beds in rooms whose shared_tier_id
//                          matches and that are not solo-locked. A
//                          multi-mode room flipped to solo therefore
//                          subtracts its full bed count from this total.
export async function computeTierAvailability(
  db: D1Database,
  productId: number,
): Promise<TierAvailability[]> {
  const [rooms, tiers] = await Promise.all([
    getRoomsWithMode(db, productId),
    getTiersForProduct(db, productId),
  ]);

  return tiers.map((tier) => {
    let remaining = 0;
    let capacity = 0;

    for (const r of rooms) {
      if (r.mode === 'reserved' || r.mode === 'inactive') continue;
      if (r.solo_tier_id === tier.id) {
        capacity += 1;
        if (r.mode === 'open') remaining += 1;
      }
      if (r.shared_tier_id === tier.id) {
        capacity += r.capacity;
        if (r.mode !== 'solo') {
          remaining += Math.max(0, r.capacity - r.beds_sold);
        }
      }
    }

    return { tier, remaining, capacity };
  });
}

// Pick the best room for a new registration of the given tier slug.
// Returns null if there's no room available.
//
// Strategy:
//   Solo tiers (PE / PSB): first open eligible room (by sort_order).
//   Shared tiers (SB / CS), in priority order:
//     1) An already shared-locked room with a free bed (fill it up before
//        starting a new one).
//     2) A shared-only room (no solo_tier_id) — e.g. the canopy bed for SB,
//        any open Common Space room for CS.
//     3) A multi-mode open room, preferring those whose solo tier has
//        more sibling rooms (so flipping doesn't kill a scarce solo option);
//        within that group, prefer bigger rooms first.
export async function pickRoomForTier(
  db: D1Database,
  productId: number,
  tierSlug: string,
): Promise<RoomWithMode | null> {
  const rooms = await getRoomsWithMode(db, productId);
  const tiers = await getTiersForProduct(db, productId);
  const tier = tiers.find((t) => t.slug === tierSlug);
  if (!tier) return null;

  const isSoloTier = rooms.some((r) => r.solo_tier_id === tier.id);
  const isSharedTier = rooms.some((r) => r.shared_tier_id === tier.id);

  if (isSoloTier && !isSharedTier) {
    const candidates = rooms
      .filter(
        (r) => r.solo_tier_id === tier.id && r.mode === 'open',
      )
      .sort((a, b) => a.sort_order - b.sort_order);
    return candidates[0] ?? null;
  }

  if (isSharedTier) {
    // Priority 1: already shared-locked rooms with free beds
    const p1 = rooms
      .filter(
        (r) =>
          r.shared_tier_id === tier.id &&
          r.mode === 'shared' &&
          r.beds_sold < r.capacity,
      )
      .sort((a, b) => a.sort_order - b.sort_order);
    if (p1.length) return p1[0];

    // Priority 2: shared-only rooms (no solo alternative) with free beds
    const p2 = rooms
      .filter(
        (r) =>
          r.shared_tier_id === tier.id &&
          r.solo_tier_id == null &&
          (r.mode === 'open' || r.mode === 'shared') &&
          r.beds_sold < r.capacity,
      )
      .sort((a, b) => a.sort_order - b.sort_order);
    if (p2.length) return p2[0];

    // Priority 3: multi-mode rooms — last resort, will flip the room to shared.
    // Prefer to "spend" a room from a solo-tier group that still has
    // many siblings (so the scarce solo option stays open). Within that
    // group, take the biggest room first to extract more shared beds per flip.
    const soloTierSiblings = new Map<number, number>();
    for (const r of rooms) {
      if (r.solo_tier_id == null) continue;
      if (r.mode === 'reserved' || r.mode === 'inactive') continue;
      soloTierSiblings.set(
        r.solo_tier_id,
        (soloTierSiblings.get(r.solo_tier_id) ?? 0) + 1,
      );
    }
    const p3 = rooms
      .filter(
        (r) =>
          r.shared_tier_id === tier.id &&
          r.solo_tier_id != null &&
          r.mode === 'open',
      )
      .sort((a, b) => {
        const aSib = soloTierSiblings.get(a.solo_tier_id!) ?? 0;
        const bSib = soloTierSiblings.get(b.solo_tier_id!) ?? 0;
        if (aSib !== bSib) return bSib - aSib;
        if (a.capacity !== b.capacity) return b.capacity - a.capacity;
        return a.sort_order - b.sort_order;
      });
    if (p3.length) return p3[0];
  }

  return null;
}

// Look up the room tagged with a given opt-in role (fire keeper / cook help).
// Returns null if the room doesn't exist or its single bed is already taken.
export async function getSpecialRoomByRole(
  db: D1Database,
  productId: number,
  role: SpecialRole,
): Promise<RoomWithMode | null> {
  const rooms = await getRoomsWithMode(db, productId);
  const room = rooms.find((r) => r.role === role);
  if (!room) return null;
  if (room.beds_sold >= room.capacity) return null;
  return room;
}

// Per-role availability flags for the registration form so it knows
// whether to render the fire-keeper / cook-help checkboxes.
export async function getSpecialRoomAvailability(
  db: D1Database,
  productId: number,
): Promise<{ fire_keeper_available: boolean; cook_help_available: boolean }> {
  const rooms = await getRoomsWithMode(db, productId);
  const free = (role: SpecialRole) => {
    const r = rooms.find((x) => x.role === role);
    return !!r && r.beds_sold < r.capacity;
  };
  return {
    fire_keeper_available: free('fire_keeper'),
    cook_help_available: free('cook_help'),
  };
}
