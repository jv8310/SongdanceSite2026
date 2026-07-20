// Client helper for the post-workshop Song Deck gift shipping address, shared by
// the two course checkouts (CCRegister / TWRegister). While the gift window is
// live the checkout shows a shipping-address field group; this reads those
// `shipping_*` inputs under a root element, verifies the address through
// /api/courses/verify-address (Google Address Validation), shows a "did you mean
// …" suggestion when Google tidied it, and returns the payload to merge into the
// checkout body.
//
// The address is OPTIONAL — a free gift never blocks a paid course sale. Blank →
// { status: 'skip' } and the buyer gets the emailed SVH-BONUS claim link instead.
//
// State lives on the root as data-attributes so it survives across the re-entrant
// submit the suggestion buttons trigger:
//   data-ship-confirmed = "1"   the address has been checked / the buyer chose
//   data-ship-verified  = "1|0" whether Google confirmed it (recorded, not gating)

type Suggestion = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  formatted?: string | null;
};

export type ShippingResult =
  | { status: 'skip' }
  | { status: 'error'; message: string }
  | { status: 'pending' }
  | { status: 'ok'; payload: Record<string, string | boolean> };

function q(root: HTMLElement, name: string): HTMLInputElement | HTMLSelectElement | null {
  return root.querySelector(`[name="${name}"]`);
}

function val(root: HTMLElement, name: string): string {
  return (q(root, name)?.value ?? '').trim();
}

function setVal(root: HTMLElement, name: string, value: string): void {
  const el = q(root, name);
  if (el) el.value = value;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type ShippingFields = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
};

function read(root: HTMLElement, billingCountry: string): ShippingFields {
  return {
    name: val(root, 'shipping_name'),
    line1: val(root, 'shipping_line1'),
    line2: val(root, 'shipping_line2'),
    city: val(root, 'shipping_city'),
    region: val(root, 'shipping_region'),
    postal_code: val(root, 'shipping_postal_code'),
    country: (val(root, 'shipping_country') || billingCountry).toUpperCase(),
  };
}

// Prefill the recipient name (from the billing name) and country (from the
// billing country) so the buyer usually only touches the street/city fields.
export function prefillShipping(
  root: HTMLElement,
  opts: { first: string; last: string; billingCountry: string },
): void {
  const nameEl = q(root, 'shipping_name');
  if (nameEl && !nameEl.value.trim()) {
    const full = `${opts.first} ${opts.last}`.trim();
    if (full) nameEl.value = full;
  }
  const countryEl = q(root, 'shipping_country');
  if (countryEl && !countryEl.value && opts.billingCountry) {
    countryEl.value = opts.billingCountry.toUpperCase();
  }
}

// Clear the "confirmed" state (and any open suggestion) whenever the buyer edits
// a shipping field, so an edited address is re-verified before it's used.
export function wireShippingReset(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[name^="shipping_"]').forEach((el) => {
    const reset = () => {
      root.removeAttribute('data-ship-confirmed');
      const slot = root.querySelector('[data-slot="gift-verify"]');
      if (slot) slot.innerHTML = '';
    };
    el.addEventListener('input', reset);
    el.addEventListener('change', reset);
  });
}

function renderSuggestion(root: HTMLElement, suggestion: Suggestion, resubmit: () => void): void {
  const slot = root.querySelector('[data-slot="gift-verify"]');
  const oneLine =
    (suggestion.formatted && suggestion.formatted.trim()) ||
    [
      suggestion.line1,
      suggestion.line2,
      [suggestion.postal_code, suggestion.city].filter(Boolean).join(' '),
      suggestion.region,
      suggestion.country,
    ]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(', ');
  if (!slot) {
    // No place to show the suggestion — don't trap the buyer; just proceed.
    root.setAttribute('data-ship-confirmed', '1');
    root.setAttribute('data-ship-verified', '0');
    resubmit();
    return;
  }
  slot.innerHTML = `
    <div style="margin-top:10px;padding:12px 14px;border:1px solid rgba(0,0,0,0.18);border-radius:10px;background:rgba(255,255,255,0.55);">
      <p style="margin:0 0 6px;font-size:13px;opacity:0.75;">We tidied up your address — use this?</p>
      <p style="margin:0 0 10px;font-size:15px;">${escapeHtml(oneLine)}</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        <button type="button" data-dg="use" style="cursor:pointer;border:none;border-radius:999px;padding:8px 16px;font-size:14px;background:#1a1a1a;color:#fff;">Use this address</button>
        <button type="button" data-dg="keep" style="cursor:pointer;border:1px solid rgba(0,0,0,0.25);border-radius:999px;padding:8px 16px;font-size:14px;background:transparent;color:inherit;">Keep what I entered</button>
      </div>
    </div>`;

  slot.querySelector('[data-dg="use"]')?.addEventListener('click', () => {
    if (suggestion.line1 != null) setVal(root, 'shipping_line1', suggestion.line1);
    setVal(root, 'shipping_line2', suggestion.line2 ?? '');
    if (suggestion.city != null) setVal(root, 'shipping_city', suggestion.city);
    setVal(root, 'shipping_region', suggestion.region ?? '');
    setVal(root, 'shipping_postal_code', suggestion.postal_code ?? '');
    if (suggestion.country) setVal(root, 'shipping_country', suggestion.country.toUpperCase());
    root.setAttribute('data-ship-confirmed', '1');
    root.setAttribute('data-ship-verified', '1');
    slot.innerHTML = '';
    resubmit();
  });
  slot.querySelector('[data-dg="keep"]')?.addEventListener('click', () => {
    root.setAttribute('data-ship-confirmed', '1');
    root.setAttribute('data-ship-verified', '0');
    slot.innerHTML = '';
    resubmit();
  });
}

// The gate the checkout runs before submitting while the gift panel is live.
// Returns 'skip' (no address), 'error' (incomplete — show the message), 'pending'
// (a suggestion was shown; its buttons call `resubmit`), or 'ok' with the payload.
export async function resolveShipping(
  root: HTMLElement,
  opts: { billingCountry: string; first: string; last: string; resubmit: () => void },
): Promise<ShippingResult> {
  const s = read(root, opts.billingCountry);

  // Nothing entered → opt out of the shipped gift (claim email fallback).
  if (!s.line1) return { status: 'skip' };
  // Started an address but it's not shippable yet.
  if (!s.city || !s.country) {
    return {
      status: 'error',
      message:
        'Add your city and country so we can ship your free Songdeck — or clear the address to skip it.',
    };
  }

  if (root.getAttribute('data-ship-confirmed') !== '1') {
    let data: {
      needsConfirmation?: boolean;
      suggestion?: Suggestion | null;
      configured?: boolean;
      ok?: boolean;
    } | null = null;
    try {
      const res = await fetch('/api/courses/verify-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      data = await res.json();
    } catch {
      // Fail open — if the check can't run, ship what the buyer typed.
      data = null;
    }
    if (data && data.needsConfirmation && data.suggestion) {
      renderSuggestion(root, data.suggestion, opts.resubmit);
      return { status: 'pending' };
    }
    root.setAttribute('data-ship-confirmed', '1');
    root.setAttribute('data-ship-verified', data && data.configured ? (data.ok ? '1' : '0') : '0');
  }

  return {
    status: 'ok',
    payload: {
      shipping_name: s.name || `${opts.first} ${opts.last}`.trim(),
      shipping_line1: s.line1,
      shipping_line2: s.line2,
      shipping_city: s.city,
      shipping_region: s.region,
      shipping_postal_code: s.postal_code,
      shipping_country: s.country,
      shipping_verified: root.getAttribute('data-ship-verified') === '1',
    },
  };
}
