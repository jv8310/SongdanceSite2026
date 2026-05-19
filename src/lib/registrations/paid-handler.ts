// Side-effects to run when a registration moves into the "paid" state.
// Shared by the Stripe webhook (real production payments) and the admin
// "Mark paid" button (a fallback for when the webhook didn't fire or
// for the admin-test €1 path).
//
// Idempotency note: Drip's "events" endpoint accepts duplicate events
// without erroring, so re-running this is safe. The webhook in addition
// guards against duplicate Stripe event IDs via eventExists().

import { getRegistrationById, logEvent } from './db';
import { recordEvent, upsertSubscriber } from './drip';

type Env = {
  DB: D1Database;
  DRIP_API_TOKEN: string;
  DRIP_ACCOUNT_ID: string;
  DRIP_REGISTRATION_EVENT: string;
};

export async function pushPaidRegistrationToDrip(
  env: Env,
  registrationId: number,
): Promise<void> {
  const reg = await getRegistrationById(env.DB, registrationId);
  if (!reg) return;

  try {
    const product = await env.DB.prepare(
      'SELECT name, slug, starts_at, ends_at, drip_tag FROM products WHERE id = ?',
    )
      .bind(reg.product_id)
      .first<{
        name: string;
        slug: string;
        starts_at: string | null;
        ends_at: string | null;
        drip_tag: string | null;
      }>();
    const tier = await env.DB.prepare('SELECT name, slug FROM tiers WHERE id = ?')
      .bind(reg.tier_id)
      .first<{ name: string; slug: string }>();

    const dripCfg = {
      apiToken: env.DRIP_API_TOKEN,
      accountId: env.DRIP_ACCOUNT_ID,
    };

    const tags: string[] = [];
    if (product) tags.push(`product:${product.slug}`);
    if (product?.drip_tag) tags.push(product.drip_tag);

    await upsertSubscriber(dripCfg, {
      email: reg.email,
      first_name: reg.first_name ?? reg.name.split(' ')[0],
      last_name:
        reg.last_name ??
        (reg.name.split(' ').slice(1).join(' ') || undefined),
      country: reg.country,
      phone: reg.phone,
      custom_fields: {
        last_product: product?.slug ?? '',
        last_tier: tier?.slug ?? '',
        last_amount_eur: (reg.amount_cents / 100).toFixed(2),
        phone_country: reg.phone_country,
        company_name: reg.company_name,
        vat_number: reg.vat_number,
        billing_address: reg.address,
        dietary: reg.dietary,
        registration_notes: reg.notes,
        consent_framework: reg.consent_framework ? 'yes' : 'no',
        consent_terms: reg.consent_terms ? 'yes' : 'no',
        consent_at: reg.consent_at,
        role: reg.role,
        role_discount_eur:
          reg.role_discount_cents > 0
            ? (reg.role_discount_cents / 100).toFixed(2)
            : null,
      },
      tags: tags.length ? tags : undefined,
    });

    await recordEvent(
      dripCfg,
      reg.email,
      env.DRIP_REGISTRATION_EVENT || 'Completed retreat registration',
      {
        registration_id: reg.id,
        product_slug: product?.slug ?? '',
        product_name: product?.name ?? '',
        tier_slug: tier?.slug ?? '',
        tier_name: tier?.name ?? '',
        amount: (reg.amount_cents / 100).toFixed(2),
        currency: reg.currency,
        starts_at: product?.starts_at ?? '',
        ends_at: product?.ends_at ?? '',
        first_name: reg.first_name ?? '',
        last_name: reg.last_name ?? '',
        country: reg.country ?? '',
        phone: reg.phone ?? '',
        dietary: reg.dietary ?? '',
        notes: reg.notes ?? '',
        company_name: reg.company_name ?? '',
        vat_number: reg.vat_number ?? '',
        role: reg.role ?? '',
        role_discount_eur:
          reg.role_discount_cents > 0
            ? (reg.role_discount_cents / 100).toFixed(2)
            : '',
      },
    );
  } catch (err) {
    await logEvent(env.DB, {
      registration_id: registrationId,
      kind: 'drip.error',
      source: 'system',
      payload: { error: String(err) },
    });
  }
}
