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

import { getCourseRegistrationById } from './db';
import { logEvent } from '../registrations/db';
import { recordEvent, upsertSubscriber } from '../registrations/drip';
import { GRIEF_DRIP_EVENT, GRIEF_DRIP_TAG, GRIEF_PRODUCT_SLUG } from './grief';
import {
  TWELVE_WEEK_DRIP_EVENT,
  TWELVE_WEEK_DRIP_TAG,
  TWELVE_WEEK_PRODUCT_SLUG,
} from './twelve-week';
import { DRIP_BY_SLUG, isJourneySlug } from './journeys';
import { sendCoursePurchaseEvent } from './meta';

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

    // Tagging differs by course. The grief course is a standalone thematic
    // product — a single tag, no SVH activation state. The SVH cert/bundle
    // carries the path-of-becoming tags plus the 12-week activation fields.
    let tags: string[];
    let eventName: string;
    if (isGrief) {
      tags = [GRIEF_DRIP_TAG];
      eventName = GRIEF_DRIP_EVENT;
    } else if (isJourneySlug(reg.product_slug)) {
      // The Three Journeys (+ ASJ PRO mantra pack, + all-three bundle). The slug
      // maps to its own set of product tags — e.g. asj-pro grants both
      // prod_ASJ and prod_ASJ_PRO; the bundle grants all three journey tags,
      // and the bundle-PRO adds prod_ASJ_PRO on top.
      const drip = DRIP_BY_SLUG[reg.product_slug];
      tags = drip.tags;
      eventName = drip.event;
    } else if (isTwelveWeek) {
      // The standalone 12-week foundation course. `prod_SVH_12w` is the same
      // foundation-access tag the cert bundle grants — Jacob's existing Drip
      // automation drives the per-week `svh_week` field from there, so we don't
      // set it here.
      tags = [TWELVE_WEEK_DRIP_TAG];
      eventName = TWELVE_WEEK_DRIP_EVENT;
    } else {
      tags = ['prod_SVH_9m'];
      if (reg.product_slug === 'cc-bundle') tags.push('prod_SVH_12w');
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
        source_variant: reg.source_variant ?? '',
        first_name: reg.first_name ?? '',
        last_name: reg.last_name ?? '',
        country: reg.country ?? '',
        phone: reg.phone ?? '',
      },
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
