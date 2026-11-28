// The discount seals of the Black Friday 2026 emails 2 and 3, each a
// transparent PNG at twice its size: public/email/bfcm/seal-<key>.png.
// Since 28 Nov 2026 those emails have ONE header: the sale bar and the
// email's own headline as text, with the seal beside it (build.mjs,
// `header`). The paper pictures (<A-E>-2.jpg, -3.jpg) repeated a headline
// over the email's own and are no longer used.
// A seal says a percent and a name, never a price.
// Run: node docs/emails/bfcm-2026/headers/seals.cjs (needs Playwright).
const path = require('path');
const { chromium } = require('playwright');
const out = path.join(__dirname, '../../../../public/email/bfcm');
const SEALS = [
  { k: 'workshop', w: 'the workshop' },
  { k: 'courses', w: 'both courses' },
  { k: 'certification', w: 'certification' },
  { k: 'certification-pass', w: 'certification', two: true },
];
const one = (pct, w, cls = '') => `<div class="seal ${cls}"><span class="n">${pct}<sup>%</sup></span><span class="o">off</span><span class="w">${w}</span></div>`;
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400&family=Cormorant+Garamond:ital,wght@1,500;1,600&family=Figtree:wght@600;700&display=swap" rel="stylesheet">
<style>
html,body{margin:0;background:transparent}
.c{position:relative;width:184px;height:190px;margin:0 0 20px}
.c.two{width:206px;height:266px}
.seal{position:absolute;left:17px;top:12px;width:150px;height:150px;border-radius:50%;background:#C9603A;box-shadow:0 6px 16px rgba(74,37,64,.24);transform:rotate(-8deg);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#F4ECDF}
.seal:before{content:"";position:absolute;inset:7px;border-radius:50%;border:1px solid rgba(244,236,223,.6)}
.seal .n{font:400 58px/0.95 Spectral,serif;letter-spacing:-1px}
.seal .n sup{font-size:.5em;vertical-align:.62em;margin-left:1px}
.seal .o{font:700 12px Figtree,sans-serif;letter-spacing:3px;text-transform:uppercase;margin-top:6px}
.seal .w{font:italic 600 18px 'Cormorant Garamond',serif;margin-top:2px;color:#F7E6D8}
.seal.b{left:80px;top:134px;width:110px;height:110px;background:#F4ECDF;color:#4A2540;transform:rotate(7deg);box-shadow:0 6px 16px rgba(74,37,64,.28)}
.seal.b:before{border-color:rgba(74,37,64,.45);inset:6px}
.seal.b .n{font-size:38px}
.seal.b .o{font-size:10px;letter-spacing:2.2px;margin-top:4px}
.seal.b .w{color:#A14826;font-size:16px}
</style></head><body>
${SEALS.map((s) => `<div class="c${s.two ? ' two' : ''}" id="${s.k}">${one(50, s.w)}${s.two ? one(20, 'live passes', 'b') : ''}</div>`).join('\n')}
</body></html>`;
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 400, height: 1200 }, deviceScaleFactor: 2 });
  await pg.setContent(html, { waitUntil: 'networkidle' });
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(400);
  for (const s of SEALS) await pg.locator(`#${s.k}`).screenshot({ path: path.join(out, `seal-${s.k}.png`), omitBackground: true });
  await b.close();
})();
