// Black Friday to Cyber Monday 2026: five audiences, three emails each (first
// notice Fri 27 Nov, reminder Sat 28 Nov, last chance Mon 30 Nov).
//
//   node docs/emails/bfcm-2026/build.mjs
//
// writes <audience>-<n>-<slug>.html (the broadcast body, format "html") and
// .txt (its plain-text part) next to this file, and
// migrations/0106_bfcm_broadcasts_one_header.sql, which writes emails 2 and 3
// into the DRAFTS that migration 0102 seeded (by name, only while still a
// draft, and only while its body is the one migration 0105 wrote, so a draft
// edited by hand in the admin is left alone). Email 1 of every audience was
// sent on 27 Nov and is not written again. A later change to the words is made
// HERE, built, and saved into the draft again (Claude's broadcast_save, format
// html, with bodyText), or by a migration like 0106.
//
// ONE HEADER (Jacob, 28 Nov 2026): emails 2 and 3 open on the sale bar, then
// the email's own headline with the discount seal beside it (`header`; the
// seals are headers/seals.cjs). Before, a paper picture carrying its own
// eyebrow and headline stood over the email's eyebrow and headline: two
// headers. Email 1 keeps its photo. The first-timers' emails (A2, A3) are
// about the workshop only, never the masterclass.
//
// The sale itself is src/lib/promo.ts (50% workshop, masterclass, 12-week,
// certification, path; 20% live passes of 1, 3 and 6 months; Friday 27 Nov
// 00:00 Brussels until the end of Monday 30 Nov on the US west coast). The
// prices are on the pages without a code, so the links carry no discount, only
// {{prefill}}. Who gets which email: src/lib/broadcasts/bfcm-tags.ts.
//
// Same look as the Forgiveness run-up: parchment card, Spectral headline with
// one Cormorant word in ember, plum offer boxes. Copy book laws apply to every
// string (docs/svh-copy-book.md); the deadline is named plainly and is real.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const F = 'font-family:Figtree,Helvetica,Arial,sans-serif;';
const S = 'font-family:Spectral,Georgia,serif;';
const C = "font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;";
const SITE = 'https://songdance.co';
const PAGES = {
  workshop: ['/workshop', 'register'],
  masterclass: ['/courses/masterclass', 'register'],
  twelve: ['/courses/12-week', 'register'],
  cert: ['/courses/certification', 'register'],
  pass: ['/courses/live-pass', 'lp-buy-title'],
  extend: ['/courses/live-pass?extend=1', 'lp-buy-title'],
};
const url = (page, content, amp = '&amp;') => {
  const [path, hash] = PAGES[page];
  return `${SITE}${path}${path.includes('?') ? amp : '?'}utm_source=broadcast${amp}utm_medium=email${amp}utm_campaign=bfcm_2026${amp}utm_content=${content}${amp}{{prefill}}#${hash}`;
};
const HELLO = 'Hello {{ subscriber.first_name | default: "there" }},';
const UNTIL = 'Monday 30&nbsp;November';

// ---- blocks ----
const em = (t) => `<em style="${C}font-weight:500;font-size:1.05em;color:#C9603A;">${t}</em>`;
const b = (t) => `<strong style="font-weight:600;">${t}</strong>`;
const row = (inner, pad = '0 44px') => `<tr><td class="pad" style="padding:${pad};">${inner}</td></tr>`;
const strip = (t) =>
  `<tr><td align="center" style="background-color:#2A1B2A;padding:11px 20px;text-align:center;"><p style="margin:0;${F}font-size:11px;letter-spacing:2px;color:#F4ECDF;font-weight:600;text-transform:uppercase;">${t}</p></td></tr>`;
// The header picture (strip, headline and discount seal in one image, made by
// headers/build.cjs): email 1 the photo, 2 and 3 the paper one.
const hero = (src, alt, href) =>
  `<tr><td style="padding:0;"><a href="${href}" style="display:block;"><img src="${SITE}/email/${src}" width="600" alt="${alt}" style="width:100%;height:auto;background-color:#4A3848;"></a></td></tr>`;
const eyebrow = (t) =>
  `<p style="margin:0 0 22px;${F}font-size:11px;letter-spacing:2.5px;color:#A14826;font-weight:600;text-transform:uppercase;"><span style="display:inline-block;width:26px;height:1px;background-color:#A14826;vertical-align:middle;margin-right:12px;"></span>${t}</p>`;
const h1 = (t) => `<h1 class="h1" style="${S}font-weight:400;font-size:42px;line-height:1.12;color:#2A1B2A;margin:0 0 28px;">${t}</h1>`;
// The header of emails 2 and 3: eyebrow and headline as text, the seal beside
// them. One headline per email, and it is the email's own. The table reads
// right to left so that on a phone (where the two cells stack) the seal comes
// first, top right, and the headline gets the whole width under it.
const h1b = (t) => `<h1 class="h1b" style="${S}font-weight:400;font-size:38px;line-height:1.14;color:#2A1B2A;margin:0 0 28px;">${t}</h1>`;
const header = ({ eyebrowText, title, seal: [key, alt, two], href }) => {
  const w = two ? 176 : 160;
  const k = two ? ' seal-img2' : '';
  return `<table role="presentation" dir="rtl" width="100%" cellpadding="0" cellspacing="0"><tr><td dir="ltr" class="seal-td" width="${w}" valign="top" align="right" style="width:${w}px;padding:0;vertical-align:top;text-align:right;"><a href="${href}" style="display:block;"><img class="seal-img${k}" src="${SITE}/email/bfcm/seal-${key}.png" width="${w}" alt="${alt}" style="width:${w}px;height:auto;${F}font-size:12px;line-height:1.4;color:#A14826;"></a></td><td dir="ltr" class="hd-td" valign="top" align="left" style="padding:0 14px 0 0;vertical-align:top;text-align:left;">${eyebrow(eyebrowText).replace('<p style="', '<p class="eye" style="')}${h1b(title)}</td></tr></table>`;
};
const HEADER_CSS = `.seal-td{display:block!important;width:100%!important;}
.seal-img{width:100px!important;margin-left:auto!important;}
.seal-img2{width:112px!important;}
.hd-td{display:block!important;width:100%!important;padding:0!important;margin-top:-46px!important;}
.eye{padding-right:112px!important;}
.h1b{font-size:32px!important;line-height:1.14!important;margin-bottom:22px!important;}
`;
const p = (t, last = false) => `<p style="${F}font-size:16px;line-height:1.7;color:#2A1B2A;margin:0 0 ${last ? 0 : 16}px;">${t}</p>`;
// One offer: a plum box with what it is, the two prices and its button.
const priceLines = (lines) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #6B4560;">${lines
    .map(
      ([len, holds, was, now]) =>
        `<tr><td style="padding:11px 0;border-top:1px solid #6B4560;vertical-align:top;"><p style="${S}font-size:18px;line-height:1.3;color:#F4ECDF;margin:0;">${len}</p><p style="${F}font-size:13px;line-height:1.5;color:#C9B4C3;margin:2px 0 0;">${holds}</p></td><td align="right" style="padding:11px 0;border-top:1px solid #6B4560;vertical-align:top;text-align:right;"><p style="${S}font-size:18px;line-height:1.3;color:#F4ECDF;margin:0;">${now}</p><p style="${F}font-size:13px;line-height:1.5;color:#C9B4C3;margin:2px 0 0;text-decoration:line-through;">${was}</p></td></tr>`,
    )
    .join('')}</table>`;
const offer = ({ label, head, body, was, now, per = '', lines, cta, href, note }) =>
  `<tr><td class="pad" style="padding:26px 44px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#4A2540;border-radius:4px;"><tr><td class="pad" style="padding:34px 36px 32px;"><p style="margin:0 0 14px;${F}font-size:11px;letter-spacing:2.5px;color:#E7C9B8;font-weight:600;text-transform:uppercase;">${label}</p><h2 class="offer-h" style="${S}font-weight:400;font-size:29px;line-height:1.2;color:#F4ECDF;margin:0 0 14px;">${head}</h2><p style="${F}font-size:15px;line-height:1.7;color:#EADFCB;margin:0 0 18px;">${body}</p>${lines ? priceLines(lines) : `<p style="${S}font-size:30px;line-height:1.2;color:#F4ECDF;margin:0;"><span style="font-size:19px;color:#C9B4C3;text-decoration:line-through;">${was}</span>&nbsp; ${now}<span style="${F}font-size:14px;color:#C9B4C3;"> ${per}</span></p>`}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 12px;"><tr><td style="background-color:#F4ECDF;border-radius:32px;"><a href="${href}" style="display:inline-block;${F}font-size:15px;font-weight:600;letter-spacing:0.3px;color:#4A2540;padding:15px 32px;text-decoration:none;">${cta} &rarr;</a></td></tr></table><p style="${F}font-size:13px;line-height:1.6;color:#C9B4C3;margin:0;">${note}</p></td></tr></table></td></tr>`;
// A section between the letter and the offers: a heading, then either titled
// rows (a list from the course's own page) or paragraphs.
const itemRows = (items) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #E2D5C1;">${items
    .map(
      ([title, body]) =>
        `<tr><td style="padding:14px 0 15px;border-top:1px solid #E2D5C1;"><p style="${S}font-size:18px;line-height:1.35;color:#2A1B2A;margin:0 0 ${body ? 5 : 0}px;">${title}</p>${body ? `<p style="${F}font-size:15px;line-height:1.65;color:#4A3848;margin:0;">${body}</p>` : ''}</td></tr>`,
    )
    .join('')}</table>`;
const GAP = '<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>';
// The letter: paragraphs, and where it helps a list of titled rows ({ items }).
const letter = (parts) =>
  parts.map((t, j) => (typeof t === 'string' ? p(t, j === parts.length - 1) : itemRows(t.items) + (j === parts.length - 1 ? '' : GAP))).join('');
const letterText = (parts) =>
  parts.map((t) => (typeof t === 'string' ? plain(t) : t.items.map(([q, a]) => `${plain(q)}\n${plain(a)}`).join('\n\n'))).join('\n\n');
// What someone said, as they said it, with their name (from the page's own
// "Voices from the practice"; never reworded, trimmed at a sentence end).
const quoteRows = (quotes) =>
  quotes
    .map(
      ([text, who], j) =>
        `<p style="${C}font-weight:500;font-size:21px;line-height:1.45;color:#2A1B2A;margin:0 0 8px;">&ldquo;${text}&rdquo;</p><p style="${F}font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;color:#A14826;margin:0 0 ${j === quotes.length - 1 ? 0 : 24}px;">${who}</p>`,
    )
    .join('');
const h2 = (t) => `<h2 class="offer-h" style="${S}font-weight:400;font-size:27px;line-height:1.22;color:#2A1B2A;margin:0 0 18px;">${t}</h2>`;
const section = ({ h, intro, items, quotes, paras }) =>
  row(
    h2(h) +
      (intro ? p(intro) : '') +
      (items ? itemRows(items) : '') +
      (quotes ? quoteRows(quotes) : '') +
      (paras ? (items ? GAP : '') + paras.map((t, j) => p(t, j === paras.length - 1)).join('') : ''),
    '34px 44px 6px',
  );
const sectionText = ({ h, intro, items, quotes, paras }) =>
  [
    plain(h).toUpperCase(),
    ...(intro ? [plain(intro)] : []),
    ...(items ? [items.map(([t, bd]) => `- ${plain(t)}${bd ? `: ${plain(bd)}` : ''}`).join('\n')] : []),
    ...(quotes ? quotes.map(([t, who]) => `"${plain(t)}"\n${plain(who)}`) : []),
    ...(paras ? paras.map(plain) : []),
  ].join('\n\n');
const signoff = (ps, close = 'With love,') =>
  row(
    `<p style="${C}font-size:20px;line-height:1.5;color:#4A3848;margin:0 0 28px;">${close}<br>Jacob</p>${ps ? `<p style="${F}font-size:15px;line-height:1.7;color:#4A3848;margin:0;"><strong style="font-weight:600;color:#2A1B2A;">P.S.</strong> ${ps}</p>` : ''}`,
    '34px 44px 42px',
  );
const FOOT = `<tr><td class="pad" style="background-color:#EADFCB;padding:32px 44px 34px;"><img src="https://songdance.co/brand/logo-wordmark-dark.png" width="130" alt="Songdance" style="width:130px;height:auto;margin:0 0 18px;"><p style="${C}font-size:16px;line-height:1.5;color:#7A6A78;margin:0 0 18px;">The sound was always yours.</p><p style="${F}font-size:11px;line-height:1.7;color:#7A6A78;margin:0 0 6px;">Three emails about this, the last one on Monday. Not for you? <a href="{{ unsubscribe_url }}" style="color:#7A6A78;text-decoration:underline;">Unsubscribe</a> and you won&rsquo;t hear from this list again.</p><p style="${F}font-size:11px;line-height:1.7;color:#9A8A78;margin:0;">Songdance BV &middot; Beaupréstraat 13, 8310 Bruges, Belgium<br>BE0743575076</p></td></tr>`;

const page = (title, preheader, rows, css = '') => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,500;1,400&family=Cormorant+Garamond:ital,wght@1,400;1,500&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
body{margin:0;padding:0;background-color:#EADFCB;}
table{border-collapse:collapse;}
img{display:block;border:0;outline:none;text-decoration:none;}
a{color:#A14826;text-decoration:none;}
.preheader{display:none!important;visibility:hidden;opacity:0;max-height:0;overflow:hidden;mso-hide:all;}
@media only screen and (max-width:600px){
.wrapper{width:100%!important;}
.pad{padding-left:24px!important;padding-right:24px!important;}
.h1{font-size:34px!important;line-height:1.14!important;}
.offer-h{font-size:26px!important;}
${css}}
</style>
</head>
<body style="margin:0;padding:0;background-color:#EADFCB;-webkit-font-smoothing:antialiased;">
<span class="preheader">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EADFCB;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="wrapper" width="600" cellpadding="0" cellspacing="0" style="width:600px;background-color:#F4ECDF;border-radius:4px;overflow:hidden;">
${rows.join('\n')}
${FOOT}
</table>
</td></tr>
</table>
</body>
</html>
`;
const TEXT_FOOT = `--
Three emails about this, the last one on Monday.
Not for you? Unsubscribe: {{ unsubscribe_url }}
Songdance BV, Beaupréstraat 13, 8310 Bruges, Belgium
`;

// ---- the offers (EUR; every page shows the reader's own currency) ----
const CUR = 'The price is already on the page, in your own currency. No code needed.';
const OFFERS = {
  workshop: (c) => ({
    page: 'workshop',
    label: 'The workshop &middot; 50% off',
    head: 'Seventy minutes, live on Zoom',
    body: 'An introduction to Somatic Vocal Healing, a somatic warm-up with live piano, guided sounding, and a first tool for everyday life. Your microphone stays off unless you want it on. The replay is included.',
    was: '&euro;22', now: '&euro;11', cta: 'Choose a date', href: url('workshop', c), note: CUR,
    text: 'THE WORKSHOP, 50% OFF: EUR 11 instead of EUR 22\nSeventy minutes, live on Zoom: an introduction to Somatic Vocal Healing, a somatic warm-up with live piano, guided sounding, and a first tool for everyday life. Your microphone stays off unless you want it on. Replay included.',
  }),
  masterclass: (c) => ({
    page: 'masterclass',
    label: 'The masterclass &middot; 50% off',
    head: 'A hundred minutes, for those who work with people',
    body: 'For therapists, coaches, bodyworkers, teachers and anyone who holds space. First you feel the practice in your own body. Then how it works, your role while someone sounds, and where it fits in your work, and where it doesn&rsquo;t.',
    was: '&euro;44', now: '&euro;22', cta: 'See the masterclass dates', href: url('masterclass', c), note: CUR,
    text: 'THE MASTERCLASS, 50% OFF: EUR 22 instead of EUR 44\nA hundred minutes, live on Zoom, for therapists, coaches, bodyworkers, teachers and anyone who holds space. First you feel the practice in your own body. Then how it works, your role while someone sounds, and where it fits in your work.',
  }),
  twelve: (c) => ({
    page: 'twelve',
    label: 'The 12-week course &middot; 50% off',
    head: 'The whole practice, for yourself',
    body: '18+ hours of video across 12 modules, full of guided practices. Twelve weeks of weekly live Q&amp;As with me. A student community. Lifetime access to the materials.',
    was: '&euro;550', now: '&euro;275', cta: 'See the 12-week course', href: url('twelve', c),
    note: 'The monthly plans are half price too. ' + CUR,
    text: 'THE 12-WEEK COURSE, 50% OFF: EUR 275 instead of EUR 550\n18+ hours of video across 12 modules, twelve weeks of weekly live Q&As with me, a student community, lifetime access to the materials. The monthly plans are half price too.',
  }),
  path: (c) => ({
    page: 'cert',
    label: 'The certification path &middot; 50% off',
    head: 'To hold space for others',
    body: 'The 12-week course, then the nine-month certification course: the class library and written manuals, weekly Q&amp;As and a monthly deepening session, Practice Together with fellow students, and the way to becoming a certified practitioner.',
    was: '&euro;1,347', now: '&euro;670', cta: 'See the certification path', href: url('cert', c),
    note: 'The monthly plans are half price too. ' + CUR,
    text: 'THE CERTIFICATION PATH, 50% OFF: EUR 670 instead of EUR 1,347\nThe 12-week course, then the nine-month certification course: class library and manuals, weekly Q&As and a monthly deepening session, Practice Together, and the way to becoming a certified practitioner. The monthly plans are half price too.',
  }),
  cert: (c, begins) => ({
    page: 'cert',
    label: 'The certification course &middot; 50% off',
    head: 'Nine months, to hold space for others',
    body: `The class library and written manuals, nine months of weekly Q&amp;As and a monthly deepening session, Practice Together with fellow students, the SVH app, and the way to becoming a certified practitioner. ${begins}`,
    was: '&euro;797', now: '&euro;395', cta: 'See the certification course', href: url('cert', c),
    note: 'The monthly plans are half price too. ' + CUR,
    text: `THE CERTIFICATION COURSE, 50% OFF: EUR 395 instead of EUR 797\nThe class library and manuals, nine months of weekly Q&As and a monthly deepening session, Practice Together, the SVH app, and the way to becoming a certified practitioner. ${begins.replace(/&rsquo;/g, "'")} The monthly plans are half price too.`,
  }),
  pass: (c, starts) => ({
    page: 'pass',
    label: 'The live pass &middot; 20% off',
    head: 'Back into the live sessions',
    body: `The weekly Q&amp;A, one live hour, and the monthly deepening session, two hours on one theme. ${starts}`,
    lines: [
      ['1 month', '4 Q&amp;As, 1 deepening session', '&euro;52', '&euro;41'],
      ['3 months', '12 Q&amp;As, 3 deepening sessions', '&euro;132', '&euro;105'],
      ['6 months', '24 Q&amp;As, 6 deepening sessions', '&euro;234', '&euro;187'],
      ['12 months', '48 Q&amp;As, 12 deepening sessions', '&euro;436', '&euro;348'],
      ['Monthly', 'every session while it runs, cancel any time', '&euro;52, then &euro;44', '&euro;40, then &euro;44 a month'],
    ],
    cta: 'Choose a live pass', href: url('pass', c),
    note: 'The monthly starts at &euro;40 for its first month. ' + CUR,
    text: `THE LIVE PASS, 20% OFF\nThe weekly Q&A, one live hour, and the monthly deepening session, two hours on one theme.\n1 month (4 Q&As, 1 deepening session): EUR 41 instead of EUR 52\n3 months (12 Q&As, 3 deepening sessions): EUR 105 instead of EUR 132\n6 months (24 Q&As, 6 deepening sessions): EUR 187 instead of EUR 234\n12 months (48 Q&As, 12 deepening sessions): EUR 348 instead of EUR 436\nMonthly, cancel any time: EUR 40 the first month (instead of EUR 52), then EUR 44 a month\n${starts.replace(/&rsquo;/g, "'")}`,
  }),
};
// The CEEE 2025 cohort: the year pass first (their "CEEE 2027"), then the rest.
const ceeePass = (c) => {
  const o = OFFERS.pass(c, 'Once your address is in, the page shows the day your pass would start.');
  const [m1, m3, m6, m12, monthly] = o.lines;
  return {
    ...o,
    head: 'Your live sessions for 2027',
    lines: [['12 months &middot; your CEEE 2027', m12[1], m12[2], m12[3]], m1, m3, m6, monthly],
    note: 'Applying for certification: tick &ldquo;Extend my certification window&rdquo; on the same page. ' + CUR,
    text: o.text.replace('THE LIVE PASS, 20% OFF', 'THE LIVE PASS, 20% OFF (12 months = your CEEE 2027)') + '\nApplying for certification: tick "Extend my certification window" on the same page.',
  };
};
const BEGINS_AFTER = 'You already have the foundation, so you take it on its own.';
const BEGINS_RUNNING = 'It begins when your 12 weeks are over, so nothing overlaps.';
const PASS_NOW = 'A pass starts the day you buy it.';
const PASS_AFTER = 'It starts the day after your course&rsquo;s live sessions end, so you pay for nothing twice.';

// The bar over emails 2 and 3 (email 1 has it inside its photo).
const STRIP = [
  `Black Friday &middot; through ${UNTIL}`,
  `Black Friday &middot; through ${UNTIL}`,
  'Last day &middot; ends tonight',
];

// ---- the five audiences ----
// Each email: subject, preheader, h1, paragraphs (HTML), offers, ps, and the
// same in plain text (paragraphs without markup are derived).
const AUDIENCES = [
  {
    key: 'a-new',
    name: 'new: never a workshop or masterclass',
    include: '',
    exclude: 'bfcm:known,bfcm:bought,prod_svh_12w,prod_svh_9m',
    hero: ['jacob-sounding-heart.jpg', 'Black Friday: 50% off the workshop and the masterclass, through Monday 30 November'],
    eyebrow: 'The workshop &amp; the masterclass',
    seal: ['workshop', '50% off the workshop'],
    offers: (c) => [OFFERS.workshop(c), OFFERS.masterclass(c)],
    emails: [
      {
        slug: 'an-hour-of-honesty',
        subject: 'An hour of honesty, at half price',
        preheader: 'The workshop for €11, the masterclass for €22. Through Monday.',
        h1: `An hour of honesty, ${em('at half price.')}`,
        body: [
          'I don&rsquo;t do much with Black Friday. This year I&rsquo;m using it for one thing: the first step.',
          'Maybe you have been reading these emails for a while and have never made a sound with us. That&rsquo;s fine. The first sound is the longest.',
          `The workshop is seventy minutes, live on Zoom. It is not singing, and nobody performs. You ask a question your mind can&rsquo;t answer first, you breathe in, and you let your body make one tone: the tone of what&rsquo;s there, right now. You don&rsquo;t need a good voice. You need an honest one.`,
          `From today through ${UNTIL}, a seat is half price. So is the masterclass, the longer session for people who work with people.`,
        ],
        ps: 'Any date on the page counts, also one in a few weeks. What matters is that you register before Monday night.',
      },
      // Emails 2 and 3 for first-timers are about the workshop only (Jacob,
      // 28 Nov 2026): one offer, no masterclass. Email 2 is one list of what
      // people say before a first time, no second list of questions under it.
      {
        slug: 'you-dont-need-a-good-voice',
        subject: 'You don’t need a good voice',
        preheader: 'What people tell me before their first workshop. Half price through Monday.',
        eyebrow: 'The workshop',
        offers: (c) => [OFFERS.workshop(c)],
        h1: `You don&rsquo;t need <br>${em('a good voice.')}`,
        body: [
          'You need an honest one. And that one you already have.',
          'Before their first workshop, almost everyone tells me one of three things. If one of them is yours, this email is for you.',
          {
            items: [
              [
                '&ldquo;I can&rsquo;t sing.&rdquo;',
                'Good. This isn&rsquo;t singing. There is no melody to hit and nobody to please. You breathe in and let your body make one tone, the tone of what&rsquo;s there right now. That is the whole instruction. You cannot do it wrong; it will always express something.',
              ],
              [
                '&ldquo;Someone will hear me.&rdquo;',
                'Not in the workshop. Your microphone stays off unless you want it on, so the only one who hears your sound is you. And if it is the people at home you are thinking of: that is the most common question in this work. Some people start in their car or their bathroom. Soft counts.',
              ],
              [
                '&ldquo;What if nothing comes?&rdquo;',
                'Then that is what&rsquo;s there. A closed door has a sound too, and we start with that one.',
              ],
            ],
          },
          'Nobody will ask you to scream, and nobody is put on the spot. Nothing here needs you to be ready.',
          `The first sound is the longest. Every one after it is shorter. Through ${UNTIL}, a seat for that first one is half price.`,
        ],
        ps: 'You don&rsquo;t have to be free this weekend. Any date on the page counts, also one in a few weeks, as long as you register before Monday night.',
      },
      {
        slug: 'ends-tonight',
        subject: 'Half price ends tonight',
        preheader: 'Your first workshop for €11 instead of €22. Last day.',
        eyebrow: 'The workshop',
        offers: (c) => [OFFERS.workshop(c)],
        h1: `Most of us <br>learned early <br>${em('to be quiet.')}`,
        body: [
          'To stay safe. To belong. To not take up too much space. Over time that becomes a body that&rsquo;s holding a lot. Tension. A tight throat. The feeling that some part of you never quite arrives.',
          'Nothing in you is broken. It just hasn&rsquo;t been heard for a long time.',
          'That is all the workshop is: seventy minutes of hearing it. You ask a question your mind can&rsquo;t answer first, you breathe in, and you let your body make one tone. One tone is the whole instruction. The rest we do together.',
          'This is my last note about the half price. After tonight a seat is &euro;22 again. If you were going to come one day anyway, today it is &euro;11.',
        ],
        ps: 'Tonight means the end of Monday, wherever you are. And any date on the page counts, also one in a few weeks.',
        close: 'See you in the circle,',
      },
    ],
  },
  {
    key: 'b-workshop',
    name: 'workshop or masterclass, no course yet',
    include: 'bfcm:workshop',
    exclude: 'bfcm:bought,prod_svh_12w,prod_svh_9m',
    hero: ['svh-circle-sunset.jpg', 'Black Friday: 50% off the 12-week course and the certification, through Monday 30 November'],
    eyebrow: 'The 12-week course &amp; the certification path',
    seal: ['courses', '50% off both courses'],
    offers: (c) => [OFFERS.twelve(c), OFFERS.path(c)],
    emails: [
      {
        slug: 'after-the-first-sound',
        subject: 'After the first sound',
        preheader: 'The 12-week course and the certification path, half price through Monday.',
        h1: `After the first sound, ${em('the practice.')}`,
        body: [
          'You have sounded with us, in a workshop or a masterclass. One hour is enough to find out that the voice knows things the mind hasn&rsquo;t caught up with yet.',
          'It is not enough to make it yours. That takes a while, and a map: fear, anger, grief, joy, the flat days when nothing seems to be there, the old wounds. One at a time, at your own tempo.',
          `That is the 12-week course. After a workshop it is usually 20% off for two days. From today through ${UNTIL} it is ${b('50% off')}, and so is the certification path, for those who want to hold space for others one day.`,
        ],
        ps: 'Questions about which one fits? Reply to this email. A person answers, plainly. If it&rsquo;s not for you, we&rsquo;ll say so.',
      },
      {
        slug: 'which-one-is-yours',
        subject: 'Which one is yours?',
        preheader: 'For yourself, or to hold space for others. Both half price through Monday.',
        h1: `For yourself, <br>${em('or for others too?')}`,
        body: [
          `${b('If you want this for yourself:')} the 12-week course. A practice that fits in a kitchen. Twelve modules, a live hour with me every week, and the materials stay yours for life.`,
          `${b('If people already come to you with what they carry:')} the certification path. First the same 12 weeks, because nobody holds space for a sound they haven&rsquo;t made themselves. Then nine months of learning to hold that space. A space holder, not a healer: the person in front of you heals themselves.`,
          `Both are half price through ${UNTIL}. The twelve weeks of live Q&amp;As start the day you join.`,
        ],
        ps: 'The 12-week course can become the path later. But the path at half price is this weekend.',
      },
      {
        slug: 'ends-tonight',
        subject: 'Half price ends tonight',
        preheader: 'The 12-week course for €275, the certification path for €670. Last day.',
        h1: `The last day <br>${em('at half price.')}`,
        body: [
          'This is my last note about it.',
          'If the workshop stayed with you, and a small yes has been waiting, tonight is when the price goes back: the 12-week course to &euro;550, the path to &euro;1,347.',
          'And if now isn&rsquo;t the time, that is an honest answer too. Trees don&rsquo;t hurry.',
        ],
        ps: 'Tonight means the end of Monday, wherever you are.',
      },
    ],
  },
  {
    key: 'c-12w-ended',
    name: '12-week course finished, no certification',
    include: 'bfcm:12w-ended',
    exclude: 'bfcm:bought,prod_svh_9m',
    hero: ['svh-retreat-circle-sunset-wide.jpg', 'Black Friday: 50% off the certification course, 20% off live passes, through Monday 30 November'],
    eyebrow: 'For those who did the 12 weeks',
    seal: ['certification-pass', '50% off the certification course, 20% off live passes', true],
    offers: (c) => [OFFERS.cert(c, BEGINS_AFTER), OFFERS.pass(c, PASS_NOW)],
    emails: [
      {
        slug: 'the-foundation',
        subject: 'Twelve weeks was the foundation',
        preheader: 'The certification course at half price, or a live pass at 20% off. Through Monday.',
        h1: `Twelve weeks was ${em('the foundation.')}`,
        body: [
          'You did the 12-week course. The materials are still yours, and I hope a tone still finds its way out now and then, in the kitchen or the parked car.',
          'What ended is the live part: the weekly hour together, the questions, hearing each other. Sounding alone is one thing. Being heard changes the sound.',
          'You can come back for just one month. Feel the connection and the aliveness of the community again, ask your questions, share your sound in a Q&amp;A, or simply get back to the practice. And join a live deepening session with me.',
          `Through ${UNTIL} there are two ways back in, both at a price I don&rsquo;t usually offer.`,
        ],
        ps: 'Not sure which? The pass brings back the live sessions, for one month or a whole year. The certification course brings them back for nine months and teaches you to hold space for someone else.',
      },
      {
        slug: 'back-to-the-circle',
        subject: 'Come back to the circle',
        preheader: 'Two ways back into the live sessions, both discounted through Monday.',
        h1: `You don&rsquo;t have to <br>${em('do it alone.')}`,
        body: [
          'A practice kept alone tends to go quiet. Not because anything went wrong. Life is loud, and there is nobody to ask &ldquo;what is below that?&rdquo; when you would rather not look.',
          'In a Q&amp;A somebody else asks the question you didn&rsquo;t know you had. In a deepening session we take two hours for one theme. That is what the live sessions are for.',
          `${b('If you want them back:')} a live pass, 20% off. ${b('If you have been wondering whether you could hold space for others:')} the certification course, half price. Both through ${UNTIL}.`,
        ],
        ps: 'A reply to this email reaches us. If you tell us where you are with the practice, we&rsquo;ll tell you honestly which of the two fits.',
      },
      {
        slug: 'ends-tonight',
        subject: 'Both offers end tonight',
        preheader: 'Certification course €395 instead of €797. Live passes 20% off. Last day.',
        h1: `The last day <br>${em('for both.')}`,
        body: [
          'This is my last note about it.',
          'Tonight the certification course goes back to &euro;797 and the live passes to their usual price.',
          'One month of the live pass is enough to feel the community again: your questions, your sound in a Q&amp;A, a deepening session with me, and the practice back in your week.',
          'If neither is for you now, nothing is lost. Your 12 weeks stay yours, and so does your voice.',
        ],
        ps: 'Tonight means the end of Monday, wherever you are.',
      },
    ],
  },
  {
    key: 'd-12w-late',
    name: 'on the 12-week course, week 7 to 12',
    include: 'bfcm:12w-late',
    exclude: 'bfcm:bought,prod_svh_9m',
    hero: ['svh-retreat-circle-sunset-wide.jpg', 'Black Friday: 50% off the certification course, 20% off live passes, through Monday 30 November'],
    eyebrow: 'For the second half of your 12 weeks',
    eyebrow2: 'Your 12 weeks, second half',
    seal: ['certification-pass', '50% off the certification course, 20% off live passes', true],
    offers: (c) => [OFFERS.cert(c, BEGINS_RUNNING), OFFERS.pass(c, PASS_AFTER)],
    emails: [
      {
        slug: 'before-your-twelve-weeks-end',
        subject: 'Before your twelve weeks end',
        preheader: 'Two ways to keep the live sessions going, both discounted through Monday.',
        h1: `Before your twelve weeks ${em('end.')}`,
        body: [
          'You are in the second half of the 12-week course. In a few weeks the weekly Q&amp;As stop for you. The materials stay yours for life; the live hour is what ends.',
          `If you would like to keep going after week twelve, this weekend is a good moment to decide. Through ${UNTIL} there are two ways, both discounted, and neither overlaps with the weeks you still have.`,
        ],
        ps: 'And if twelve weeks turns out to be exactly enough, that is a fine answer. This is a tool, not a destination.',
      },
      {
        slug: 'what-comes-after-week-twelve',
        subject: 'What comes after week twelve',
        preheader: 'Go on for nine months, or keep the weekly hour. Both discounted through Monday.',
        h1: `After week twelve, <br>${em('two doors.')}`,
        body: [
          `${b('The certification course')} is for you if somewhere in these weeks you thought: I would like to sit with someone else while they do this. Nine months of classes, manuals, Q&amp;As and practice with fellow students. You learn to hold space. The person in front of you heals themselves.`,
          `${b('The live pass')} is for you if you simply want the weekly hour to continue: the Q&amp;As and the monthly deepening session, for as many months as you choose.`,
          `Half price on the first, 20% off the second, through ${UNTIL}. Both start when your 12 weeks are over.`,
        ],
        ps: 'Not sure? Bring it to this week&rsquo;s Q&amp;A, or reply to this email.',
      },
      {
        slug: 'ends-tonight',
        subject: 'Both offers end tonight',
        preheader: 'Certification course €395 instead of €797. Live passes 20% off. Last day.',
        h1: `The last day <br>${em('for both.')}`,
        body: [
          'This is my last note about it.',
          'Tonight the certification course goes back to &euro;797 and the live passes to their usual price. Whatever you choose, your 12 weeks go on exactly as they are.',
        ],
        ps: 'Tonight means the end of Monday, wherever you are.',
        close: 'See you in the Q&amp;A,',
      },
    ],
  },
  {
    key: 'e-12w-early',
    name: 'on the 12-week course, week 1 to 6',
    include: 'bfcm:12w-early',
    exclude: 'bfcm:bought,prod_svh_9m',
    hero: ['svhgpt-06-holding-space.jpg', 'Black Friday: 50% off the certification course, through Monday 30 November'],
    eyebrow: 'For those who just began the 12 weeks',
    eyebrow2: 'Your 12 weeks, just begun',
    seal: ['certification', '50% off the certification course'],
    offers: (c) => [OFFERS.cert(c, BEGINS_RUNNING)],
    emails: [
      {
        slug: 'a-little-early',
        subject: 'This is a little early',
        preheader: 'If you already know you want to go on: the certification course, half price through Monday.',
        h1: `This is ${em('a little early.')}`,
        body: [
          'You have only just begun the 12-week course, so in a way this email comes too soon. I am sending it anyway, because the price is only there for four days.',
          `Some people know in the first weeks that they want to go on and learn to hold space for others. If that is you: through ${UNTIL} the certification course is half price. It begins when your 12 weeks are over.`,
          'If you don&rsquo;t know yet, that is an honest answer. Stay with your twelve weeks. Your tempo is the right tempo.',
        ],
        ps: 'Nothing changes in your 12-week course either way.',
      },
      {
        slug: 'to-hold-space',
        subject: 'A space holder, not a healer',
        preheader: 'What the certification course is, and who it is for. Half price through Monday.',
        h1: `A space holder, <br>${em('not a healer.')}`,
        body: [
          'A word on what the certification course is, since you are still new here.',
          'In your 12 weeks you learn to make the sound of what is there, for yourself. In the nine months after, you learn to sit with someone else while they do it: to ask the question, to wait, to not take over. Help that doesn&rsquo;t take over. The person in front of you heals themselves.',
          `It is for therapists, coaches and bodyworkers who want this in their work, and for people who simply feel drawn to it. Half price through ${UNTIL}.`,
        ],
        ps: 'You don&rsquo;t need to have finished anything to decide. But you do need your own 12 weeks first, which you are already in.',
      },
      {
        slug: 'ends-tonight',
        subject: 'Half price ends tonight',
        preheader: 'The certification course for €395 instead of €797. Last day.',
        h1: `The last day <br>${em('at half price.')}`,
        body: [
          'This is my last note about it.',
          'Tonight the certification course goes back to &euro;797. If you already know, today is the day. If you don&rsquo;t, leave it and enjoy your twelve weeks.',
        ],
        ps: 'Tonight means the end of Monday, wherever you are.',
        close: 'See you in the Q&amp;A,',
      },
    ],
  },
  {
    key: 'f-ceee25',
    name: 'CEEE 2025, no CEEE 2026',
    include: 'cert:no-certification',
    exclude: 'bfcm:bought,prod_ceee-26,prod_ceeee-26_monthly,prod_livepass,prod_livepassmonthly',
    hero: ['', 'Black Friday: 20% off live passes, through Monday 30 November'],
    eyebrow: 'For the CEEE 2025 circle',
    offers: (c) => [ceeePass(c)],
    emails: [
      {
        slug: 'your-live-sessions-in-2027',
        subject: 'Your live sessions in 2027',
        preheader: 'A year pass at 20% off, or just one month. Through Monday.',
        h1: `A year of live sessions, ${em('or just a month.')}`,
        body: [
          'You were part of CEEE in 2025, and the certification course came with it as a gift for 2026. That access runs until 31&nbsp;December.',
          `If you would like to keep coming to the live sessions next year, this is the weekend to arrange it. Through ${UNTIL} every live pass is 20% off.`,
          `${b('A whole year:')} the 12-month pass is your CEEE for 2027, 48 Q&amp;As and 12 deepening sessions.`,
          `${b('Or just one month:')} feel the connection and the aliveness of the community again, ask your questions, share your sound in a Q&amp;A, or simply get back to the practice. And join a live deepening session with me.`,
          `One more thing. The course you received with CEEE 2025 did not include applying for certification. If you wish to apply, you can <a href="${url('extend', 'F1_extend')}" style="color:#A14826;">extend your certification window</a> with any pass: it stays open for as long as the pass runs.`,
        ],
        ps: 'The certification window is an add-on to the pass you choose, and it follows the sale price too.',
      },    ],
  },
];


// ---- more to read, per email: taken from the pages the email leads to, so
// each of the three says something of its own (Jacob, 25 Nov 2026). Keyed by
// audience key + email number.
const WORKSHOP_BEATS = [
  ['An introduction to Somatic Vocal Healing', 'The method where sound becomes the language of the body: a closer connection to your body, your own sound, and whatever wants to show up underneath.'],
  ['A somatic warm-up with live piano', 'So your nervous system can arrive before anything else happens. Settling, breath widening, listening getting finer.'],
  ['Guided sounding', 'A somatic practice of giving what&rsquo;s here a sound. Not describing it: sounding it.'],
  ['A first tool for everyday life', 'Something to keep coming back to, when something in you is stuck, when your head is too loud, when the day has made you shut down.'],
];
const TWELVE_ABLE = [
  ['Find and sound a stuck feeling', 'instead of mentally trying to manage it, or waiting for it to pass.'],
  ['Work with your nervous system', 'not against it.'],
  ['Hear what your voice is telling you', 'fear, anger, grief, purpose, even older echoes.'],
  ['Hold a steady, grounded space for sounding', 'first for yourself, eventually for others.'],
  ['Keep practising on your own', 'for life.'],
];
const TWELVE_MODULES = [
  ['1 &middot; Understanding vocal sound', 'Singing, toning, chanting, sounding, and why this practice is its own thing.'],
  ['2 &middot; Becoming comfortable', 'Meeting the collective unease around using the voice.'],
  ['3 &middot; Holding space', 'Steady, grounded footing for sound work, for yourself and others.'],
  ['4 &middot; Reading your sound', 'Hearing the feeling and the pattern inside the voice.'],
  ['5 &middot; Neuroanatomy', 'The brain, the body and the voice, in plain terms.'],
  ['6 &middot; Nervous system flow', 'Using sound to regulate and settle.'],
  ['7 &middot; The five core wounds', 'Rejection, abandonment, betrayal, humiliation, injustice. Met at your own pace, through sound.'],
  ['8 &middot; Sounding toward essence', 'A meditation that listens toward your own essential sound.'],
  ['9 &middot; Sounds of the chakras', 'The energy centres, explored through tone.'],
  ['10 &middot; Sounding with instruments', 'Voice with drum, shruti, or singing bowl.'],
  ['11 &middot; Practising with others', 'First steps in sounding together.'],
  ['12 &middot; Self-healing &amp; integration', 'Carrying the practice forward on your own.'],
];
const CERT_INCLUDES = [
  ['The complete class library', 'Every module with a detailed written manual, self-paced from the moment you join.'],
  ['A live Q&amp;A every week, for nine months', 'A live hour with me, and on some weeks with Karen Evans, co-facilitator on the course.'],
  ['A two-hour deepening session every month', 'With the wider community of practitioners, every one recorded into the library.'],
  ['Practice Together', 'Sessions to give and receive with fellow students. The quiet heart of the course.'],
  ['The SVH app', 'To record and revisit your own sounds, train your ear, and keep practising between sessions.'],
  ['My feedback on your session', 'When you apply for certification you send a video of a session you lead, and I answer it personally.'],
];
const CERT_LEARN = [
  ['To travel through the layers of a sound', 'How to recognise feelings in a voice (high, low, trembling, sharp), how to follow what is underneath the first sound, and how to guide a whole session from beginning to end.'],
  ['The emotions underneath', 'Anger, fear, pain and grief. How each one moves, how it disguises itself, and how to meet it through the voice.'],
  ['Listening with the body', 'Telling grief from pain, fear from overwhelm. Hearing what the voice is almost saying.'],
  ['Skills for holding the space', 'Pacing. Regulation. The volume button. Knowing when to lead, when to hold, and when to let the silence do the work.'],
];
const LIVE_WHAT = [
  ['The weekly Q&amp;A', 'A live hour. This is where the smaller, in-between questions are met, where you bring what came up in a practice and we look at it together. Each replay stays available for two months.'],
  ['The monthly deepening session', 'Two hours on one theme, with the wider community of practitioners.'],
];
const CERT_NOT = 'A note on what it is not: it is not a comprehensive training to become a therapist, coach or psychologist. It is a course in Somatic Vocal Healing specifically. If you mean to work with clients professionally, you should already have a background in holding space.';
const MORE = {
  'a-new1': [{ h: `What happens in ${em('seventy minutes')}`, items: WORKSHOP_BEATS }],
  'a-new2': [
    {
      h: `Voices from ${em('the practice')}`,
      quotes: [
        ['This is a deep immersion into the weave of heart and nervous system. The most beautiful part: there&rsquo;s no need to search for the right words — it&rsquo;s enough to open my mouth.', 'Gwenola &middot; coach'],
        ['Somatic Vocal Healing is a simple yet natural way to connect with the life within us. I&rsquo;m grateful for this practice — it&rsquo;s balanced, practical, and so easy to take in.', 'Anna &middot; PhD researcher'],
      ],
    },
  ],
  'a-new3': [],
  'b-workshop1': [{ h: `After twelve weeks, ${em('you can')}`, items: TWELVE_ABLE }],
  'b-workshop2': [
    { h: `Twelve modules, ${em('one practice')}`, intro: 'What the 12-week course walks through, at your own pace, with a live Q&amp;A every week to bring your questions to:', items: TWELVE_MODULES },
    { h: `And in the nine months ${em('after')}`, intro: 'The certification path adds the training in holding space for someone else. There you learn:', items: CERT_LEARN },
  ],
  'b-workshop3': [
    {
      h: `What no course page ${em('usually admits')}`,
      paras: [
        'Sometimes you&rsquo;ll feel lighter. Sometimes you&rsquo;ll meet something tender first. If all you want is a pleasant hour, there are gentler tools, and they can be good ones.',
        'But if you&rsquo;re willing to meet the parts that have been waiting, the old fear, the grief, the anger, what&rsquo;s on the other side isn&rsquo;t a quick boost. It&rsquo;s a steadier kind of peace.',
      ],
    },
  ],
  'c-12w-ended1': [{ h: `What the certification course ${em('holds')}`, items: CERT_INCLUDES }],
  'c-12w-ended2': [
    { h: `What the live sessions ${em('are')}`, items: LIVE_WHAT },
    { h: `What you learn in the ${em('certification course')}`, intro: 'Your 12 weeks were for your own practice. These nine months are about sitting with someone else while they sound:', items: CERT_LEARN, paras: [CERT_NOT] },
  ],
  'c-12w-ended3': [
    {
      h: `If you are ${em('wondering')}`,
      paras: [
        'Maybe you don&rsquo;t want to stop, and you don&rsquo;t know yet what going on would look like. A month of live sessions is a small way to find out. Nine months of training is a larger one.',
        'And if you have no professional ambition at all and simply want this for yourself: that is enough.',
      ],
    },
  ],
  'd-12w-late1': [{ h: `What the certification course ${em('holds')}`, items: CERT_INCLUDES }],
  'd-12w-late2': [
    { h: `What you learn in ${em('those nine months')}`, items: CERT_LEARN, paras: [CERT_NOT] },
    { h: `And what the pass ${em('keeps open')}`, items: LIVE_WHAT },
  ],
  'd-12w-late3': [
    {
      h: `A small way, ${em('and a larger one')}`,
      paras: [
        'A month of live sessions is a small way to keep going after week twelve. Nine months of training is a larger one. Neither changes anything in the weeks you still have.',
      ],
    },
  ],
  'e-12w-early1': [
    {
      h: `Who goes on ${em('to certification')}`,
      paras: [
        'People who felt in a single workshop, or in their first weeks, that something old had shifted, and who want to learn the work from the inside out. Maybe for one person at a time, maybe for a group, maybe only for themselves.',
        'Therapists, coaches, sound healers, breathworkers, bodyworkers and teachers who want a tool that reaches deeper than words can go. And people with no professional ambition at all. That is enough.',
      ],
    },
    { h: `What the course ${em('holds')}`, items: CERT_INCLUDES },
  ],
  'e-12w-early2': [{ h: `What you learn ${em('there')}`, items: CERT_LEARN, paras: [CERT_NOT] }],
  'e-12w-early3': [],
};

// ---- plain text ----
const plain = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&euro;/g, 'EUR ')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&');

// The length of each body as migration 0105 wrote it (emails 2 and 3).
const WAS = {
  'a-new-2-you-dont-need-a-good-voice': 15308,
  'a-new-3-ends-tonight': 9903,
  'b-workshop-2-which-one-is-yours': 17568,
  'b-workshop-3-ends-tonight': 10145,
  'c-12w-ended-2-back-to-the-circle': 17570,
  'c-12w-ended-3-ends-tonight': 13868,
  'd-12w-late-2-what-comes-after-week-twelve': 17349,
  'd-12w-late-3-ends-tonight': 13258,
  'e-12w-early-2-to-hold-space': 10243,
  'e-12w-early-3-ends-tonight': 6941,
};
const sqlQuote = (s) => `'${s.replace(/'/g, "''")}'`;
const WHEN = ['Fri 27 Nov · first notice', 'Sat 28 Nov · reminder', 'Mon 30 Nov · last chance'];
const seeds = [];

for (const [ai, A] of AUDIENCES.entries()) {
  for (const [i, e] of A.emails.entries()) {
    const n = i + 1;
    const c = `${A.key}${n}`;
    const offersOf = e.offers ?? A.offers;
    const offers = offersOf(`${c}_cta`);
    const first = offers[0];
    const eye = e.eyebrow ?? (n > 1 ? (A.eyebrow2 ?? A.eyebrow) : A.eyebrow); // eyebrow2: short enough for one line beside the seal
    // Email 1: the photo, then eyebrow and headline. Emails 2 and 3: the bar,
    // then ONE header, the email's own headline with the seal beside it.
    const rows = [
      ...(n === 1
        ? [
            hero(`bfcm/${String.fromCharCode(65 + ai)}-${n}.jpg`, A.hero[1], url(first.page, `${c}_hero`)),
            row(eyebrow(eye) + h1(e.h1) + p(HELLO) + letter(e.body), '44px 44px 6px'),
          ]
        : [
            strip(STRIP[i]),
            row(header({ eyebrowText: eye, title: e.h1, seal: A.seal, href: url(first.page, `${c}_hero`) }) + p(HELLO) + letter(e.body), '38px 44px 6px'),
          ]),
      ...(MORE[c] ?? []).map(section),
      ...offers.map(offer),
      signoff(e.ps, e.close),
    ];
    const once = (t) => (A.emails.length === 1 ? t.replace('Three emails about this, the last one on Monday.', 'One email about this.') : t);
    const html = once(page(plain(e.subject), e.preheader, rows, n === 1 ? '' : HEADER_CSS));
    const text = once(`${HELLO}

${letterText(e.body)}
${(MORE[c] ?? []).map((m) => `\n\n${sectionText(m)}`).join('')}


${offersOf(`${c}_text`)
  .map((o) => `${o.text}\n${url(o.page, `${c}_text`, '&')}`)
  .join('\n\n')}

${n > 1 && offers.length === 1 ? '(The price is already on the page, in your own currency. No code needed.)' : '(The prices are already on the pages, in your own currency. No code needed.)'}

${plain(e.close ?? 'With love,')}
Jacob

P.S. ${plain(e.ps)}

${TEXT_FOOT}`);
    const file = `${A.key}-${n}-${e.slug}`;
    writeFileSync(join(here, `${file}.html`), html);
    writeFileSync(join(here, `${file}.txt`), text);
    const name = `BFCM ${String.fromCharCode(65 + ai)}${n} · ${WHEN[i]} · ${A.name}`;
    // Email 1 went out on 27 Nov. Emails 2 and 3 are written into their draft,
    // and only while its body is still the one migration 0105 wrote (its
    // length, with or without the last newline): a draft edited by hand in the
    // admin keeps its words and is saved by hand afterwards.
    if (n > 1 && WAS[file])
      seeds.push(`-- ${file}
UPDATE broadcasts
   SET subject = ${sqlQuote(plain(e.subject))},
       preheader = ${sqlQuote(plain(e.preheader))},
       heading = ${sqlQuote(plain(e.h1).replace(/\s+/g, ' '))},
       body = ${sqlQuote(html)},
       body_text = ${sqlQuote(text)}
 WHERE name = ${sqlQuote(name)} AND status = 'draft'
   AND length(body) IN (${WAS[file]}, ${WAS[file] - 1});
`);
    console.log(name, '·', plain(e.subject));
  }
}

writeFileSync(
  join(here, '../../../migrations/0106_bfcm_broadcasts_one_header.sql'),
  `-- Black Friday 2026, emails 2 and 3 of the five audiences (ten drafts): ONE
-- header instead of two (the sale bar, then the email's own headline with the
-- discount seal beside it; the paper header picture is gone), and the copy
-- reviewed (Jacob, 28 Nov 2026). The two for first-timers (A2, A3) are about
-- the workshop only, never the masterclass, and A2 is one list of what people
-- say before a first time. No "soft counts double", no humming (copy book,
-- revised 28 Nov 2026).
--
-- Only a broadcast that is still a DRAFT is touched, and only while its body
-- is the one migration 0105 wrote (by its length): a draft edited by hand in
-- the admin keeps its words.
--
-- GENERATED by docs/emails/bfcm-2026/build.mjs (each body is
-- docs/emails/bfcm-2026/<file>.html, each body_text its .txt). Do not edit
-- here. A later change to the words: edit the script, run it, and save the
-- draft again (broadcast_save), or add a migration like this one.

${seeds.join('\n')}`,
);
