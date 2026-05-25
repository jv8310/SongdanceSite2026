// Side-effects to run when a course_registration is moved to "paid".
// Called by the Stripe webhook on checkout.session.completed.
//
// Tagging contract (settled with Jacob):
//   - Every cert registration adds `prod_SVH_9m` (always).
//   - The bundle additionally adds `prod_SVH_12w` (foundation access).
//   - If buyer chose "activate now" → custom field `svh_week` is set to
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

type Env = {
  DB: D1Database;
  DRIP_API_TOKEN: string;
  DRIP_ACCOUNT_ID: string;
  DRIP_COURSE_EVENT?: string;
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

    const tags: string[] = ['prod_SVH_9m'];
    if (reg.product_slug === 'cc-bundle') tags.push('prod_SVH_12w');

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

    if (reg.activate_choice === 'now') {
      // Activating cert immediately — clear the 12w "in progress" state.
      customFields.svh_week = `Ended since ${today}`;
      customFields.prod_SVH_9m_status = 'activated';
    } else if (reg.activate_choice === 'wait') {
      customFields.prod_SVH_9m_status = '12w ongoing, not activated';
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
      env.DRIP_COURSE_EVENT || 'Completed SVH course registration',
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
}
