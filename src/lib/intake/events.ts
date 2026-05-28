// Registry of retreats that have an intake.
//
// All retreats are managed via the admin UI (`/admin/intakes/retreats`)
// and stored in the `intake_retreats` table. This file keeps the
// resolver shape (so the public form + the assessor know how to render
// an unknown code) but no longer ships hardcoded entries — add new
// retreats through the admin.

export type EventCode = string;

export interface EventDefinition {
  code: EventCode;
  label: { nl: string; en: string };
  // 1–2 lines that ground the assessor about THIS specific container.
  flavour: string;
}

// Intentionally empty: every retreat lives in the DB now. Kept as a
// const export so the rest of the resolver chain doesn't need to
// special-case "no built-ins".
export const EVENTS: Record<EventCode, EventDefinition> = {};

const FALLBACK_LABEL: EventDefinition['label'] = {
  nl: 'Songdance Retreat',
  en: 'Songdance Retreat',
};

export function resolveEvent(code: string | null | undefined): EventDefinition {
  const trimmed = (code ?? '').trim();
  if (trimmed && Object.prototype.hasOwnProperty.call(EVENTS, trimmed)) {
    return EVENTS[trimmed];
  }
  return {
    code: trimmed || 'unknown',
    label: FALLBACK_LABEL,
    flavour:
      'Onbekend event-code. Beoordeel met algemene SVH-zorgvuldigheid; flag de onbekende route in de samenvatting.',
  };
}

export function isKnownEvent(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVENTS, code);
}

// DB-aware variant — checks the admin-managed `intake_retreats` table
// first, then falls back to the hardcoded EVENTS map. Used by the
// public intake page and the /api/intake/submit endpoint so newly
// added retreats are accepted without a code deploy.
export async function resolveEventWithDb(
  db: D1Database | undefined,
  code: string | null | undefined,
): Promise<EventDefinition> {
  const trimmed = (code ?? '').trim();
  if (!trimmed) return resolveEvent(trimmed);
  if (db) {
    try {
      const row = await db
        .prepare(
          `SELECT slug, name, flavour FROM intake_retreats WHERE slug = ? AND active = 1`,
        )
        .bind(trimmed)
        .first<{ slug: string; name: string; flavour: string | null }>();
      if (row) {
        return {
          code: row.slug,
          label: { nl: row.name, en: row.name },
          flavour:
            row.flavour && row.flavour.trim()
              ? row.flavour.trim()
              : 'Songdance retreat. Beoordeel met algemene SVH-zorgvuldigheid.',
        };
      }
    } catch {
      // Table may not exist yet pre-migration — ignore and fall back.
    }
  }
  return resolveEvent(trimmed);
}

export async function isKnownEventWithDb(
  db: D1Database | undefined,
  code: string,
): Promise<boolean> {
  if (isKnownEvent(code)) return true;
  if (!db) return false;
  try {
    const row = await db
      .prepare(`SELECT slug FROM intake_retreats WHERE slug = ? AND active = 1`)
      .bind(code)
      .first<{ slug: string }>();
    return !!row;
  } catch {
    return false;
  }
}
