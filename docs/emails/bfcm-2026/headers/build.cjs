// The header pictures of the Black Friday 2026 emails: one per audience and
// email, written to public/email/bfcm/<A-E>-<1-3>.jpg at 1200 px wide.
// (F, the CEEE 2025 email, is one paper header.)
// Email 1 is the photo header, 2 and 3 the paper one. A header says percents
// and names, never a price: the list reads in many currencies.
// Run: node docs/emails/bfcm-2026/headers/build.cjs (needs Playwright).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const here = __dirname;
const out = path.join(here, '../../../../public/email/bfcm');
const E = 'file://' + path.join(here, '../../../../public/email/') ;
const wave = `<svg class="wave" viewBox="0 0 600 70" preserveAspectRatio="none"><path d="M0 40 C 60 10, 120 70, 180 40 S 300 10, 360 40 S 480 70, 600 36" fill="none" stroke="#E08B63" stroke-width="1"/><path d="M0 50 C 80 30, 140 66, 220 48 S 340 28, 420 50 S 540 64, 600 46" fill="none" stroke="#C9B4C3" stroke-width="1" opacity=".7"/></svg>`;
const G = [
  { k: 'A', img: 'jacob-sounding-heart.jpg', pos: '62% 30%', t: 'Your first sound, <em>half price.</em>', s: '<b>The workshop</b> · <b>the masterclass</b>', pe: 'The workshop &amp; the masterclass', w: 'your seat' },
  { k: 'B', img: 'svh-circle-sunset.jpg', pos: '0% 40%', t: 'After the first sound, <em>the practice.</em>', s: '<b>The 12-week course</b><br><b>The certification path</b>', pe: '12-week course &amp; certification', w: 'both courses' },
  { k: 'C', img: 'upala-sounding.jpg', pos: '60% 22%', t: 'Twelve weeks was <em>the foundation.</em>', s: '<b>The certification course</b><br><b>Live passes</b>', pe: 'Certification &amp; live passes', w: 'certification', two: true },
  { k: 'D', img: 'svh-retreat-circle-sunset-wide.jpg', pos: '40% 35%', flip: true, t: 'Before week twelve, <em>the next step.</em>', s: '<b>The certification course</b><br><b>Live passes</b>', pe: 'Certification &amp; live passes', w: 'certification', two: true },
  { k: 'E', img: 'svhgpt-06-holding-space.jpg', pos: '70% 40%', t: 'A space holder, <em>not a healer.</em>', s: '<b>The certification course</b>', pe: 'The certification course', w: 'certification' },
  { k: 'F', only: [1], paperFirst: true, pct: 20, t: 'Stay in the circle <em>in 2027.</em>', pe: 'The live pass', w: 'live passes' },
];
const BAR = { 2: 'Black Friday · through Monday 30 November', 3: 'Last chance · ends Monday 30 November' };
const seal = (g) => `<div class="seal"><span class="n">${g.pct || 50}<sup>%</sup></span><span class="o">off</span><span class="w">${g.w}</span></div>${g.two ? `<div class="seal two"><span class="n">20<sup>%</sup></span><span class="o">off</span><span class="w">live passes</span></div>` : ''}`;
const photo = (g) => `<div class="h" id="${g.k}-1"><div class="ph" style="background-image:url(${E}${g.img});background-position:${g.pos}${g.flip ? ';transform:scaleX(-1)' : ''}"></div><div class="scrim"></div>${wave}<div class="txt"><p class="eye"><i></i>Black Friday</p><h1 class="t">${g.t}</h1><p class="s">${g.s}</p></div><div class="until">Through Monday 30 November</div>${seal(g)}</div>`;
const paper = (g, n) => `<div class="p${g.two ? ' p2' : ''}" id="${g.k}-${n}"><div class="bar">${BAR[n]}</div><div class="txt"><p class="eye"><i></i>${g.pe}</p><h1 class="t">${g.t}</h1></div>${seal(g)}${wave.replace('class="wave"', 'width="600" height="26"').replaceAll('#C9B4C3', '#C9603A')}</div>`;
const html = fs.readFileSync(path.join(here, 'headers.html'), 'utf8').replace('<!--HEADERS-->', G.map((g) => (g.paperFirst ? paper(g, 2).replace(`id="${g.k}-2"`, `id="${g.k}-1"`) : photo(g) + paper(g, 2) + paper(g, 3))).join('<br>'));
const tmp = path.join(here, '.out.html');
fs.writeFileSync(tmp, html);
(async () => {
  const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const pg = await b.newPage({ viewport: { width: 660, height: 900 }, deviceScaleFactor: 2 });
  await pg.goto('file://' + tmp, { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(500);
  for (const g of G) for (const n of g.only || [1, 2, 3]) await pg.locator(`#${g.k}-${n}`).screenshot({ path: path.join(out, `${g.k}-${n}.jpg`), type: 'jpeg', quality: 86 });
  await pg.screenshot({ path: path.join(here, '.sheet.png'), fullPage: true });
  await b.close();
  fs.unlinkSync(tmp);
})();
