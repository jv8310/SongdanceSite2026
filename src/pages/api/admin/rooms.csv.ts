// GET /api/admin/rooms.csv?product=<slug> — the rooming list of a retreat as a
// CSV download: one row per person placed in a room, in the order the Rooms
// table on /admin/retreats/<slug> shows them (building in walking order, then
// the room's own order, then name). Admin-gated.
//
// Who is "in a room" is the Rooms table's own rule: a paid booking, or a
// pending one whose hold still stands. Paid bookings with no room yet follow
// at the end with the room columns empty, so nobody paid is missing from the
// file. The internal 1-euro test tier is left out.
import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../lib/registrations/auth';

export const prerender = false;

// Same walking order as the Rooms table; anything unmapped falls to the end.
const BUILDING_ORDER = ['Poorthuis', 'Theaterkamer', 'Balkonverblijf', 'Orangerie', 'Paviljoen'];

interface RoomRow {
  id: number;
  name: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  country: string | null;
  status: string;
  host: number;
  role: string | null;
  roommate_pref: string | null;
  dietary: string | null;
  notes: string | null;
  booked_as: string;
  room_name: string | null;
  building: string | null;
  room_capacity: number | null;
  room_sort: number | null;
}

export const GET: APIRoute = async ({ request, locals, url }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }
  const productSlug = url.searchParams.get('product') ?? 'ritual-of-belonging-2026';

  const product = await env.DB.prepare('SELECT id, slug FROM products WHERE slug = ?')
    .bind(productSlug)
    .first<{ id: number; slug: string }>();
  if (!product) return new Response('Unknown product', { status: 404 });

  const q = await env.DB.prepare(
    `SELECT r.id, r.name, r.email, r.first_name, r.last_name, r.phone, r.country,
            r.status, r.host, r.role, r.roommate_pref, r.dietary, r.notes,
            t.name AS booked_as,
            iu.name AS room_name, iu.building, iu.capacity AS room_capacity,
            iu.sort_order AS room_sort
       FROM registrations r
       JOIN tiers t ON t.id = r.tier_id
       LEFT JOIN inventory_units iu ON iu.id = r.inventory_unit_id
      WHERE r.product_id = ?
        AND t.slug <> 'admin-test-1eur'
        AND (r.status = 'paid'
             OR (r.status = 'pending'
                 AND r.inventory_unit_id IS NOT NULL
                 AND (r.hold_expires_at IS NULL OR r.hold_expires_at > datetime('now'))))`,
  )
    .bind(product.id)
    .all<RoomRow>();

  const rows = (q.results ?? []).map((r) => ({ ...r, display: displayName(r) }));
  rows.sort((a, b) => {
    // People without a room go last.
    const placed = Number(a.room_name == null) - Number(b.room_name == null);
    if (placed !== 0) return placed;
    const building = buildingRank(a.building) - buildingRank(b.building);
    if (building !== 0) return building;
    const room = (a.room_sort ?? 0) - (b.room_sort ?? 0);
    if (room !== 0) return room;
    const sameRoom = (a.room_name ?? '').localeCompare(b.room_name ?? '');
    if (sameRoom !== 0) return sameRoom;
    return a.display.localeCompare(b.display);
  });

  const headers = [
    'building', 'room', 'room_name', 'beds_in_room',
    'first_name', 'last_name', 'email', 'phone', 'country',
    'who', 'booked_as', 'status', 'roommate_pref', 'dietary', 'notes',
    'registration_id',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const { first, last } = splitName(r);
    lines.push(
      [
        r.building, r.room_name ? roomCode(r.room_name) : '', r.room_name, r.room_capacity,
        first, last,
        // A partner or co-facilitator booked onto a bed without an address of
        // their own carries a stand-in (…@placeholder.invalid): not an email.
        /@placeholder\.invalid$/i.test(r.email) ? '' : r.email,
        r.phone, r.country,
        who(r), r.booked_as, r.status, r.roommate_pref, r.dietary, r.notes,
        r.id,
      ]
        .map(csvField)
        .join(','),
    );
  }

  const filename = `rooms-${product.slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  // The BOM makes Excel read the file as UTF-8 (names with accents).
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
};

function buildingRank(b: string | null): number {
  const i = b ? BUILDING_ORDER.indexOf(b) : -1;
  return i === -1 ? BUILDING_ORDER.length : i;
}

// "Room 12 — Poorthuis, first floor" → "12"; the Paviljoen bed is "FK", as on
// the Rooms table.
function roomCode(name: string): string {
  const m = name.match(/^(?:Room|Cabin)\s+([\w.]+)\s*[—–-]\s*(.+)$/);
  if (m) return m[1];
  if (/^Paviljoen/i.test(name)) return 'FK';
  return name;
}

function displayName(r: RoomRow): string {
  return r.first_name || r.last_name
    ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()
    : r.name;
}

// Older rows hold only the full name: split it on its first space.
function splitName(r: RoomRow): { first: string; last: string } {
  if (r.first_name || r.last_name) {
    return { first: (r.first_name ?? '').trim(), last: (r.last_name ?? '').trim() };
  }
  const full = (r.name ?? '').trim();
  const i = full.indexOf(' ');
  return i === -1 ? { first: full, last: '' } : { first: full.slice(0, i), last: full.slice(i + 1).trim() };
}

function who(r: RoomRow): string {
  if (r.host) return 'host';
  if (r.role === 'fire_keeper') return 'fire keeper';
  if (r.role === 'cook_help') return 'kitchen help';
  return 'guest';
}

function csvField(v: unknown) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
