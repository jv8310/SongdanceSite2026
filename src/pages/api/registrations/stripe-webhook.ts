import type { APIRoute } from 'astro';
import {
  eventExists,
  getRegistrationById,
  getRegistrationByPaymentIntent,
  getRegistrationBySession,
  logEvent,
  markRegistrationPaid,
  markRegistrationRefunded,
} from '../../../lib/registrations/db';
import {
  computeInstallmentCancelAt,
  retrieveChargeWithInvoice,
  retrieveSubscriptionWithLatestInvoice,
  setSubscriptionCancelAt,
  verifyStripeSignature,
} from '../../../lib/registrations/stripe';
import { pushPaidRegistrationToDrip } from '../../../lib/registrations/paid-handler';
import {
  attachStripeSubscriptionToCourse,
  type CourseRegistration,
  getCourseRegistrationById,
  getCourseRegistrationByPaymentIntent,
  getCourseRegistrationBySession,
  getCourseRegistrationBySubscription,
  markCourseRegistrationCancelled,
  markCourseRegistrationPaid,
  markCourseRegistrationRefunded,
  recordInstallmentPaid,
  type SubscriptionStatus,
  updateCourseSubscriptionStatus,
} from '../../../lib/courses/db';
import { pushPaidCourseRegistrationToDrip } from '../../../lib/courses/paid-handler';
import {
  handleWorkshopCheckoutCompleted,
  handleWorkshopDispute,
  handleWorkshopRefund,
} from '../../../lib/workshops/webhook';

// Dedup-on-invoice-id wrapper around recordInstallmentPaid. Both
// `invoice.paid` and the `checkout.session.completed` subscription backstop
// can land on the same first invoice; we log a `course.installment.recorded`
// event with the Stripe invoice id as `external_id` so the second caller
// becomes a no-op. Returns true if this call actually bumped the count.
async function recordCourseInvoiceIfNew(
  env: { DB: D1Database; DRIP_API_TOKEN: string; DRIP_ACCOUNT_ID: string; DRIP_COURSE_EVENT?: string },
  courseReg: CourseRegistration,
  invoiceId: string,
  paymentIntent: string | null,
): Promise<boolean> {
  const already = await env.DB
    .prepare(
      `SELECT 1 AS one FROM events
        WHERE kind = 'course.installment.recorded'
          AND external_id = ?`,
    )
    .bind(invoiceId)
    .first<{ one: number }>();
  if (already) return false;

  const wasFirstPayment = courseReg.installments_paid === 0;
  await recordInstallmentPaid(env.DB, courseReg.id, paymentIntent);
  await logEvent(env.DB, {
    registration_id: null,
    kind: 'course.installment.recorded',
    source: 'system',
    external_id: invoiceId,
    payload: {
      course_registration_id: courseReg.id,
      invoice_id: invoiceId,
      payment_intent: paymentIntent,
    },
  });
  if (wasFirstPayment) {
    await pushPaidCourseRegistrationToDrip(env, courseReg.id);
  }
  return true;
}

// Invoicing note: Quaderno is connected to Stripe via Quaderno's own Stripe
// integration, so invoices are created automatically by Quaderno when a
// Stripe payment completes (reading the Stripe customer's tax_id for B2B,
// and applying the configured 21% Belgian VAT for this physical event).
// We therefore do not call the Quaderno API from this webhook.

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const sig = request.headers.get('Stripe-Signature');
  const body = await request.text();
  if (!sig) return new Response('Missing signature', { status: 400 });

  const ok = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('Bad signature', { status: 400 });

  const event = JSON.parse(body) as {
    id: string;
    type: string;
    data: { object: any };
  };

  // Idempotency: skip if we've seen this event id before.
  if (await eventExists(env.DB, event.id)) {
    return new Response('OK (duplicate)', { status: 200 });
  }

  await logEvent(env.DB, {
    registration_id: null,
    kind: event.type,
    source: 'stripe',
    external_id: event.id,
    payload: event.data.object,
  });

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as {
      id: string;
      mode?: 'payment' | 'subscription' | 'setup';
      payment_intent: string | null;
      subscription: string | null;
      customer_details?: {
        name?: string;
        email?: string;
        address?: { country?: string };
      };
      amount_total: number;
      currency: string;
      metadata?: Record<string, string>;
    };

    // Workshop checkouts carry `workshop_registration_id`. Handle them first
    // (own tables, own idempotency on the payment row) and early-return so the
    // retreat/course routing below never sees them.
    const ctx = (locals.runtime as any)?.ctx;
    const handledWorkshop = await handleWorkshopCheckoutCompleted(
      env,
      session as any,
      ctx ? { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) } : undefined,
    );
    if (handledWorkshop) {
      return new Response('OK (workshop)', { status: 200 });
    }

    // Route by metadata: retreat checkouts carry `registration_id`,
    // course checkouts carry `course_registration_id`. We try the course
    // path first because it's a strict-id match.
    const courseRegId = session.metadata?.course_registration_id
      ? parseInt(session.metadata.course_registration_id, 10)
      : null;

    if (courseRegId || (!session.metadata?.registration_id)) {
      const courseReg =
        (courseRegId
          ? await getCourseRegistrationById(env.DB, courseRegId)
          : null) ??
        (await getCourseRegistrationBySession(env.DB, session.id));

      if (courseReg) {
        // Subscription mode. Store the subscription id, set cancel_at on
        // the underlying Stripe Subscription (Checkout doesn't accept
        // `subscription_data[cancel_at]`), and then backstop the first
        // installment ourselves: fetch the subscription's latest_invoice
        // and treat it as if invoice.paid had fired. This makes the flow
        // resilient to a webhook endpoint that isn't subscribed to
        // invoice.paid (or to a delayed delivery). The dedup is keyed on
        // invoice id via `recordCourseInvoiceIfNew`, so a later invoice.paid
        // event for the same first invoice becomes a no-op.
        if (session.mode === 'subscription' && session.subscription) {
          await attachStripeSubscriptionToCourse(
            env.DB,
            courseReg.id,
            session.subscription,
          );
          const installmentCount = parseInt(
            session.metadata?.installment_count ?? '',
            10,
          );
          if (Number.isFinite(installmentCount) && installmentCount > 0) {
            try {
              await setSubscriptionCancelAt(
                env.STRIPE_SECRET_KEY,
                session.subscription,
                computeInstallmentCancelAt(installmentCount),
              );
            } catch (err) {
              await logEvent(env.DB, {
                registration_id: null,
                kind: 'course.subscription.cancel_at.failed',
                source: 'stripe',
                external_id: event.id,
                payload: {
                  course_registration_id: courseReg.id,
                  subscription_id: session.subscription,
                  error: String(err),
                },
              });
            }
          }

          try {
            const sub = await retrieveSubscriptionWithLatestInvoice(
              env.STRIPE_SECRET_KEY,
              session.subscription,
            );
            const inv = sub.latest_invoice;
            if (inv && (inv.paid || inv.status === 'paid')) {
              const refreshed = await getCourseRegistrationById(
                env.DB,
                courseReg.id,
              );
              if (refreshed) {
                await recordCourseInvoiceIfNew(
                  env,
                  refreshed,
                  inv.id,
                  inv.payment_intent,
                );
              }
            }
          } catch (err) {
            await logEvent(env.DB, {
              registration_id: null,
              kind: 'course.subscription.backstop.failed',
              source: 'stripe',
              external_id: event.id,
              payload: {
                course_registration_id: courseReg.id,
                subscription_id: session.subscription,
                error: String(err),
              },
            });
          }
          return new Response('OK (subscription created)', { status: 200 });
        }

        if (courseReg.status !== 'paid' && session.payment_intent) {
          await markCourseRegistrationPaid(
            env.DB,
            courseReg.id,
            session.payment_intent,
          );
        }
        await pushPaidCourseRegistrationToDrip(env, courseReg.id);
        return new Response('OK', { status: 200 });
      }
    }

    const registrationId = session.metadata?.registration_id
      ? parseInt(session.metadata.registration_id, 10)
      : null;
    const reg =
      (registrationId
        ? await getRegistrationById(env.DB, registrationId)
        : null) ??
      (await getRegistrationBySession(env.DB, session.id));

    if (!reg) {
      return new Response('Registration not found', { status: 200 });
    }

    if (reg.status !== 'paid' && session.payment_intent) {
      await markRegistrationPaid(env.DB, reg.id, session.payment_intent);
    }

    // Drip: upsert subscriber + fire the "Completed retreat registration"
    // event so the confirmation email (and any follow-up sequence) is sent
    // from Drip. Shared with the admin "Mark paid" fallback button.
    await pushPaidRegistrationToDrip(env, reg.id);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Stripe-side session expiry. Stripe sessions live up to 24h, but the
  // admin pages also sweep `pending` course rows to `expired` after 15
  // min. This handler is the real-time path: if Stripe fires before any
  // admin visit, the row is already up to date.
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as {
      id: string;
      metadata?: Record<string, string>;
    };
    const courseRegId = session.metadata?.course_registration_id
      ? parseInt(session.metadata.course_registration_id, 10)
      : null;
    const courseReg =
      (courseRegId
        ? await getCourseRegistrationById(env.DB, courseRegId)
        : null) ??
      (await getCourseRegistrationBySession(env.DB, session.id));
    if (courseReg && courseReg.status === 'pending') {
      await env.DB
        .prepare(
          `UPDATE course_registrations
              SET status = 'expired'
            WHERE id = ? AND status = 'pending'`,
        )
        .bind(courseReg.id)
        .run();
    }
    return new Response('OK', { status: 200 });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Subscription installments: every successful monthly charge fires an
  // invoice.paid event. The first one is the "you're in" moment for the
  // student — that's when we grant access (mark paid + Drip handoff).
  // Subsequent ones just bump installments_paid for the admin view.
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as {
      id: string;
      subscription: string | null;
      payment_intent: string | null;
      billing_reason?: string;
      amount_paid: number;
      customer?: string;
      metadata?: Record<string, string>;
      subscription_details?: { metadata?: Record<string, string> };
    };
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) return new Response('OK (no subscription)', { status: 200 });

    // Try the dedicated subscription-id lookup first; fall back to the
    // metadata that Stripe copies onto the subscription (and invoice)
    // for the very first invoice, before our attach happened.
    let courseReg = await getCourseRegistrationBySubscription(
      env.DB,
      subscriptionId,
    );
    const metaCourseRegId =
      invoice.subscription_details?.metadata?.course_registration_id ??
      invoice.metadata?.course_registration_id;
    if (!courseReg && metaCourseRegId) {
      courseReg = await getCourseRegistrationById(
        env.DB,
        parseInt(metaCourseRegId, 10),
      );
      if (courseReg) {
        await attachStripeSubscriptionToCourse(
          env.DB,
          courseReg.id,
          subscriptionId,
        );
      }
    }
    if (!courseReg) {
      return new Response('Subscription not linked', { status: 200 });
    }

    await recordCourseInvoiceIfNew(
      env,
      courseReg,
      invoice.id,
      invoice.payment_intent,
    );

    return new Response('OK', { status: 200 });
  }

  // A failed installment leaves the row in `paid` (access granted on
  // first payment) but logs the failure so the admin sees it. We don't
  // auto-revoke access here — that's a business call, handled manually.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as {
      id: string;
      subscription: string | null;
      attempt_count?: number;
    };
    if (invoice.subscription) {
      const courseReg = await getCourseRegistrationBySubscription(
        env.DB,
        invoice.subscription,
      );
      if (courseReg) {
        await logEvent(env.DB, {
          registration_id: null,
          kind: 'course.installment.failed',
          source: 'stripe',
          external_id: event.id,
          payload: {
            course_registration_id: courseReg.id,
            invoice_id: invoice.id,
            attempt_count: invoice.attempt_count,
          },
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Subscription lifecycle. Fires whenever Stripe changes the
  // subscription record — most importantly: status flips (active →
  // past_due / unpaid / canceled), cancel_at_period_end being toggled
  // on, and the scheduled cancel_at being set/cleared. We mirror
  // `subscription.status` onto the row so the admin sees the live
  // Stripe-side state, without flipping the coarse-grained `status`
  // until the subscription actually ends.
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as {
      id: string;
      status: SubscriptionStatus;
      cancel_at_period_end?: boolean;
      cancel_at?: number | null;
      canceled_at?: number | null;
    };
    const updated = await updateCourseSubscriptionStatus(
      env.DB,
      sub.id,
      sub.status,
    );
    if (!updated) {
      // We saw an updated event before our checkout.session.completed
      // handler had attached the subscription — fine, the next event
      // will land on a linked row. Log so we can spot real desync.
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'course.subscription.updated.unlinked',
        source: 'stripe',
        external_id: `${event.id}.unlinked`,
        payload: {
          subscription_id: sub.id,
          status: sub.status,
          cancel_at_period_end: sub.cancel_at_period_end ?? false,
        },
      });
    }
    return new Response('OK', { status: 200 });
  }

  // Terminal subscription end (cancel_at hit, or admin clicked Cancel
  // in the Stripe dashboard, or every retry attempt for unpaid was
  // exhausted). Flip the row to 'cancelled' so the admin view stops
  // showing 'paid'. We do NOT push to Drip on cancel: Drip already has
  // the original "paid" event, and cancelling a course subscription is
  // a business question (refund? keep access? talk to them?) that the
  // host handles manually.
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as {
      id: string;
      status: SubscriptionStatus;
    };
    const courseReg = await getCourseRegistrationBySubscription(
      env.DB,
      sub.id,
    );
    if (courseReg) {
      await markCourseRegistrationCancelled(env.DB, courseReg.id);
      await logEvent(env.DB, {
        registration_id: null,
        kind: 'course.subscription.cancelled',
        source: 'stripe',
        external_id: `${event.id}.applied`,
        payload: {
          course_registration_id: courseReg.id,
          subscription_id: sub.id,
          final_status: sub.status,
        },
      });
    }
    return new Response('OK', { status: 200 });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Refunds. Fires once per refund operation — for partial refunds the
  // event fires once with `amount_refunded` carrying the running total,
  // and again on each subsequent partial. We add the *delta* (this
  // refund's amount) so a sequence of partials sums correctly even if
  // events arrive out of order.
  //
  // Lookup chain (one-off retreats and first-installment courses both
  // resolve from `payment_intent`; later installments need the
  // charge → invoice → subscription walk):
  //   1. registrations.stripe_payment_intent
  //   2. course_registrations.stripe_payment_intent
  //   3. fetch charge.invoice from Stripe → subscription_id →
  //      course_registrations.stripe_subscription_id
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as {
      id: string;
      payment_intent: string | null;
      amount: number;
      amount_refunded: number;
      refunded: boolean;
      currency: string;
      invoice?: string | null;
      // refunds.data[*].amount is the per-refund amount; we sum the
      // newest one if present, else fall back to amount_refunded.
      refunds?: {
        data?: Array<{
          id: string;
          amount: number;
          created: number;
        }>;
      };
    };

    // Pick the most-recent refund object's amount as the delta for this
    // event. Stripe orders refunds.data with newest first, but we sort
    // defensively in case that ever changes.
    const refundDelta = (() => {
      const list = charge.refunds?.data ?? [];
      if (list.length === 0) return charge.amount_refunded;
      const newest = [...list].sort((a, b) => b.created - a.created)[0];
      return newest?.amount ?? charge.amount_refunded;
    })();

    // 0. Workshop lookup by PaymentIntent (own payment table).
    if (await handleWorkshopRefund(env, charge)) {
      return new Response('OK (workshop refund)', { status: 200 });
    }

    // 1. Retreat lookup by PaymentIntent.
    if (charge.payment_intent) {
      const reg = await getRegistrationByPaymentIntent(
        env.DB,
        charge.payment_intent,
      );
      if (reg) {
        await markRegistrationRefunded(env.DB, reg.id, refundDelta);
        await logEvent(env.DB, {
          registration_id: reg.id,
          kind: 'registration.refunded',
          source: 'stripe',
          external_id: `${event.id}.applied`,
          payload: {
            charge_id: charge.id,
            payment_intent: charge.payment_intent,
            amount_refunded_total: charge.amount_refunded,
            refund_delta: refundDelta,
            currency: charge.currency,
          },
        });
        return new Response('OK', { status: 200 });
      }
    }

    // 2. Course lookup by PaymentIntent (first installment / full
    //    payment plans).
    if (charge.payment_intent) {
      const courseReg = await getCourseRegistrationByPaymentIntent(
        env.DB,
        charge.payment_intent,
      );
      if (courseReg) {
        await markCourseRegistrationRefunded(
          env.DB,
          courseReg.id,
          refundDelta,
        );
        await logEvent(env.DB, {
          registration_id: null,
          kind: 'course.registration.refunded',
          source: 'stripe',
          external_id: `${event.id}.applied`,
          payload: {
            course_registration_id: courseReg.id,
            charge_id: charge.id,
            payment_intent: charge.payment_intent,
            amount_refunded_total: charge.amount_refunded,
            refund_delta: refundDelta,
            currency: charge.currency,
          },
        });
        return new Response('OK', { status: 200 });
      }
    }

    // 3. Course subscription installment 2+ — the PaymentIntent isn't
    //    on our row, so resolve charge → invoice → subscription via the
    //    Stripe API. `charge.invoice` is sometimes a bare id and
    //    sometimes the expanded object depending on event version; we
    //    re-fetch to normalise.
    if (charge.invoice) {
      try {
        const fresh = await retrieveChargeWithInvoice(
          env.STRIPE_SECRET_KEY,
          charge.id,
        );
        const subscriptionId = fresh.invoice?.subscription ?? null;
        if (subscriptionId) {
          const courseReg = await getCourseRegistrationBySubscription(
            env.DB,
            subscriptionId,
          );
          if (courseReg) {
            await markCourseRegistrationRefunded(
              env.DB,
              courseReg.id,
              refundDelta,
            );
            await logEvent(env.DB, {
              registration_id: null,
              kind: 'course.registration.refunded',
              source: 'stripe',
              external_id: `${event.id}.applied`,
              payload: {
                course_registration_id: courseReg.id,
                charge_id: charge.id,
                subscription_id: subscriptionId,
                amount_refunded_total: charge.amount_refunded,
                refund_delta: refundDelta,
                currency: charge.currency,
                lookup: 'invoice.subscription',
              },
            });
            return new Response('OK', { status: 200 });
          }
        }
      } catch (err) {
        await logEvent(env.DB, {
          registration_id: null,
          kind: 'charge.refunded.lookup.failed',
          source: 'stripe',
          external_id: `${event.id}.lookup_failed`,
          payload: { charge_id: charge.id, error: String(err) },
        });
      }
    }

    // None of our rows match this refund — likely a charge we don't
    // own (e.g. test data, or an unrelated Stripe customer if this key
    // is shared). Log and move on; the initial logEvent at the top of
    // the handler already captured the full payload.
    await logEvent(env.DB, {
      registration_id: null,
      kind: 'charge.refunded.unmatched',
      source: 'stripe',
      external_id: `${event.id}.unmatched`,
      payload: {
        charge_id: charge.id,
        payment_intent: charge.payment_intent,
        amount_refunded_total: charge.amount_refunded,
      },
    });
    return new Response('OK', { status: 200 });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Disputes (chargebacks). Currently only workshop payments track a
  // chargeback status; for anything else we just log via the top-level
  // logEvent above and move on.
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as { payment_intent: string | null };
    if (await handleWorkshopDispute(env, dispute)) {
      return new Response('OK (workshop chargeback)', { status: 200 });
    }
    return new Response('OK', { status: 200 });
  }

  return new Response('OK', { status: 200 });
};
