import type { APIRoute } from 'astro';
import { readCookie, verifySession } from '../../../../lib/registrations/auth';
import {
  backToRetreat,
  eligibleFor,
  ensureInvitation,
  isSubmitted,
  intakeForProduct,
  intakeRoster,
  retreatProductBySlug,
} from '../../../../lib/intake/retreat-intake';
import {
  isIntakeEmailKind,
  sendIntakeEmail,
  sendIntakeEmails,
  transportSectionForIntake,
} from '../../../../lib/intake/send';
import type { InvitationRow } from '../../../../lib/intake/invitations';

export const prerender = false;

// /admin/retreats/<slug> → Intake: email the intake (or a reminder, the final
// note, or the travel questions) to one guest — `email` — or to everyone it
// applies to — `scope=all`. Recipients are re-derived here from the retreat's
// paid bookings and the intake's own state (eligibleFor), never taken from the
// form, so a stale page can't mail someone twice or mail someone who's done.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  if (!(await verifySession(env.ADMIN_SESSION_SECRET, readCookie(request)))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const productSlug = String(form.get('product_slug') ?? '').trim();
  const kind = String(form.get('kind') ?? '').trim();
  const scope = String(form.get('scope') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!isIntakeEmailKind(kind)) return new Response('Bad kind', { status: 400 });

  const product = await retreatProductBySlug(env.DB, productSlug);
  if (!product) return new Response('Unknown retreat', { status: 404 });
  const intake = await intakeForProduct(env.DB, product.id);
  if (!intake) return backToRetreat(product.slug, { intake_failed: 'no-intake' });
  if (!env.RESEND_API_KEY) return backToRetreat(product.slug, { intake_failed: 'resend-key-missing' });

  const transport = await transportSectionForIntake(env.DB, intake.slug);
  if (kind === 'transport' && !transport) {
    return backToRetreat(product.slug, { intake_failed: 'no-transport-section' });
  }

  const roster = await intakeRoster(env.DB, product.id, intake.slug);
  const targets =
    scope === 'all'
      ? roster.filter((r) => eligibleFor(kind, r, !!transport))
      : roster.filter((r) => r.email === email);
  if (targets.length === 0) {
    return backToRetreat(product.slug, {
      intake_failed: scope === 'all' ? 'nobody-to-send' : 'not-on-list',
    });
  }
  if (scope !== 'all' && !targets[0]!.emailable) {
    return backToRetreat(product.slug, { intake_failed: 'no-real-address' });
  }
  // Their intake may have come in without the tokened link (matched on email),
  // which the invitation row alone wouldn't know.
  if (scope !== 'all' && kind !== 'transport' && isSubmitted(targets[0]!)) {
    return backToRetreat(product.slug, { intake_failed: 'already-submitted' });
  }

  const invitations: InvitationRow[] = [];
  for (const t of targets) {
    invitations.push(
      await ensureInvitation(env.DB, intake.slug, {
        email: t.email,
        firstName: t.firstName,
        fullName: t.name || null,
      }),
    );
  }

  const baseUrl = env.PUBLIC_BASE_URL || new URL(request.url).origin;
  if (scope !== 'all') {
    const r = await sendIntakeEmail(env, {
      invitation: invitations[0]!,
      retreat: intake,
      kind,
      baseUrl,
      transport,
    });
    return backToRetreat(
      product.slug,
      r.ok
        ? { intake_kind: kind, intake_sent: '1', intake_failed_n: '0' }
        : { intake_failed: r.error },
    );
  }

  const result = await sendIntakeEmails(env, {
    invitations,
    kind,
    baseUrl,
    retreatFor: async () => intake,
  });
  return backToRetreat(product.slug, {
    intake_kind: kind,
    intake_sent: String(result.sent),
    intake_failed_n: String(result.failed),
    ...(result.errors[0] ? { intake_error: result.errors[0] } : {}),
  });
};
