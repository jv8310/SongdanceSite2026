// The segment builder's option lists, loaded in one place for both compose
// pages (SegmentBuilder.astro), plus the names describeSegment prints on the
// broadcast page. Every query is wrapped: a missing table reads as an empty
// list, so a preview before a migration still renders.

import { availableTags, broadcastColumnsReady } from './db';
import {
  broadcastIdsInRules,
  segmentFeatures,
  SEGMENT_COURSES,
  type SegmentFeatures,
  type SegmentNames,
  type SegmentRules,
} from './segment-rules';
import { listSavedSegments, segmentsReady } from './saved-segments';
import { listTopics, type EmailTopic } from '../email/topics';
import { COUNTRIES } from '../countries';

export type SegmentOptions = {
  tags: Array<{ tag: string; n: number }>;
  topics: EmailTopic[];
  broadcasts: Array<{ id: number; name: string; status: string; started_at: string | null }>;
  workshops: Array<{ id: number; label: string }>;
  retreats: Array<{ slug: string; name: string }>;
  albums: Array<{ id: string; title: string }>;
  courses: Array<{ key: string; label: string }>;
  countries: Array<{ code: string; name: string }>;
  saved: Array<{ id: number; name: string }>;
  // rules = the broadcasts.audience_rules column and broadcast_segments (0100).
  features: SegmentFeatures & { rules: boolean };
};

async function rows<T>(p: Promise<D1Result<T>>): Promise<T[]> {
  try {
    return (await p).results ?? [];
  } catch {
    return [];
  }
}

export async function loadSegmentOptions(db: D1Database): Promise<SegmentOptions> {
  const [tags, topics, broadcasts, workshopRows, retreats, albums, saved, feats, cols, segReady] = await Promise.all([
    availableTags(db, 1000),
    listTopics(db),
    rows(
      db
        .prepare(
          `SELECT id, name, status, started_at FROM broadcasts WHERE status != 'draft' ORDER BY id DESC LIMIT 100`,
        )
        .all<{ id: number; name: string; status: string; started_at: string | null }>(),
    ),
    rows(
      db
        .prepare(
          `SELECT w.id AS id, w.title AS title, w.starts_at_utc AS starts, COALESCE(mp.slug, '') AS slug
             FROM workshops w
             LEFT JOIN workshop_products mp ON mp.id = w.main_product_id
            WHERE w.deleted = 0 AND w.is_replay = 0
              AND julianday(w.starts_at_utc) >= julianday('now', '-400 days')
            ORDER BY w.starts_at_utc DESC
            LIMIT 200`,
        )
        .all<{ id: number; title: string; starts: string; slug: string }>(),
    ),
    rows(db.prepare(`SELECT slug, name FROM products WHERE type = 'retreat' ORDER BY id DESC`).all<{ slug: string; name: string }>()),
    rows(db.prepare(`SELECT id, title FROM music_albums ORDER BY sort_order, id`).all<{ id: string; title: string }>()),
    listSavedSegments(db),
    segmentFeatures(db),
    broadcastColumnsReady(db),
    segmentsReady(db),
  ]);
  return {
    tags,
    topics,
    broadcasts,
    workshops: workshopRows.map((w) => ({ id: w.id, label: workshopLabel(w) })),
    retreats,
    albums,
    courses: SEGMENT_COURSES.map((c) => ({ key: c.key, label: c.label })),
    countries: COUNTRIES.map((c) => ({ code: c.code, name: c.name })),
    saved: saved.map((s) => ({ id: s.id, name: s.name })),
    features: { ...feats, rules: cols.rules && segReady },
  };
}

function workshopLabel(w: { title: string; starts: string; slug: string }): string {
  const kind = w.slug.includes('masterclass') ? 'Masterclass' : 'Workshop';
  return `${String(w.starts ?? '').slice(0, 10)} · ${kind} · ${w.title}`;
}

// Custom-field keys across the contact list with how many contacts carry each —
// fetched on demand (the builder's first field condition), never on page load.
export async function customFieldKeys(db: D1Database): Promise<Array<{ key: string; n: number }>> {
  return rows(
    db
      .prepare(
        `SELECT j.key AS key, COUNT(*) AS n
           FROM contacts c, json_each(CASE WHEN json_valid(c.custom) THEN c.custom ELSE '{}' END) j
          GROUP BY j.key ORDER BY n DESC LIMIT 200`,
      )
      .all<{ key: string; n: number }>(),
  );
}

// Names for describeSegment: the broadcasts a rule set names (only those), the
// topics, the sessions and retreats, the albums.
export async function segmentNames(db: D1Database, rules: SegmentRules | null | undefined): Promise<SegmentNames> {
  const ids = broadcastIdsInRules(rules);
  const [bc, topics, ws, rt, al] = await Promise.all([
    ids.length
      ? rows(
          db
            .prepare(`SELECT id, name FROM broadcasts WHERE id IN (SELECT value FROM json_each(?))`)
            .bind(JSON.stringify(ids))
            .all<{ id: number; name: string }>(),
        )
      : Promise.resolve([]),
    listTopics(db),
    rows(
      db
        .prepare(
          `SELECT w.id AS id, w.title AS title, w.starts_at_utc AS starts, COALESCE(mp.slug, '') AS slug
             FROM workshops w LEFT JOIN workshop_products mp ON mp.id = w.main_product_id
            WHERE w.id IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify(workshopIdsInRules(rules)))
        .all<{ id: number; title: string; starts: string; slug: string }>(),
    ),
    rows(db.prepare(`SELECT slug, name FROM products WHERE type = 'retreat'`).all<{ slug: string; name: string }>()),
    rows(db.prepare(`SELECT id, title FROM music_albums`).all<{ id: string; title: string }>()),
  ]);
  return {
    broadcasts: new Map(bc.map((b) => [b.id, b.name])),
    topics: new Map(topics.map((t) => [t.key, t.name])),
    workshops: new Map(ws.map((w) => [w.id, workshopLabel(w)])),
    retreats: new Map(rt.map((r) => [r.slug, r.name])),
    albums: new Map(al.map((a) => [a.id, a.title])),
  };
}

function workshopIdsInRules(r: SegmentRules | null | undefined): number[] {
  if (!r) return [];
  const out = new Set<number>();
  for (const x of r.conditions) {
    const list = 'type' in x ? [x] : x.conditions;
    for (const c of list) if (c.type === 'booked' && c.workshopId) out.add(c.workshopId);
  }
  return [...out];
}
