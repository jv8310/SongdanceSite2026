// Country list used by the "Country" picker, the shipping-address picker and
// the phone-country selector on every form on the site. ISO-3166-1 alpha-2
// codes; `dial` is the E.164 country calling code (no leading "+").
//
// The list is COMPLETE — every ISO 3166-1 country plus the commonly addressed
// territories, the same code set `src/lib/workshops/countries.ts` uses. It has
// to be: `findCountry` gates every checkout server-side, so a country missing
// from here cannot register at all. It used to hold 46 entries (Europe + our
// biggest markets), which turned "where do you live?" into "are you one of
// ours?" for everyone else.
//
// `dial` is the *country* calling code, never a NANP area code: Jamaica is
// "1", not "1876". The field beside the picker takes the **national** number,
// which for those countries already begins with its area code, and the server
// composes `+<dial><national>` (see the checkout routes).
//
// Order: a PRIORITY block first — Belgium and the Netherlands, the rest of
// Europe, then our biggest non-European markets, in the order this file has
// always carried them — and every other country alphabetically after it. A
// <select> renders the two as optgroups (COUNTRIES_PRIORITY / COUNTRIES_OTHER)
// so the jump back to "A" reads as deliberate rather than as a broken sort.

export type Country = {
  code: string;   // ISO-2
  name: string;
  dial: string;   // calling code, no "+"
  flag: string;   // regional indicator emoji
};

// The markets the audience actually comes from, in the order they've always
// been shown. Everything else follows alphabetically.
const PRIORITY_CODES = [
  // Belgium and the Netherlands first (the retreat audience leans local),
  // then the rest of Europe.
  'BE', 'NL', 'DE', 'FR', 'LU', 'AT', 'CH', 'IT', 'ES', 'PT', 'IE', 'GB',
  'DK', 'SE', 'NO', 'FI', 'IS', 'PL', 'CZ', 'SK', 'HU', 'SI', 'HR', 'GR',
  'RO', 'BG', 'EE', 'LV', 'LT', 'CY', 'MT',
  // The wider world we sell most to.
  'US', 'CA', 'AU', 'NZ', 'IL', 'TR', 'AE', 'ZA', 'MX', 'BR', 'AR', 'JP',
  'KR', 'SG', 'HK',
];

// [ISO-2, English name, calling code]. Names are the ones a visitor would type
// into the search fields (so "Saint Lucia", not "St. Lucia"), which is why
// they're written out rather than derived from Intl.DisplayNames at runtime:
// the country pickers match on this exact string on both the server and the
// client, and the two must never disagree.
const DATA: Array<[string, string, string]> = [
  ['AD', 'Andorra', '376'],
  ['AE', 'United Arab Emirates', '971'],
  ['AF', 'Afghanistan', '93'],
  ['AG', 'Antigua and Barbuda', '1'],
  ['AI', 'Anguilla', '1'],
  ['AL', 'Albania', '355'],
  ['AM', 'Armenia', '374'],
  ['AO', 'Angola', '244'],
  ['AR', 'Argentina', '54'],
  ['AS', 'American Samoa', '1'],
  ['AT', 'Austria', '43'],
  ['AU', 'Australia', '61'],
  ['AW', 'Aruba', '297'],
  ['AX', 'Åland Islands', '358'],
  ['AZ', 'Azerbaijan', '994'],
  ['BA', 'Bosnia and Herzegovina', '387'],
  ['BB', 'Barbados', '1'],
  ['BD', 'Bangladesh', '880'],
  ['BE', 'Belgium', '32'],
  ['BF', 'Burkina Faso', '226'],
  ['BG', 'Bulgaria', '359'],
  ['BH', 'Bahrain', '973'],
  ['BI', 'Burundi', '257'],
  ['BJ', 'Benin', '229'],
  ['BL', 'Saint Barthélemy', '590'],
  ['BM', 'Bermuda', '1'],
  ['BN', 'Brunei', '673'],
  ['BO', 'Bolivia', '591'],
  ['BQ', 'Caribbean Netherlands', '599'],
  ['BR', 'Brazil', '55'],
  ['BS', 'Bahamas', '1'],
  ['BT', 'Bhutan', '975'],
  ['BW', 'Botswana', '267'],
  ['BY', 'Belarus', '375'],
  ['BZ', 'Belize', '501'],
  ['CA', 'Canada', '1'],
  ['CC', 'Cocos (Keeling) Islands', '61'],
  ['CD', 'Congo (DRC)', '243'],
  ['CF', 'Central African Republic', '236'],
  ['CG', 'Congo (Republic)', '242'],
  ['CH', 'Switzerland', '41'],
  ['CI', 'Côte d’Ivoire', '225'],
  ['CK', 'Cook Islands', '682'],
  ['CL', 'Chile', '56'],
  ['CM', 'Cameroon', '237'],
  ['CN', 'China', '86'],
  ['CO', 'Colombia', '57'],
  ['CR', 'Costa Rica', '506'],
  ['CU', 'Cuba', '53'],
  ['CV', 'Cape Verde', '238'],
  ['CW', 'Curaçao', '599'],
  ['CX', 'Christmas Island', '61'],
  ['CY', 'Cyprus', '357'],
  ['CZ', 'Czechia', '420'],
  ['DE', 'Germany', '49'],
  ['DJ', 'Djibouti', '253'],
  ['DK', 'Denmark', '45'],
  ['DM', 'Dominica', '1'],
  ['DO', 'Dominican Republic', '1'],
  ['DZ', 'Algeria', '213'],
  ['EC', 'Ecuador', '593'],
  ['EE', 'Estonia', '372'],
  ['EG', 'Egypt', '20'],
  ['EH', 'Western Sahara', '212'],
  ['ER', 'Eritrea', '291'],
  ['ES', 'Spain', '34'],
  ['ET', 'Ethiopia', '251'],
  ['FI', 'Finland', '358'],
  ['FJ', 'Fiji', '679'],
  ['FK', 'Falkland Islands', '500'],
  ['FM', 'Micronesia', '691'],
  ['FO', 'Faroe Islands', '298'],
  ['FR', 'France', '33'],
  ['GA', 'Gabon', '241'],
  ['GB', 'United Kingdom', '44'],
  ['GD', 'Grenada', '1'],
  ['GE', 'Georgia', '995'],
  ['GF', 'French Guiana', '594'],
  ['GG', 'Guernsey', '44'],
  ['GH', 'Ghana', '233'],
  ['GI', 'Gibraltar', '350'],
  ['GL', 'Greenland', '299'],
  ['GM', 'Gambia', '220'],
  ['GN', 'Guinea', '224'],
  ['GP', 'Guadeloupe', '590'],
  ['GQ', 'Equatorial Guinea', '240'],
  ['GR', 'Greece', '30'],
  ['GT', 'Guatemala', '502'],
  ['GU', 'Guam', '1'],
  ['GW', 'Guinea-Bissau', '245'],
  ['GY', 'Guyana', '592'],
  ['HK', 'Hong Kong', '852'],
  ['HN', 'Honduras', '504'],
  ['HR', 'Croatia', '385'],
  ['HT', 'Haiti', '509'],
  ['HU', 'Hungary', '36'],
  ['ID', 'Indonesia', '62'],
  ['IE', 'Ireland', '353'],
  ['IL', 'Israel', '972'],
  ['IM', 'Isle of Man', '44'],
  ['IN', 'India', '91'],
  ['IO', 'British Indian Ocean Territory', '246'],
  ['IQ', 'Iraq', '964'],
  ['IR', 'Iran', '98'],
  ['IS', 'Iceland', '354'],
  ['IT', 'Italy', '39'],
  ['JE', 'Jersey', '44'],
  ['JM', 'Jamaica', '1'],
  ['JO', 'Jordan', '962'],
  ['JP', 'Japan', '81'],
  ['KE', 'Kenya', '254'],
  ['KG', 'Kyrgyzstan', '996'],
  ['KH', 'Cambodia', '855'],
  ['KI', 'Kiribati', '686'],
  ['KM', 'Comoros', '269'],
  ['KN', 'Saint Kitts and Nevis', '1'],
  ['KP', 'North Korea', '850'],
  ['KR', 'South Korea', '82'],
  ['KW', 'Kuwait', '965'],
  ['KY', 'Cayman Islands', '1'],
  ['KZ', 'Kazakhstan', '7'],
  ['LA', 'Laos', '856'],
  ['LB', 'Lebanon', '961'],
  ['LC', 'Saint Lucia', '1'],
  ['LI', 'Liechtenstein', '423'],
  ['LK', 'Sri Lanka', '94'],
  ['LR', 'Liberia', '231'],
  ['LS', 'Lesotho', '266'],
  ['LT', 'Lithuania', '370'],
  ['LU', 'Luxembourg', '352'],
  ['LV', 'Latvia', '371'],
  ['LY', 'Libya', '218'],
  ['MA', 'Morocco', '212'],
  ['MC', 'Monaco', '377'],
  ['MD', 'Moldova', '373'],
  ['ME', 'Montenegro', '382'],
  ['MF', 'Saint Martin', '590'],
  ['MG', 'Madagascar', '261'],
  ['MH', 'Marshall Islands', '692'],
  ['MK', 'North Macedonia', '389'],
  ['ML', 'Mali', '223'],
  ['MM', 'Myanmar', '95'],
  ['MN', 'Mongolia', '976'],
  ['MO', 'Macao', '853'],
  ['MP', 'Northern Mariana Islands', '1'],
  ['MQ', 'Martinique', '596'],
  ['MR', 'Mauritania', '222'],
  ['MS', 'Montserrat', '1'],
  ['MT', 'Malta', '356'],
  ['MU', 'Mauritius', '230'],
  ['MV', 'Maldives', '960'],
  ['MW', 'Malawi', '265'],
  ['MX', 'Mexico', '52'],
  ['MY', 'Malaysia', '60'],
  ['MZ', 'Mozambique', '258'],
  ['NA', 'Namibia', '264'],
  ['NC', 'New Caledonia', '687'],
  ['NE', 'Niger', '227'],
  ['NF', 'Norfolk Island', '672'],
  ['NG', 'Nigeria', '234'],
  ['NI', 'Nicaragua', '505'],
  ['NL', 'Netherlands', '31'],
  ['NO', 'Norway', '47'],
  ['NP', 'Nepal', '977'],
  ['NR', 'Nauru', '674'],
  ['NU', 'Niue', '683'],
  ['NZ', 'New Zealand', '64'],
  ['OM', 'Oman', '968'],
  ['PA', 'Panama', '507'],
  ['PE', 'Peru', '51'],
  ['PF', 'French Polynesia', '689'],
  ['PG', 'Papua New Guinea', '675'],
  ['PH', 'Philippines', '63'],
  ['PK', 'Pakistan', '92'],
  ['PL', 'Poland', '48'],
  ['PM', 'Saint Pierre and Miquelon', '508'],
  ['PN', 'Pitcairn Islands', '64'],
  ['PR', 'Puerto Rico', '1'],
  ['PS', 'Palestine', '970'],
  ['PT', 'Portugal', '351'],
  ['PW', 'Palau', '680'],
  ['PY', 'Paraguay', '595'],
  ['QA', 'Qatar', '974'],
  ['RE', 'Réunion', '262'],
  ['RO', 'Romania', '40'],
  ['RS', 'Serbia', '381'],
  ['RU', 'Russia', '7'],
  ['RW', 'Rwanda', '250'],
  ['SA', 'Saudi Arabia', '966'],
  ['SB', 'Solomon Islands', '677'],
  ['SC', 'Seychelles', '248'],
  ['SD', 'Sudan', '249'],
  ['SE', 'Sweden', '46'],
  ['SG', 'Singapore', '65'],
  ['SH', 'Saint Helena', '290'],
  ['SI', 'Slovenia', '386'],
  ['SJ', 'Svalbard and Jan Mayen', '47'],
  ['SK', 'Slovakia', '421'],
  ['SL', 'Sierra Leone', '232'],
  ['SM', 'San Marino', '378'],
  ['SN', 'Senegal', '221'],
  ['SO', 'Somalia', '252'],
  ['SR', 'Suriname', '597'],
  ['SS', 'South Sudan', '211'],
  ['ST', 'São Tomé and Príncipe', '239'],
  ['SV', 'El Salvador', '503'],
  ['SX', 'Sint Maarten', '1'],
  ['SY', 'Syria', '963'],
  ['SZ', 'Eswatini', '268'],
  ['TC', 'Turks and Caicos Islands', '1'],
  ['TD', 'Chad', '235'],
  ['TG', 'Togo', '228'],
  ['TH', 'Thailand', '66'],
  ['TJ', 'Tajikistan', '992'],
  ['TK', 'Tokelau', '690'],
  ['TL', 'Timor-Leste', '670'],
  ['TM', 'Turkmenistan', '993'],
  ['TN', 'Tunisia', '216'],
  ['TO', 'Tonga', '676'],
  ['TR', 'Türkiye', '90'],
  ['TT', 'Trinidad and Tobago', '1'],
  ['TV', 'Tuvalu', '688'],
  ['TW', 'Taiwan', '886'],
  ['TZ', 'Tanzania', '255'],
  ['UA', 'Ukraine', '380'],
  ['UG', 'Uganda', '256'],
  ['US', 'United States', '1'],
  ['UY', 'Uruguay', '598'],
  ['UZ', 'Uzbekistan', '998'],
  ['VA', 'Vatican City', '39'],
  ['VC', 'Saint Vincent and the Grenadines', '1'],
  ['VE', 'Venezuela', '58'],
  ['VG', 'British Virgin Islands', '1'],
  ['VI', 'U.S. Virgin Islands', '1'],
  ['VN', 'Vietnam', '84'],
  ['VU', 'Vanuatu', '678'],
  ['WF', 'Wallis and Futuna', '681'],
  ['WS', 'Samoa', '685'],
  ['YE', 'Yemen', '967'],
  ['YT', 'Mayotte', '262'],
  ['ZA', 'South Africa', '27'],
  ['ZM', 'Zambia', '260'],
  ['ZW', 'Zimbabwe', '263'],
];

// The regional-indicator flag emoji for an ISO-2 code — derived, not typed, so
// there is no 250-row table of look-alike emoji to get a pair wrong in.
function flagOf(code: string): string {
  return String.fromCodePoint(
    ...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

const ALL: Country[] = DATA.map(([code, name, dial]) => ({
  code,
  name,
  dial,
  flag: flagOf(code),
}));

const BY_CODE = new Map<string, Country>(ALL.map((c) => [c.code, c]));

// Rendered as the first optgroup of a country/phone <select>.
export const COUNTRIES_PRIORITY: Country[] = PRIORITY_CODES.map((code) => {
  const c = BY_CODE.get(code);
  if (!c) throw new Error(`countries.ts: unknown priority code ${code}`);
  return c;
});

const PRIORITY_SET = new Set(PRIORITY_CODES);

// Everything else, alphabetically — the second optgroup.
export const COUNTRIES_OTHER: Country[] = ALL
  .filter((c) => !PRIORITY_SET.has(c.code))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

export const COUNTRIES: Country[] = [...COUNTRIES_PRIORITY, ...COUNTRIES_OTHER];

export function findCountry(code: string | null | undefined): Country | undefined {
  if (!code) return undefined;
  return BY_CODE.get(code.toUpperCase());
}

// The 27 EU member states (ISO-3166-1 alpha-2). NOTE: the priority block above
// is a "markets we sell to" ordering that also holds non-EU countries (CH, GB,
// NO, IS, US…), so it can't be used to decide EU membership — this set is the
// real list. Used to gate the VAT-number field, which only makes sense for EU
// businesses (intra-EU reverse-charge).
export const EU_COUNTRY_CODES = new Set<string>([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
]);

export function isEuCountry(code: string | null | undefined): boolean {
  if (!code) return false;
  return EU_COUNTRY_CODES.has(code.toUpperCase());
}
