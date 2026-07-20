// Google Address Validation — used by the Song Deck gift checkout to catch
// spelling mistakes / missing components in the shipping address before we place
// the free Shopify order, so the deck actually reaches the buyer.
//
// One call to the Address Validation API standardises the address and reports a
// verdict (is it complete? did Google have to infer / replace / leave anything
// unconfirmed?). The checkout uses that to show the buyer a "did you mean …"
// suggestion when Google corrected something, then ships the confirmed address.
//
// Fail-open by contract: the gift is a courtesy, never a gate. No key set, an
// API error, or a timeout all resolve to "not configured / couldn't check" — the
// address the buyer typed is used as-is and the sale is never blocked.
//
// Setup: enable the Address Validation API in Google Cloud and set
// GOOGLE_ADDRESS_VALIDATION_KEY to an API key restricted to it. No key → this
// no-ops and the checkout skips verification entirely.

const ENDPOINT = 'https://addressvalidation.googleapis.com/v1:validateAddress';

export type GoogleAddressEnv = {
  GOOGLE_ADDRESS_VALIDATION_KEY?: string;
};

export function googleAddressValidationConfigured(env: GoogleAddressEnv): boolean {
  return !!(env.GOOGLE_ADDRESS_VALIDATION_KEY ?? '').trim();
}

// The loose address fields the checkout collects (ISO-2 country).
export type AddressInput = {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postal_code?: string;
  country: string; // ISO-2
};

// The standardised address Google returns, mapped back onto our field names.
export type StandardizedAddress = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string; // ISO-2
};

export type AddressCheck = {
  // Was the API consulted at all? false → no key, so the caller ships as typed.
  configured: boolean;
  // Did we get a usable answer back? (Fail-open: on any error this stays false
  // and the caller proceeds with the typed address.)
  ok: boolean;
  // Google corrected / inferred / could not confirm part of the address, or the
  // address was incomplete — worth showing the buyer the standardised version.
  needsConfirmation: boolean;
  // The standardised address (present whenever the API returned one).
  standardized: StandardizedAddress | null;
  // Google's single-line formatting, for the "did you mean" display.
  formatted: string | null;
  // Short machine reason when something is off ('incomplete' | 'undeliverable' |
  // 'error'); omitted on a clean pass.
  issue?: string;
};

type PostalAddress = {
  regionCode?: string;
  postalCode?: string;
  administrativeArea?: string;
  locality?: string;
  addressLines?: string[];
};

type ValidateResponse = {
  result?: {
    verdict?: {
      inputGranularity?: string;
      validationGranularity?: string;
      geocodeGranularity?: string;
      addressComplete?: boolean;
      hasUnconfirmedComponents?: boolean;
      hasInferredComponents?: boolean;
      hasReplacedComponents?: boolean;
    };
    address?: {
      formattedAddress?: string;
      postalAddress?: PostalAddress;
    };
  };
};

function standardizedFrom(postal: PostalAddress | undefined, fallback: AddressInput): StandardizedAddress {
  const lines = postal?.addressLines ?? [];
  return {
    line1: (lines[0] ?? fallback.line1).trim(),
    line2: (lines[1] ?? fallback.line2 ?? '').trim(),
    city: (postal?.locality ?? fallback.city).trim(),
    region: (postal?.administrativeArea ?? fallback.region ?? '').trim(),
    postal_code: (postal?.postalCode ?? fallback.postal_code ?? '').trim(),
    country: (postal?.regionCode ?? fallback.country).trim().toUpperCase(),
  };
}

// Validate + standardise an address. Never throws — the worst case is
// { configured, ok:false } and the caller ships the address as typed.
export async function validateAddress(
  env: GoogleAddressEnv,
  input: AddressInput,
): Promise<AddressCheck> {
  const key = (env.GOOGLE_ADDRESS_VALIDATION_KEY ?? '').trim();
  if (!key) {
    return { configured: false, ok: false, needsConfirmation: false, standardized: null, formatted: null };
  }

  const addressLines = [input.line1, input.line2].map((s) => (s ?? '').trim()).filter(Boolean);
  const body = {
    address: {
      regionCode: (input.country ?? '').trim().toUpperCase() || undefined,
      addressLines,
      locality: (input.city ?? '').trim() || undefined,
      administrativeArea: (input.region ?? '').trim() || undefined,
      postalCode: (input.postal_code ?? '').trim() || undefined,
    },
  };

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        needsConfirmation: false,
        standardized: null,
        formatted: null,
        issue: 'error',
      };
    }
    const data = (await res.json()) as ValidateResponse;
    const verdict = data.result?.verdict ?? {};
    const addr = data.result?.address;
    const standardized = standardizedFrom(addr?.postalAddress, input);
    const formatted = addr?.formattedAddress ?? null;

    const complete = verdict.addressComplete === true;
    const touched =
      verdict.hasUnconfirmedComponents === true ||
      verdict.hasInferredComponents === true ||
      verdict.hasReplacedComponents === true;
    // A too-coarse validation (only a route or region resolved, no premise) is
    // effectively undeliverable — surface the suggestion so the buyer can fix it.
    const coarse =
      verdict.validationGranularity === 'OTHER' ||
      verdict.validationGranularity === 'ROUTE';

    return {
      configured: true,
      ok: true,
      needsConfirmation: !complete || touched || coarse,
      standardized,
      formatted,
      issue: !complete ? 'incomplete' : coarse ? 'undeliverable' : undefined,
    };
  } catch {
    return {
      configured: true,
      ok: false,
      needsConfirmation: false,
      standardized: null,
      formatted: null,
      issue: 'error',
    };
  }
}
