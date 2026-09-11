// Paying a retreat place by manual SEPA transfer to our IBAN.
//
// The third button on both retreat forms, next to "Pay online" (Stripe) and
// "Pay with PayPal". It is NOT a gateway: no session, no order, no webhook.
// The checkout writes the ordinary pending registration, emails the guest the
// account details and a reference, and there it rests until the money lands in
// the bank and an admin presses "Mark paid" on /admin/retreats/<slug> — which
// runs exactly the same paid side-effects a webhook would (room assignment,
// waiting-list settlement, Drip, SD-ORDER).
//
// Two things follow from money that arrives days later rather than seconds:
//
//   • The place must be held for days, not the ordinary 30 minutes, or it
//     gets sold from under someone who has already sent the money. Hence
//     BANK_TRANSFER_HOLD_DAYS below, passed as the row's hold_minutes.
//   • Nothing tells us the transfer happened — a SEPA credit carries no
//     callback. So the email asks for a reply, which is what puts the
//     booking in front of Jacob at the moment it becomes payable.
//
// Voice per docs/svh-copy-book.md: plain, warm, a little dry, short
// sentences. The look is the shared retreat shell (waitlist-emails.ts), so
// this sits in the same family as the offer and balance mail.

import { logEventSafe, type Registration } from './db';
import { retreatEmail, type RetreatEmailContent } from './waitlist-emails';
import { sendViaResend } from './balance';
import { tidyFirstName } from '../email/names';

const DEFAULT_FROM = 'Songdance <intakes@mail.songdance.co>';
const REPLY_TO = 'jacob@songdance.co';

// How long a place is held while the transfer is in flight. A SEPA credit
// inside the euro area clears in one or two business days; a week leaves room
// for a weekend and a slow bank without parking a room indefinitely for
// someone who never sends the money. When it lapses the row simply stops
// counting towards availability (hold_expires_at) — it is never deleted, so
// a late transfer can still be marked paid by hand.
export const BANK_TRANSFER_HOLD_DAYS = 7;
export const BANK_TRANSFER_HOLD_MINUTES = BANK_TRANSFER_HOLD_DAYS * 24 * 60;

// The account. Shown on the page, in the email, and on the admin row, so it
// lives here once.
export const BANK_ACCOUNT = {
  beneficiary: 'Songdance BV',
  iban: 'BE43 0689 3690 1001',
} as const;

// What the guest puts in the transfer's communication field, and what Jacob
// matches the bank line against. Deterministic from the registration id, so
// it can be rebuilt on any screen without storing a column.
export function bankTransferReference(registrationId: number): string {
  return `SD-${registrationId}`;
}

export type BankTransferDetails = {
  beneficiary: string;
  iban: string;
  reference: string;
  amount_label: string;
  email: string;
};

export function bankTransferDetails(args: {
  registrationId: number;
  amountCents: number;
  currency: string;
  email: string;
}): BankTransferDetails {
  return {
    beneficiary: BANK_ACCOUNT.beneficiary,
    iban: BANK_ACCOUNT.iban,
    reference: bankTransferReference(args.registrationId),
    amount_label: money(args.amountCents, args.currency),
    email: args.email,
  };
}

export function money(cents: number, currency: string): string {
  try {
    return (cents / 100).toLocaleString('en-GB', {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    });
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

// ── The email ──────────────────────────────────────────────────────────
//
// Transactional: they asked for it by choosing this way to pay. It carries
// everything needed to make the transfer from a banking app, and asks for the
// one thing no bank will tell us — a reply saying it's sent.
export function buildBankTransferEmail(args: {
  first_name: string | null;
  retreat_name: string;
  when_label: string | null;
  tier_name: string;
  amount_label: string;
  iban: string;
  beneficiary: string;
  reference: string;
  hold_days: number;
  deposit_note?: string | null;
}): RetreatEmailContent {
  const {
    first_name,
    retreat_name,
    when_label,
    tier_name,
    amount_label,
    iban,
    beneficiary,
    reference,
    hold_days,
    deposit_note,
  } = args;
  const greetName = tidyFirstName(first_name);
  const greet = greetName ? `Hi ${greetName},` : 'Hi,';
  const when = when_label ? ` (${when_label})` : '';

  return retreatEmail({
    subject: `Your bank transfer details — ${retreat_name}`,
    greet,
    paragraphs: [
      `Thank you — your place on ${retreat_name}${when} is written down: ${tier_name}, ${amount_label}. You've chosen to pay by bank transfer, so here is where to send it.`,
      ...(deposit_note ? [deposit_note] : []),
    ],
    details: [
      { label: 'Amount', value: amount_label },
      { label: 'Beneficiary', value: beneficiary },
      { label: 'IBAN', value: iban },
      { label: 'Reference', value: reference },
    ],
    paragraphsAfter: [
      `Please put ${reference} in the communication field. That's how we recognise your transfer when it arrives.`,
      `We hold the place for you for ${hold_days} days while the money is on its way. If you need longer, or anything about this doesn't fit, just say so — we'd rather know than guess.`,
      `One thing we can't see from our side: a bank transfer arrives without telling us whose it is until we go looking. So when you've sent it, reply to this email and say so. We'll confirm your place as soon as the money lands, and you'll get the ordinary confirmation then.`,
    ],
    footnote:
      'Questions about any of this? Reply to this email and it comes straight to us.',
  });
}

// ── The send ───────────────────────────────────────────────────────────

export type BankTransferEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_INTAKES_FROM?: string;
};

// Email the account details for a pending bank-transfer registration.
//
// Deliberately non-fatal: the booking is already written, and the same
// details are shown on screen the moment the form is submitted, so a Resend
// blip must not fail the checkout. It logs either way, so a booking that
// never got its email is visible in the events log on the admin page.
export async function sendBankTransferInstructions(
  env: BankTransferEnv,
  args: {
    registration: Pick<
      Registration,
      'id' | 'email' | 'first_name' | 'name' | 'amount_cents' | 'currency'
    >;
    retreat_name: string;
    when_label: string | null;
    tier_name: string;
    deposit_note?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const reg = args.registration;
  const details = bankTransferDetails({
    registrationId: reg.id,
    amountCents: reg.amount_cents,
    currency: reg.currency,
    email: reg.email,
  });

  const fail = async (error: string) => {
    await logEventSafe(env.DB, {
      registration_id: reg.id,
      kind: 'registration.bank_transfer.email_error',
      payload: { error, to: reg.email },
    });
    return { ok: false as const, error };
  };

  if (!env.RESEND_API_KEY) return fail('resend-key-missing');

  const mail = buildBankTransferEmail({
    first_name: reg.first_name ?? (reg.name ? reg.name.split(' ')[0] : null),
    retreat_name: args.retreat_name,
    when_label: args.when_label,
    tier_name: args.tier_name,
    amount_label: details.amount_label,
    iban: details.iban,
    beneficiary: details.beneficiary,
    reference: details.reference,
    hold_days: BANK_TRANSFER_HOLD_DAYS,
    deposit_note: args.deposit_note ?? null,
  });

  const sent = await sendViaResend({
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_INTAKES_FROM ?? DEFAULT_FROM,
    to: reg.email,
    replyTo: REPLY_TO,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  if (!sent.ok) return fail(sent.error);

  await logEventSafe(env.DB, {
    registration_id: reg.id,
    kind: 'registration.bank_transfer.emailed',
    payload: {
      to: reg.email,
      reference: details.reference,
      amount_cents: reg.amount_cents,
      currency: reg.currency,
    },
  });
  return { ok: true };
}
