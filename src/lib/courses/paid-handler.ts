// Side-effects to run when a course_registration is moved to "paid".
// Called by the Stripe webhook on checkout.session.completed.
//
// Tagging contract (settled with Jacob):
//   - Every cert registration adds `prod_SVH_9m` (always).
//   - The bundle additionally adds `prod_SVH_12w` (foundation access).
//   - If buyer chose "activate now" → custom field `prod_SVH_week` is set to
//     "Ended since YYYY-MM-DD". This mirrors what Jacob's existing Drip
//     automation does at the end of a real 12-week run, so the same
//     downstream workflows pick up cert access without changes.
//   - If buyer chose "wait" (only relevant when they are currently mid-12w
//     OR bought the bundle and prefer to walk it slowly) → custom field
//     `prod_SVH_9m_status` is set to "12w ongoing, not activated". A Drip
//     workflow can then gate cert content until the 12w finishes.

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

// Readable order-item names for the known course products (Drip itemises the
// order with these). Journeys fall back to their slug, which still carries the
// product identity via the item's product_id.
const COURSE_ITEM_LABELS: Record<string, string> = {
  'cc-cert': 'SVH Certification',
  'cc-bundle': 'SVH Certification + Foundation bundle',
  'grief-course': 'The Grief Course',
  'svh-12week': '12-Week SVH Foundation Course',
};

type Env = {
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
  env: Env,
  courseRegistrationId: number,
): Promise<void> {
  const reg = await getCourseRegistrationById(env.DB, courseRegistrationId);
  if (!reg) return;

  try {
    const dripCfg = {
      apiToken: env.DRIP_API_TOKEN,
      accountId: env.DRIP_ACCOUNT_ID,
    };

    const isGrief = reg.product_slug === GRIEF_PRODUCT_SLUG;
    const isTwelveWeek = reg.product_slug === TWELVE_WEEK_PRODUCT_SLUG;
    // Order bumps recorded at checkout (12-week + certification) — granted below
    // alongside the course's own tags + event.
    const purchasedBumps = parsePurchasedBumps(reg.bumps);

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

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

    // The exact tags this registration earns — grief / journeys (honouring the
    // Dutch-edition choice) / 12-week + its order bumps / cert (+ bundle).
    // Extracted so the historical backfill computes an identical set. The Drip
    // EVENT name and the activation custom fields still branch by product below;
    // those aren't mirrored onto the local contacts list.
    const tags = courseDripTags(reg);

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
    } else {
      eventName = env.DRIP_COURSE_EVENT || 'Completed SVH course registration';

      if (reg.activate_choice === 'now') {
        // Activating cert immediately — clear the 12w "in progress" state.
        customFields.prod_SVH_week = `Ended since ${today}`;
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
            name: COURSE_ITEM_LABELS[reg.product_slug] ?? reg.product_slug,
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
