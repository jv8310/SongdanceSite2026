// The browser Pixel Purchase fires ONCE per order — on the first render of a
// thank-you/countdown page that shows it as paid — never on a later visit.
//
// The Pixel and the server CAPI share a deterministic event_id (`wpur-<id>` /
// `cpur-<id>`), but Meta only folds events with the same id together inside a
// ~48h window. /workshop/success is the page every confirmation and reminder
// links to ("Join"), and it is reloaded while people wait for the Join button,
// so it used to send a fresh Purchase on every visit: one buyer became several
// purchases in Meta, days apart, each credited to whatever ad they had clicked —
// Meta's cost per result read far lower than ours (October 2026).
//
// The claim is an `events` row keyed on the event id. A failed claim (D1 blip)
// fires nothing: the server CAPI Purchase already reports every sale, so a
// missed browser send only costs match signals, while a duplicate costs a sale.
export async function claimBrowserPurchase(db: D1Database, eventId: string): Promise<boolean> {
  try {
    const r = await db
      .prepare(
        `INSERT OR IGNORE INTO events (registration_id, kind, source, external_id)
         VALUES (NULL, 'meta.pixel.purchase', 'system', ?)`,
      )
      .bind(`pixel-purchase-${eventId}`)
      .run();
    return (r.meta?.changes ?? 0) > 0;
  } catch {
    return false;
  }
}
