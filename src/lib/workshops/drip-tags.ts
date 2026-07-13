// The exact Drip tags a paid/comped workshop registration receives — extracted
// as a pure function so the live paid-handler (src/lib/workshops/paid-handler.ts)
// and the historical contact-tag backfill (src/lib/contacts/tag-backfill.ts)
// compute an identical tag set and can never drift.

// The page's audience doors → readable lens names, used for Drip segmentation.
const AUDIENCE_LENSES: Record<string, string> = { '1': 'healing', '2': 'freedom', '3': 'pro' };

// The chosen audience doors ("3", "1,3", …) → lens names ("pro", …). A null/blank
// audience yields none, so a lens learned earlier is never erased.
export function audienceLensesFor(audience: string | null | undefined): string[] {
  return (audience ?? '')
    .split(',')
    .map((d) => AUDIENCE_LENSES[d.trim()])
    .filter(Boolean);
}

// Tags: the source tag (a registration's own overrides its workshop's), the
// order bump's product tag when the bump was taken, and one `svh_audience_<lens>`
// per audience door chosen. `bump` is the resolved workshop_products row (the
// caller fetches it only when wants_bump + the workshop has a bump product), or
// null. Mirrors the tag list that upsertSubscriber sends in tagInDrip.
export function workshopDripTags(
  reg: { source_tag: string | null; wants_bump: number; audience: string | null },
  workshop: { source_tag: string | null; bump_product_id: number | null },
  bump: { drip_tag: string | null; slug: string } | null,
): string[] {
  const tags: string[] = [];
  if (reg.source_tag) tags.push(reg.source_tag);
  else if (workshop.source_tag) tags.push(workshop.source_tag);
  if (reg.wants_bump && workshop.bump_product_id && bump) {
    tags.push(bump.drip_tag || `prod_${bump.slug}`);
  }
  for (const lens of audienceLensesFor(reg.audience)) tags.push(`svh_audience_${lens}`);
  return tags;
}
