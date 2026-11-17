// The Somatic Vocal Healing certificate as one SVG drawing (A4 landscape,
// 297 × 210, one unit = 1 mm). It is Jacob's certificate maker
// (svh-certificate-maker.html, November 2026) redrawn without a page around it,
// so the admin can show it, turn it into a PDF and attach it in one step
// (src/lib/client/certificate-maker.ts).
//
// Every position below was MEASURED from that maker's own layout in Chrome (text
// baselines, the name's box, the stroke under it) and the result is checked
// against it pixel for pixel; they are not estimates. Change a number only
// together with a new comparison.
//
// Two templates, English only for now: completion and excellence. Their words
// are fixed here (CERT_TEMPLATES); the name, the date and the class year are
// what changes per person. Pure: no DOM. The one thing it cannot know is how
// wide the name sets, so the caller hands in a measure for it.

import {
  CERT_FONTS,
  CERT_RINGS,
  CERT_RING_OPACITY_BAND,
  CERT_RING_OPACITY_PAPER,
  CERT_SIGNATURE,
  CERT_WORDMARK,
} from './assets';

export type CertKind = 'completion' | 'excellence';

export const CERT_TEMPLATES: Record<CertKind, { label: string; t2: string; body: string; meta: (year: string) => string; seal: string }> = {
  completion: {
    label: 'Certificate of Completion',
    t2: 'of Completion',
    body: 'for completing the Somatic Vocal Healing Certification Course.',
    meta: (y) => `Class of ${y}`,
    seal: '',
  },
  excellence: {
    label: 'Certificate of Excellence',
    t2: 'of Excellence',
    body: 'for successfully demonstrating competence in Somatic Vocal Healing.',
    meta: (y) => `Certification Course, Class of ${y}`,
    seal: 'CERTIFICATE OF EXCELLENCE',
  },
};

export type CertInput = {
  kind: CertKind;
  name: string;
  /** As printed over the date line, e.g. "17 November 2026". */
  date: string;
  /** The class year, e.g. "2026". */
  year: string;
};

/** Width of the name in mm when set in Cormorant Garamond italic 500 at `sizeMm`. */
export type NameMeasure = (name: string, sizeMm: number) => number;

const PT = 25.4 / 72; // one point in mm
const MAIN_X = 191.5; // centre of the paper side (band 86 + 211 / 2)
const NAME = { family: 'Cormorant Garamond', maxPt: 42, minPt: 20, lineHeight: 1.12, baseline: 0.875, pad: 4, fit: 160 };
// The box the name and its stroke are centred in (the maker's .name-wrap).
const NAME_WRAP = { top: 99.103, height: 25 };
const STROKE = { height: 3.7, gap: 0.6, shift: 2.5, min: 46, max: 112, ratio: 0.68 };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The name's size (it shrinks to fit the line), its baseline and the stroke under it. */
export function layoutName(name: string, measure: NameMeasure): { sizeMm: number; baseline: number; strokeX: number; strokeY: number; strokeW: number } {
  let pt = NAME.maxPt;
  let width = measure(name, pt * PT) + NAME.pad;
  while (width > NAME.fit && pt > NAME.minPt) {
    pt -= 1;
    width = measure(name, pt * PT) + NAME.pad;
  }
  const sizeMm = pt * PT;
  const lineBox = sizeMm * NAME.lineHeight;
  const top = NAME_WRAP.top + (NAME_WRAP.height - (lineBox + STROKE.gap + STROKE.height)) / 2;
  const strokeW = Math.max(STROKE.min, Math.min(width * STROKE.ratio, STROKE.max));
  return {
    sizeMm,
    baseline: top + sizeMm * NAME.baseline,
    strokeX: MAIN_X + STROKE.shift - strokeW / 2,
    strokeY: top + lineBox + STROKE.gap,
    strokeW,
  };
}

function fontFaces(): string {
  return CERT_FONTS.map(
    (f) =>
      `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};src:url(data:font/woff2;base64,${f.b64}) format('woff2')}`,
  ).join('');
}

const n = (v: number) => String(Math.round(v * 1000) / 1000);

export function certificateSvg(input: CertInput, measure: NameMeasure): string {
  const tpl = CERT_TEMPLATES[input.kind];
  const name = input.name.trim() || 'Firstname Lastname';
  const nm = layoutName(name, measure);
  const rings = (opacity: number[]) => CERT_RINGS.map((_, i) => `<use href="#rg${i}" stroke-opacity="${opacity[i]}"/>`).join('');
  const text = (
    x: number,
    y: number,
    family: string,
    weight: number,
    sizeMm: number,
    fill: string,
    value: string,
    o: { italic?: boolean; anchor?: 'start' | 'middle'; spacing?: number; opacity?: number } = {},
  ) =>
    `<text x="${n(x)}" y="${n(y)}" font-family="'${family}'" font-weight="${weight}"${o.italic ? ' font-style="italic"' : ''} font-size="${n(sizeMm)}" fill="${fill}"` +
    `${o.anchor === 'start' ? '' : ' text-anchor="middle"'}${o.spacing ? ` letter-spacing="${n(o.spacing)}"` : ''}${o.opacity ? ` fill-opacity="${o.opacity}"` : ''}>${esc(value)}</text>`;

  const INK = '#2A1B2A';
  const SOFT = '#64535F';
  const EMBER = '#C9603A';
  const PLUM = '#4A2540';
  const PAPER = '#F4ECDF';
  const C = 'Cormorant Garamond';
  const F = 'Figtree';

  const seal = tpl.seal
    ? `<g transform="translate(191.5 176.997)">
<circle r="18.3" fill="none" stroke="${EMBER}" stroke-width=".22"/><circle r="11.4" fill="none" stroke="${EMBER}" stroke-width=".16"/>
<g font-family="'${F}'" font-weight="600" font-size="1.95" letter-spacing=".36" fill="${EMBER}" text-anchor="middle">
<text><textPath href="#seal-top" startOffset="50%">SOMATIC VOCAL HEALING</textPath></text>
<text><textPath href="#seal-bottom" startOffset="50%">${esc(tpl.seal)}</textPath></text></g>
<circle cx="-14.75" cy=".1" r=".38" fill="${EMBER}"/><circle cx="14.75" cy=".1" r=".38" fill="${EMBER}"/>
<circle r="7.4" fill="none" stroke="${EMBER}" stroke-width=".14" stroke-opacity=".45"/><circle r="4.9" fill="none" stroke="${EMBER}" stroke-width=".14" stroke-opacity=".65"/>
<circle r="2.8" fill="none" stroke="${EMBER}" stroke-width=".14" stroke-opacity=".85"/><circle r="1" fill="${EMBER}"/></g>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">
<defs>
<style>${fontFaces()}</style>
<clipPath id="clip-band"><rect x="0" y="0" width="86" height="210"/></clipPath>
<linearGradient id="band-fade" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="210">
<stop offset="0" stop-color="#000"/><stop offset=".185" stop-color="#000"/><stop offset=".30" stop-color="#fff"/>
<stop offset=".72" stop-color="#fff"/><stop offset=".815" stop-color="#000"/><stop offset="1" stop-color="#000"/></linearGradient>
<mask id="band-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="86" height="210"><rect width="86" height="210" fill="url(#band-fade)"/></mask>
<clipPath id="clip-paper"><rect x="86" y="0" width="211" height="210"/></clipPath>
<path id="seal-top" d="M-14,0 A14,14 0 0,1 14,0"/><path id="seal-bottom" d="M-15.45,0 A15.45,15.45 0 0,0 15.45,0"/>
${CERT_RINGS.map((d, i) => `<path id="rg${i}" d="${d}"/>`).join('')}
</defs>
<rect width="297" height="210" fill="${PAPER}"/>
<rect width="86" height="210" fill="${PLUM}"/>
<g clip-path="url(#clip-band)" mask="url(#band-mask)" fill="none" stroke="${PAPER}" stroke-width=".17">${rings(CERT_RING_OPACITY_BAND)}</g>
<g clip-path="url(#clip-paper)" fill="none" stroke="#D8CBB6" stroke-width=".17">${rings(CERT_RING_OPACITY_PAPER)}</g>
<circle cx="43" cy="121" r="1.3" fill="${EMBER}"/>
<svg x="15" y="17" width="54" height="17.777" viewBox="${CERT_WORDMARK.viewBox}">${CERT_WORDMARK.paths.map((d) => `<path fill="${PAPER}" fill-rule="evenodd" d="${d}"/>`).join('')}</svg>
${text(15, 175.415, C, 400, 16.5 * PT, PAPER, 'The only one who', { italic: true, anchor: 'start' })}
${text(15, 182.397, C, 400, 16.5 * PT, PAPER, 'can heal you is you.', { italic: true, anchor: 'start' })}
${text(15, 192.468, F, 500, 7.2 * PT, PAPER, 'SONGDANCE.CO', { anchor: 'start', spacing: 7.2 * PT * 0.2, opacity: 0.7 })}
${text(163.314, 29.646, F, 600, 8 * PT, EMBER, 'SOMATIC VOCAL HEALING', { anchor: 'start', spacing: 8 * PT * 0.36 })}
${text(158.2, 54.314, 'Spectral', 300, 41 * PT, INK, 'Certificate', { anchor: 'start', spacing: -41 * PT * 0.005 })}
${text(MAIN_X, 67.349, C, 400, 23 * PT, EMBER, tpl.t2, { italic: true })}
<path transform="translate(176.5 78.61) scale(.25 .24)" d="M1,5.4 C14,2.2 26,8.1 41,4.9 S68,2.4 83,5.6 S108,7.2 119,3.9" fill="none" stroke="${INK}" stroke-opacity=".38" stroke-width=".25" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
${text(166.832, 93.448, F, 300, 10.5 * PT, SOFT, 'This certificate is awarded to', { anchor: 'start', spacing: 10.5 * PT * 0.02 })}
${text(MAIN_X, nm.baseline, C, 500, nm.sizeMm, PLUM, name, { italic: true })}
<path transform="translate(${n(nm.strokeX)} ${n(nm.strokeY)}) scale(${n(nm.strokeW / 200)} ${n(STROKE.height / 10)})" fill="${EMBER}" d="M0.5,6.3 C26,1.6 57,8.6 99,4.7 C136,1.5 170,4.4 199.4,1.9 C199.9,2.1 199.9,2.7 199.4,2.9 C171,5.9 137,3.4 100,6.7 C58,10.4 27,3.7 1,7.2 C0.2,7.2 0,6.5 0.5,6.3 Z"/>
${text(MAIN_X, 132.097, F, 300, 11.2 * PT, INK, tpl.body)}
${text(MAIN_X, 141.895, C, 400, 13.5 * PT, SOFT, tpl.meta(input.year.trim()), { italic: true })}
${text(136.998, 179.64, C, 400, 15 * PT, INK, input.date.trim(), { italic: true })}
<rect x="107.995" y="183.294" width="58.006" height=".25" fill="${INK}" fill-opacity=".34"/>
${text(133.354, 189.268, F, 500, 9 * PT, INK, 'Date', { anchor: 'start', spacing: 9 * PT * 0.04 })}
${seal}
<svg x="216.998" y="163.107" width="47" height="22.783" viewBox="${CERT_SIGNATURE.viewBox}">${CERT_SIGNATURE.paths.map((d) => `<path fill="${INK}" fill-rule="evenodd" d="${d}"/>`).join('')}</svg>
<rect x="216.996" y="183.294" width="58.006" height=".25" fill="${INK}" fill-opacity=".34"/>
${text(232.573, 189.268, F, 500, 9 * PT, INK, 'Jacob Vermeulen', { anchor: 'start', spacing: 9 * PT * 0.04 })}
${text(224.805, 193.704, F, 300, 8 * PT, SOFT, 'Founder, Somatic Vocal Healing', { anchor: 'start', spacing: 8 * PT * 0.03 })}
</svg>`;
}

/** The file's name as the member downloads it: "SVH Certificate of Excellence - Maria Voss.pdf". */
export function certificateFilename(kind: CertKind, name: string): string {
  const who = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').slice(0, 80);
  return `SVH ${CERT_TEMPLATES[kind].label}${who ? ` - ${who}` : ''}.pdf`;
}
