// The "you've chosen to pay by bank transfer" panel, shared by the retreat
// registration forms (DSRegister / RBRegister).
//
// Bank transfer is the one way to pay that doesn't leave the site: there is no
// gateway to redirect to, so the form replaces itself with this panel the
// moment the booking is written. The same details are emailed (that's the
// copy they keep — this one dies on refresh), but showing them here means
// someone can open their banking app and pay in the next thirty seconds,
// which is the whole point of offering it.
//
// Self-styled with inline styles so it drops into either form without either
// page's stylesheet knowing about it.

export type BankTransferDetails = {
  beneficiary: string;
  iban: string;
  reference: string;
  amount_label: string;
  email: string;
  hold_days?: number;
};

const INK = '#2A1B2A';
const MUTED = '#7A6A78';
const RULE = '#DCCFC1';
const PANEL = '#FBF6EE';

// Swap the form for the payment details. `host` is the element that gets the
// panel (the form itself is hidden); scrolls it into view, since on a long
// multi-step form the panel can otherwise land off-screen.
export function showBankTransferPanel(
  form: HTMLFormElement,
  details: BankTransferDetails,
): void {
  const panel = document.createElement('section');
  panel.className = 'sd-bt-panel';
  panel.setAttribute('role', 'status');
  panel.setAttribute('tabindex', '-1');
  panel.style.cssText = [
    'margin:8px 0 0',
    'padding:28px 26px',
    `border:1px solid ${RULE}`,
    'border-radius:16px',
    `background:${PANEL}`,
    `color:${INK}`,
    'font-family:Georgia,serif',
    'line-height:1.65',
    'text-align:left',
  ].join(';');

  const days = details.hold_days ?? 7;
  panel.innerHTML = `
    <h3 style="margin:0;font-family:Georgia,serif;font-size:1.4rem;line-height:1.3;color:${INK};">
      Your place is written down.
    </h3>
    <p style="margin:14px 0 0;font-size:1rem;color:${INK};">
      Transfer <strong>${esc(details.amount_label)}</strong> to the account below and
      you're booked. We hold the place for you for ${days} days while the money is
      on its way.
    </p>
    ${rows([
      ['Amount', details.amount_label],
      ['Beneficiary', details.beneficiary],
      ['IBAN', details.iban],
      ['Reference', details.reference],
    ])}
    <p style="margin:18px 0 0;font-size:1rem;color:${INK};">
      Please put <strong>${esc(details.reference)}</strong> in the communication
      field — that's how we recognise your transfer when it arrives.
    </p>
    <p style="margin:14px 0 0;font-size:1rem;color:${INK};">
      A bank transfer doesn't tell us it's coming, so when you've sent it,
      <strong>reply to the email we've just sent you</strong> and say so. We'll
      confirm your place as soon as the money lands.
    </p>
    <p style="margin:18px 0 0;font-size:0.92rem;color:${MUTED};">
      These details are on their way to ${esc(details.email)}. Nothing arrived?
      Check your spam folder, or email
      <a href="mailto:info@songdance.co" style="color:${MUTED};">info@songdance.co</a>
      and we'll send them again.
    </p>
  `;

  form.hidden = true;
  form.insertAdjacentElement('afterend', panel);
  try {
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    panel.focus({ preventScroll: true });
  } catch {
    /* older browsers: the panel is in the page either way */
  }
}

function rows(pairs: [string, string][]): string {
  const cells = pairs
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px 14px 8px 0;font-family:Helvetica,Arial,sans-serif;font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};white-space:nowrap;vertical-align:middle;">${esc(label)}</td>
        <td style="padding:8px 0;font-family:Helvetica,Arial,sans-serif;font-size:1.05rem;color:${INK};text-align:right;word-break:break-word;">${esc(value)}</td>
      </tr>`,
    )
    .join('');
  return `<table style="width:100%;margin:20px 0 0;border-top:1px solid ${RULE};border-collapse:collapse;">${cells}</table>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
