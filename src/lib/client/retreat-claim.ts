// Client helper for a waiting-list claim link, shared by the retreat
// registration forms (DSRegister / RBRegister).
//
// The link in the offer email is `<retreat page>?claim=<token>#register`. This
// reads that token, asks the server what it's offering, and — when it's still
// live — announces the held place above the form and fills in what we already
// know about the person. The caller does the retreat-specific part (select the
// room, unlock a card that reads "fully booked") and sends `claim_token` with
// the checkout so the server lets them book the place kept for them.
//
// An offer that has lapsed says so plainly instead of failing silently: the
// form still works, it's just an ordinary booking again.

export type RetreatClaim = {
  token: string;
  product_slug: string;
  product_name: string;
  tier_slug: string;
  tier_name: string;
  price_cents: number;
  expires_at: string | null;
  expires_label: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  phone_country: string | null;
  country: string | null;
};

export function claimTokenFromUrl(): string {
  try {
    return new URL(window.location.href).searchParams.get('claim')?.trim() ?? '';
  } catch {
    return '';
  }
}

// Fetch what the token is offering. null = no token, unknown token, or the
// window has closed (the banner says so in the second case).
export async function loadRetreatClaim(
  token: string,
): Promise<RetreatClaim | null> {
  if (!token) return null;
  try {
    const res = await fetch(
      `/api/registrations/waitlist?claim=${encodeURIComponent(token)}`,
      { headers: { Accept: 'application/json' } },
    );
    const data: any = await res.json().catch(() => null);
    if (!data || !data.ok) return null;
    return { ...(data as RetreatClaim), token };
  } catch {
    return null;
  }
}

// Fill in the fields we already hold, without overwriting anything the visitor
// has already typed.
export function prefillFromClaim(form: HTMLFormElement, claim: RetreatClaim) {
  const set = (name: string, value: string | null) => {
    if (!value) return;
    const el = form.querySelector(`[name="${name}"]`) as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (!el || el.value.trim()) return;
    // A select only takes a value it actually offers.
    if (el instanceof HTMLSelectElement && !el.querySelector(`option[value="${CSS.escape(value)}"]`)) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('first_name', claim.first_name);
  set('last_name', claim.last_name);
  set('email', claim.email);
  set('country', claim.country);
  set('phone_country', claim.phone_country);
  // The stored phone is E.164 (+32470…); the form asks for the local part, so
  // strip the dial code of the chosen country if we can.
  if (claim.phone) {
    const local = claim.phone.replace(/^\+\d{1,3}/, '');
    set('phone', local || claim.phone);
  }
}

// The line above the form. `banner` is an element the retreat page provides;
// it's revealed and filled here so both retreats say the same thing.
export function renderClaimBanner(
  banner: HTMLElement,
  claim: RetreatClaim | null,
  opts: { hadToken: boolean } = { hadToken: true },
) {
  if (!opts.hadToken) return;
  banner.hidden = false;
  if (!claim) {
    banner.classList.add('is-lapsed');
    banner.innerHTML =
      '<strong>This offer has ended.</strong> The place has gone back on the list. ' +
      'If you still want to come, put your name down again below and we\'ll come back to you.';
    return;
  }
  const until = claim.expires_label
    ? ` It’s held for you until <strong>${escapeHtml(claim.expires_label)}</strong>.`
    : '';
  banner.innerHTML =
    `<strong>A place has opened for you: ${escapeHtml(claim.tier_name)}.</strong>${until} ` +
    'Your details are filled in below — book it whenever you’re ready.';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
