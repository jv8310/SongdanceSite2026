// The exact Drip tags a paid retreat registration receives — extracted as a pure
// function so the live paid-handler (pushPaidRegistrationToDrip) and the
// historical contact-tag backfill compute an identical tag set.

// `product:<slug>` (always, when the product is known) plus the product's own
// `drip_tag` column when set. Mirrors the tag list upsertSubscriber sends.
export function retreatDripTags(
  product: { slug: string; drip_tag: string | null } | null,
): string[] {
  const tags: string[] = [];
  if (product) tags.push(`product:${product.slug}`);
  if (product?.drip_tag) tags.push(product.drip_tag);
  return tags;
}
