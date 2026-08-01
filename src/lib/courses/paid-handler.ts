// Side-effects to run when a course_registration is moved to "paid".
// Called by the Stripe webhook on checkout.session.completed.
//
// Tagging contract (settled with Jacob):
//   - Every cert registration adds `prod_SVH_9m` (always).
//   - The bundle additionally adds `prod_SVH_12w` (foundation access).
//   - If buyer chose "activate now" → they are on the certification course, so
//     the week counter reads "Ongoing Certification" (custom field
//     `prod_SVH_week`) and `prod_SVH_9m_status` is set to "activated".
//   - If buyer chose "wait" (only relevant when they are currently mid-12w
//     OR bought the bundle and prefer to walk it slowly) → custom field
//     `prod_SVH_9m_status` is set to "12w ongoing, not activated". A Drip
//     workflow can then gate cert content until the 12w finishes.
//
// The week counter (src/lib/courses/week-progress.ts) is started here too, for
// every order that carries the 12-week course — the standalone course, and the
// certification path when the buyer chose to walk the foundation first. It is
// the site's own record; `prod_SVH_week` below is its published copy, so the
// cert page's variant gate and Jacob's Drip automations see the same number.

import { getCourseRegistrationById, parsePurchasedBumps } from './db';
import { logEvent } from '../registrations/db';
import { recordEvent, upsertSubscriber } from '../registrations/drip';
import { GRIEF_DRIP_EVENT, GRIEF_PRODUCT_SLUG } from './grief';
import { TWELVE_WEEK_DRIP_EVENT, TWELVE_WEEK_PRODUCT_SLUG } from './twelve-week';
import { isJourneySlug, journeyDrip } from './journeys';
import { BUMPS, isBumpSlug } from './bumps';
import { courseDripTags } from './drip-tags';
import { mirrorTagsToContact } from '../contacts/mirror';
import { sendCoursePurchaseEvent } from './meta';
import { recordPurchaseOrder, type PurchaseOrderItem } from '../orders/drip-order';
import { getAlbum, type MusicAlbumRow } from '../music/db';
import { albumIdFromProductSlug, isAlbumProductSlug } from '../music/product';
import {
  describeWeekProgress,
  markCertificationOngoing,
  recordWeekProgressSync,
  startTwelveWeekProgress,
} from './week-progress';
import { WEEK_FIELD } from './week-sync';

// Readable order-item names for the known course products (Drip itemises the
// order with these). Journeys fall back to their slug, which still carries the
// product identity via the item's product_id.
const COURSE_ITEM_LABELS: Record<string, string> = {
  'cc-cert': 'SVH Certification',
  'cc-bundle': 'SVH Certification + Foundation bundle',
  'grief-course': 'The Grief Course',
  'svh-12week': '12-Week SVH Foundation Course',
};

export type CoursePaidHandlerEnv = {
  DB: D1Database;
  DRIP_API_TOKEN: string;
  DRIP_ACCOUNT_ID: string;
  DRIP_COURSE_EVENT?: string;
  // Meta Conversions API (optional — Purchase only fires when both are set).
  META_PIXEL_ID?: string;
  META_ACCESS_TOKEN?: string;
  PUBLIC_BASE_URL?: string;
};

export async function pushPaidCourseRegistrationToDrip(
  env: CoursePaidHandlerEnv,
  courseRegistrationId: number,
): Promise<void> {
  const reg = await getCourseRegistrationById(env.DB, courseRegistrationId);
  if (!reg) return;

  // The week counter is OUR record, so it is written first and independently of
  // everything below — a Drip outage must never leave a paying student without
  // a week. Idempotent: installment re-calls and the reconciles all land here
  // and none of them may move someone's start date.
  const progress = await updateWeekCounter(env.DB, reg);

  try {
    const dripCfg = {
      apiToken: env.DRIP_API_TOKEN,
      accountId: env.DRIP_ACCOUNT_ID,
    };

    const isGrief = reg.product_slug === GRIEF_PRODUCT_SLUG;
    const isTwelveWeek = reg.product_slug === TWELVE_WEEK_PRODUCT_SLUG;
    // A direct music-album purchase (product slug `album-<id>`): the album's
    // access tag lives on its music_albums row, not in code — look it up so the
    // tag set below carries it. A deleted/renamed album leaves tags empty; the
    // buyer still has access via their paid registration row (music/access.ts).
    let album: MusicAlbumRow | null = null;
    if (isAlbumProductSlug(reg.product_slug)) {
      album = await getAlbum(env.DB, albumIdFromProductSlug(reg.product_slug));
    }
    // Order bumps recorded at checkout (12-week + certification) — granted below
    // alongside the course's own tags + event.
    const purchasedBumps = parsePurchasedBumps(reg.bumps);

    const customFields: Record<string, string | number | null> = {
      last_product: reg.product_slug,
      last_amount_eur: (reg.amount_cents / 100).toFixed(2),
      payment_plan: reg.payment_plan,
      installments_total: reg.installments_total,
      phone_country: reg.phone_country,
      consent_terms: reg.consent_terms ? 'yes' : 'no',
      consent_at: reg.consent_at,
      source_variant: reg.source_variant,
    };

    // Publish the week counter onto the profile field the cert page's variant
    // gate and Jacob's automations read — "1" at the start of a foundation run,
    // "Ongoing Certification" for someone who took the certification straight
    // away. Recorded as synced after the upsert below, so the hourly sweep
    // doesn't write the same value a second time.
    const weekFieldValue = progress ? describeWeekProgress(progress).fieldValue : null;
    if (weekFieldValue) customFields[WEEK_FIELD] = weekFieldValue;

    // The exact tags this registration earns — grief / journeys (honouring the
    // Dutch-edition choice) / 12-week + its order bumps / cert (+ bundle).
    // Extracted so the historical backfill computes an identical set. The Drip
    // EVENT name and the activation custom fields still branch by product below;
    // those aren't mirrored onto the local contacts list. Album purchases get
    // their tag from the album row (courseDripTags returns [] for them).
    const tags = courseDripTags(reg);
    if (album?.drip_tag?.trim()) tags.push(album.drip_tag.trim());

    // Mirror those tags onto the local People/contacts list — a local write,
    // independent of the Drip push below (so it happens even if Drip is down).
    // Best-effort; never blocks fulfilment.
    await mirrorTagsToContact(env, {
      email: reg.email,
      name: [reg.first_name, reg.last_name].filter(Boolean).join(' ') || null,
      timezone: reg.timezone,
      country: reg.country,
      tags,
      source: 'course-order',
    });

    let eventName: string;
    if (isGrief) {
      eventName = GRIEF_DRIP_EVENT;
    } else if (isJourneySlug(reg.product_slug)) {
      // The Three Journeys (+ ASJ PRO mantra pack, + all-three bundle) — the
      // event carries the same identity the tags do; the buyer's Dutch/English
      // choice rides along as a `journey_language` custom field.
      eventName = journeyDrip(reg.product_slug, reg.language_choice).event;
      if (reg.language_choice) customFields.journey_language = reg.language_choice;
    } else if (isTwelveWeek) {
      // The standalone 12-week foundation course. `prod_SVH_12w` (applied above)
      // is the same foundation-access tag the cert bundle grants — Jacob's
      // existing Drip automation drives the per-week `svh_week` field from there.
      eventName = TWELVE_WEEK_DRIP_EVENT;
    } else if (isAlbumProductSlug(reg.product_slug)) {
      // Direct music-album purchase. The tag (applied above) is the access key;
      // the event carries which album for any automation that wants it.
      eventName = 'Completed music album purchase';
      customFields.last_album = album?.title ?? reg.product_slug;
    } else {
      eventName = env.DRIP_COURSE_EVENT || 'Completed SVH course registration';

      if (reg.activate_choice === 'now') {
        // Activating cert immediately. The week field (set above) already reads
        // "Ongoing Certification"; this is the stable hook for any Drip
        // automation that gates certification content.
        customFields.prod_SVH_9m_status = 'activated';
      } else if (reg.activate_choice === 'wait') {
        customFields.prod_SVH_9m_status = '12w ongoing, not activated';
      }
    }

    await upsertSubscriber(dripCfg, {
      email: reg.email,
      first_name: reg.first_name ?? undefined,
      last_name: reg.last_name ?? undefined,
      country: reg.country,
      phone: reg.phone,
      time_zone: reg.timezone,
      custom_fields: customFields,
      tags,
    });

    // The profile field now carries this value — note it so the hourly sweep
    // only writes again when the week actually turns over.
    if (progress && weekFieldValue) {
      await recordWeekProgressSync(env.DB, progress.email, weekFieldValue);
    }

    await recordEvent(
      dripCfg,
      reg.email,
      eventName,
      {
        course_registration_id: reg.id,
        product_slug: reg.product_slug,
        amount: (reg.amount_cents / 100).toFixed(2),
        currency: reg.currency,
        payment_plan: reg.payment_plan,
        installments_total: reg.installments_total,
        activate_choice: reg.activate_choice ?? '',
        journey_language: reg.language_choice ?? '',
        source_variant: reg.source_variant ?? '',
        first_name: reg.first_name ?? '',
        last_name: reg.last_name ?? '',
        country: reg.country ?? '',
        phone: reg.phone ?? '',
      },
    );

    // Order bumps: fire each add-on's own completion event so the standalone
    // enrolment automation grants it exactly as a direct purchase would (the
    // product tag was already applied in the upsert above). Per-bump guarded so
    // one hiccup never blocks the others or course access itself.
    for (const b of purchasedBumps) {
      if (!isBumpSlug(b.slug)) continue;
      try {
        await recordEvent(dripCfg, reg.email, BUMPS[b.slug].dripEvent, {
          course_registration_id: reg.id,
          product_slug: b.slug,
          bump: 'yes',
          amount: (b.amount_cents / 100).toFixed(2),
          currency: reg.currency,
          first_name: reg.first_name ?? '',
          last_name: reg.last_name ?? '',
        });
      } catch (err) {
        await logEvent(env.DB, {
          registration_id: null,
          kind: 'drip.course.bump.error',
          source: 'system',
          payload: {
            course_registration_id: reg.id,
            bump: b.slug,
            error: String(err),
          },
        });
      }
    }

    // Native Drip ecommerce order — drives lifetime value + ecommerce segments.
    // The order's grand total is the course price plus every bump (bumps are
    // charged on top of amount_cents). Idempotent on order id `course-<id>`:
    // installment re-calls and admin re-fires fold into one order.
    const bumpItems: PurchaseOrderItem[] = purchasedBumps.map((b) => ({
      name: isBumpSlug(b.slug) ? BUMPS[b.slug].label : b.slug,
      slug: b.slug,
      amountCents: b.amount_cents,
    }));
    const bumpTotalCents = purchasedBumps.reduce((s, b) => s + b.amount_cents, 0);
    await recordPurchaseOrder(
      env,
      {
        type: 'course',
        id: reg.id,
        email: reg.email,
        currency: reg.currency,
        grandTotalCents: reg.amount_cents + bumpTotalCents,
        occurredAt: reg.paid_at,
        items: [
          {
            // Albums itemise under their real title (the slug is `album-<id>`).
            name: album?.title ?? COURSE_ITEM_LABELS[reg.product_slug] ?? reg.product_slug,
            slug: reg.product_slug,
            amountCents: reg.amount_cents,
          },
          ...bumpItems,
        ],
        properties: {
          product_slug: reg.product_slug,
          payment_plan: reg.payment_plan,
          installments_total: reg.installments_total,
          activate_choice: reg.activate_choice ?? '',
          journey_language: reg.language_choice ?? '',
          source_variant: reg.source_variant ?? '',
        },
      },
      'drip.course.order.error',
    );
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'drip.course.error',
      source: 'system',
      payload: {
        course_registration_id: courseRegistrationId,
        error: String(err),
      },
    });
  }

  // Meta CAPI Purchase — only for a real, paid order. Deduplicated against the
  // browser Pixel Purchase on the thank-you page via the deterministic
  // `cpur-{id}` event id, so the per-installment re-calls of this hook and the
  // browser send all fold into one Meta event. Best-effort: never block
  // fulfillment. (Free checkout calls this with amount 0 — guarded out.)
  if (reg.amount_cents > 0 && env.META_PIXEL_ID && env.META_ACCESS_TOKEN) {
    try {
      await sendCoursePurchaseEvent(env, reg);
    } catch (err) {
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'course.meta.error',
        source: 'system',
        payload: {
          course_registration_id: courseRegistrationId,
          error: String(err),
        },
      });
    }
  }
}

// Start (or move) the person's 12-week counter for this order.
//
//   svh-12week            → a foundation run begins, counting from the payment.
//   cc-bundle + "wait"    → the path bought slowly: the same foundation run.
//   cc-cert   + "wait"    → bought mid-foundation. Their clock is already
//                           running from the earlier 12-week order, so this
//                           rides it rather than starting or restarting one.
//   cert / path + "now"   → they are on the certification course; the counter
//                           stops and reads "Ongoing Certification".
//
// Everything else (grief, journeys, albums) has no counter. Best-effort — a
// failure here is logged and never blocks fulfilment.
async function updateWeekCounter(
  db: D1Database,
  reg: {
    id: number;
    email: string;
    product_slug: string;
    activate_choice: string | null;
    paid_at: string | null;
    created_at: string;
  },
) {
  const startedAt = reg.paid_at ?? reg.created_at;
  try {
    const startClock = (carriesTwelveWeek: boolean) =>
      startTwelveWeekProgress(db, {
        email: reg.email,
        startedAt,
        courseRegistrationId: reg.id,
        productSlug: reg.product_slug,
        carriesTwelveWeek,
      });

    if (reg.product_slug === TWELVE_WEEK_PRODUCT_SLUG) return await startClock(true);
    if (reg.product_slug === 'cc-cert' || reg.product_slug === 'cc-bundle') {
      if (reg.activate_choice === 'wait') {
        return await startClock(reg.product_slug === 'cc-bundle');
      }
      return await markCertificationOngoing(db, reg.email, {
        source: 'purchase',
        at: startedAt,
        courseRegistrationId: reg.id,
        productSlug: reg.product_slug,
      });
    }
    return null;
  } catch (err) {
    await logEvent(db, {
      registration_id: null,
      kind: 'course.week.progress.error',
      source: 'system',
      payload: { course_registration_id: reg.id, error: String(err) },
    }).catch(() => {});
    return null;
  }
}
