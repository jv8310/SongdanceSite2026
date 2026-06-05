// Country list used by both the "Country" picker and the phone-country
// selector on the registration form. ISO-3166-1 alpha-2 codes; `dial` is the
// E.164 country calling code (no leading "+").
// Order: Belgium and the Netherlands first (the retreat audience leans local),
// then the rest of Europe alphabetical, then the wider world alphabetical.

export type Country = {
  code: string;   // ISO-2
  name: string;
  dial: string;   // calling code, no "+"
  flag: string;   // regional indicator emoji
};

const eu: Country[] = [
  { code: 'BE', name: 'Belgium',        dial: '32',  flag: '🇧🇪' },
  { code: 'NL', name: 'Netherlands',    dial: '31',  flag: '🇳🇱' },
  { code: 'DE', name: 'Germany',        dial: '49',  flag: '🇩🇪' },
  { code: 'FR', name: 'France',         dial: '33',  flag: '🇫🇷' },
  { code: 'LU', name: 'Luxembourg',     dial: '352', flag: '🇱🇺' },
  { code: 'AT', name: 'Austria',        dial: '43',  flag: '🇦🇹' },
  { code: 'CH', name: 'Switzerland',    dial: '41',  flag: '🇨🇭' },
  { code: 'IT', name: 'Italy',          dial: '39',  flag: '🇮🇹' },
  { code: 'ES', name: 'Spain',          dial: '34',  flag: '🇪🇸' },
  { code: 'PT', name: 'Portugal',       dial: '351', flag: '🇵🇹' },
  { code: 'IE', name: 'Ireland',        dial: '353', flag: '🇮🇪' },
  { code: 'GB', name: 'United Kingdom', dial: '44',  flag: '🇬🇧' },
  { code: 'DK', name: 'Denmark',        dial: '45',  flag: '🇩🇰' },
  { code: 'SE', name: 'Sweden',         dial: '46',  flag: '🇸🇪' },
  { code: 'NO', name: 'Norway',         dial: '47',  flag: '🇳🇴' },
  { code: 'FI', name: 'Finland',        dial: '358', flag: '🇫🇮' },
  { code: 'IS', name: 'Iceland',        dial: '354', flag: '🇮🇸' },
  { code: 'PL', name: 'Poland',         dial: '48',  flag: '🇵🇱' },
  { code: 'CZ', name: 'Czechia',        dial: '420', flag: '🇨🇿' },
  { code: 'SK', name: 'Slovakia',       dial: '421', flag: '🇸🇰' },
  { code: 'HU', name: 'Hungary',        dial: '36',  flag: '🇭🇺' },
  { code: 'SI', name: 'Slovenia',       dial: '386', flag: '🇸🇮' },
  { code: 'HR', name: 'Croatia',        dial: '385', flag: '🇭🇷' },
  { code: 'GR', name: 'Greece',         dial: '30',  flag: '🇬🇷' },
  { code: 'RO', name: 'Romania',        dial: '40',  flag: '🇷🇴' },
  { code: 'BG', name: 'Bulgaria',       dial: '359', flag: '🇧🇬' },
  { code: 'EE', name: 'Estonia',        dial: '372', flag: '🇪🇪' },
  { code: 'LV', name: 'Latvia',         dial: '371', flag: '🇱🇻' },
  { code: 'LT', name: 'Lithuania',      dial: '370', flag: '🇱🇹' },
  { code: 'CY', name: 'Cyprus',         dial: '357', flag: '🇨🇾' },
  { code: 'MT', name: 'Malta',          dial: '356', flag: '🇲🇹' },
];

const world: Country[] = [
  { code: 'US', name: 'United States',  dial: '1',   flag: '🇺🇸' },
  { code: 'CA', name: 'Canada',         dial: '1',   flag: '🇨🇦' },
  { code: 'AU', name: 'Australia',      dial: '61',  flag: '🇦🇺' },
  { code: 'NZ', name: 'New Zealand',    dial: '64',  flag: '🇳🇿' },
  { code: 'IL', name: 'Israel',         dial: '972', flag: '🇮🇱' },
  { code: 'TR', name: 'Türkiye',        dial: '90',  flag: '🇹🇷' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971', flag: '🇦🇪' },
  { code: 'ZA', name: 'South Africa',   dial: '27',  flag: '🇿🇦' },
  { code: 'MX', name: 'Mexico',         dial: '52',  flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil',         dial: '55',  flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina',      dial: '54',  flag: '🇦🇷' },
  { code: 'JP', name: 'Japan',          dial: '81',  flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea',    dial: '82',  flag: '🇰🇷' },
  { code: 'SG', name: 'Singapore',      dial: '65',  flag: '🇸🇬' },
  { code: 'HK', name: 'Hong Kong',      dial: '852', flag: '🇭🇰' },
];

export const COUNTRIES: Country[] = [...eu, ...world];

export function findCountry(code: string | null | undefined): Country | undefined {
  if (!code) return undefined;
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}

// The 27 EU member states (ISO-3166-1 alpha-2). NOTE: the `eu` array above is a
// loosely-named "European" picker that also holds non-EU markets (CH, GB, NO,
// IS), so it can't be used to decide EU membership — this set is the real list.
// Used to gate the VAT-number field, which only makes sense for EU businesses
// (intra-EU reverse-charge).
export const EU_COUNTRY_CODES = new Set<string>([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
]);

export function isEuCountry(code: string | null | undefined): boolean {
  if (!code) return false;
  return EU_COUNTRY_CODES.has(code.toUpperCase());
}
