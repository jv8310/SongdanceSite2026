// Sound visuals for the site, ported from the masterclass deck (November 2026).
//
// One script drives every <canvas data-sd-wave="…"> on a page:
//   - colours come from CSS custom properties on the canvas (--wave-stroke,
//     --wave-accent, --wave-rule, --wave-glow; set in site.css), so a wave sits
//     on paper, plum or night without touching this file
//   - a canvas only animates while it is on screen (IntersectionObserver)
//   - one shared requestAnimationFrame loop; it stops when nothing is visible
//     or the tab is hidden, so an off-screen page runs at 0 frames a second
//   - prefers-reduced-motion: one still frame, no loop
// No dependencies (deliberately no GSAP: only the homepage loads it). Safe to
// import on any page; it does nothing without canvases. Astro bundles it once
// however many <SoundWave> components a page renders.
//
// The four feeling shapes follow copy book ch. 13 and ch. 17–20, and Jacob
// corrected them himself during the deck work: fear is a short, fast wave;
// grief long and round; anger sharp and moving forward (arrow to the right);
// pain sharp but contained around one point (arrows pointing in). Do not
// restyle them without him.

type ShapeFn = (u: number, h: number, t: number) => number;

interface WaveCanvas extends HTMLCanvasElement {
  _w?: number;
  _h?: number;
  _dpr?: number;
  _col?: Colours;
}

interface Colours {
  stroke: string;
  accent: string;
  rule: string;
  glow: string;
}

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const STILL_T = 1.4; // the frame shown when motion is off

const frac = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// y-position of each wave at horizontal position u (0..1), height h, time t (s).
const SHAPES: Record<string, ShapeFn> = {
  // Fear — the short wave: a fast tremble.
  fear(u, h, t) {
    const trem = 0.6 + 0.4 * Math.sin(u * 24 - t * 14);
    return h / 2 + h * 0.32 * trem * Math.sin(u * 72 - t * 9);
  },
  // Grief — the river: long, round, rolling.
  grief(u, h, t) {
    return (
      h / 2 +
      h * 0.3 * Math.sin(u * Math.PI * 2.4 - t * 0.85) * (0.78 + 0.22 * Math.sin(u * Math.PI * 1.1 - t * 0.33))
    );
  },
  // Anger — the metallic edge: sharp, and it moves forward.
  anger(u, h, t) {
    const ph = frac(u * 8 - t * 1.6);
    const saw = ph < 0.82 ? ph / 0.82 : (1 - ph) / 0.18;
    return h / 2 + h * (0.19 + 0.13 * u) * (saw * 2 - 1) + h * 0.014 * Math.sin(u * 420 + t * 34);
  },
  // Pain — the signal: sharp but contained, centred on one point.
  pain(u, h, t) {
    const d = Math.abs(u - 0.5);
    const env = Math.exp(-Math.pow(d / 0.16, 2));
    const ph = frac(d * 20 + t * 1.2);
    const saw = ph < 0.82 ? ph / 0.82 : (1 - ph) / 0.18;
    return h / 2 + h * 0.27 * env * (saw * 2 - 1) + h * 0.012 * env * Math.sin(u * 420 + t * 30);
  },
  // One sustained tone.
  tone(u, h, t) {
    const env = clamp01(Math.min(u / 0.06, (1 - u) / 0.06));
    return h / 2 + h * (0.27 + 0.04 * Math.sin(t * 1.4)) * env * Math.sin(u * 2 * Math.PI * 7 - t * 5);
  },
  // A scream: clipped and chaotic.
  scream(u, h, t) {
    const n =
      Math.sin(u * 173 + t * 31) * 0.5 +
      Math.sin(u * 311 - t * 47) * 0.3 +
      Math.sin(u * 97 + t * 13) * 0.25 +
      Math.sin(u * 523 + t * 71) * 0.2;
    const v = Math.max(-0.34, Math.min(0.34, n * 0.62 * (0.75 + 0.25 * Math.sin(u * 4 + t * 2))));
    return h / 2 + h * v;
  },
  // A song: it glides after a melody.
  song(u, h, t) {
    return h / 2 + h * 0.27 * Math.sin(2 * Math.PI * (6 * u - 0.42 * Math.cos(u * 6.3 + t * 0.5)) - t * 7);
  },
  // Breath alone: faint and noisy.
  breath(u, h, t) {
    const n =
      Math.sin(u * 391 + t * 53) * 0.5 + Math.sin(u * 617 - t * 67) * 0.35 + Math.sin(u * 233 + t * 29) * 0.3;
    return h / 2 + h * 0.1 * Math.sin(Math.PI * u) * n;
  },
};

// "The tail": an even tone that wavers in the last part of the breath (ch. 11).
const TAIL_SPLIT = 0.72;
const tailY: ShapeFn = (u, h, t) => {
  const start = Math.min(1, u / 0.05);
  const end = clamp01((0.985 - u) / 0.03);
  const base = 0.16 * Math.sin(u * 70 - t * 5);
  const k = Math.max(0, (u - TAIL_SPLIT) / (1 - TAIL_SPLIT));
  const tail = k * (0.22 + 0.16 * Math.sin(t * 2.1)) * Math.sin(u * 150 - t * 9) * (1 + 0.5 * Math.sin(u * 40 + t * 3));
  return h / 2 + h * (base * (1 - k * 0.5) + tail) * start * end;
};

function colours(c: HTMLCanvasElement): Colours {
  const cs = getComputedStyle(c);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    stroke: v('--wave-stroke', '#2A1B2A'),
    accent: v('--wave-accent', '#C9603A'),
    rule: v('--wave-rule', 'rgba(42,27,42,.14)'),
    glow: v('--wave-glow', 'transparent'),
  };
}

function size(c: WaveCanvas) {
  const r = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.max(1, Math.round(r.width * dpr));
  c.height = Math.max(1, Math.round(r.height * dpr));
  c._w = r.width;
  c._h = r.height;
  c._dpr = dpr;
  c._col = colours(c);
}

function path(ctx: CanvasRenderingContext2D, fn: ShapeFn, w: number, h: number, t: number, from = 0, to = 1) {
  const steps = Math.ceil(w);
  const first = Math.floor(steps * from);
  ctx.beginPath();
  for (let i = first; i <= Math.ceil(steps * to); i++) {
    const y = fn(i / steps, h, t);
    if (i === first) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.stroke();
}

function draw(c: WaveCanvas, t: number) {
  const w = c._w;
  const h = c._h;
  const col = c._col;
  if (!w || !h || !col) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const kind = c.dataset.sdWave || '';
  ctx.setTransform(c._dpr || 1, 0, 0, c._dpr || 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // centre rule
  ctx.strokeStyle = col.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  if (kind === 'tail') {
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth = Math.max(1.6, w / 420);
    path(ctx, tailY, w, h, t, 0, TAIL_SPLIT);
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = Math.max(2, w / 340);
    path(ctx, tailY, w, h, t, TAIL_SPLIT, 1);
    return;
  }

  const fn = SHAPES[kind];
  if (!fn) return;
  // anger and pain carry the ember accent; the rest use the theme's stroke
  const hot = kind === 'anger' || kind === 'pain';
  ctx.strokeStyle = hot ? col.accent : col.stroke;
  ctx.lineWidth = Math.max(1.4, Math.min(3, w / 220));
  ctx.shadowColor = col.glow;
  ctx.shadowBlur = col.glow === 'transparent' ? 0 : 8;
  path(ctx, fn, w, h, t);
  ctx.shadowBlur = 0;

  // direction of the energy: anger moves forward, pain draws in to one point
  const arrow = (x1: number, x2: number) => {
    const y = h - 4;
    const a = 6 * (x2 > x1 ? 1 : -1);
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.moveTo(x2 - a, y - 4);
    ctx.lineTo(x2, y);
    ctx.lineTo(x2 - a, y + 4);
    ctx.stroke();
  };
  ctx.strokeStyle = col.accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;
  if (kind === 'anger') arrow(w * 0.62, w * 0.96);
  if (kind === 'pain') {
    arrow(w * 0.06, w * 0.3);
    arrow(w * 0.94, w * 0.7);
  }
  ctx.globalAlpha = 1;
}

const all = Array.from(document.querySelectorAll<WaveCanvas>('canvas[data-sd-wave]'));
const visible = new Set<WaveCanvas>();
let raf = 0;

function loop(ts: number) {
  raf = 0;
  if (!visible.size || document.hidden) return;
  visible.forEach((c) => draw(c, ts / 1000));
  raf = requestAnimationFrame(loop);
}
function kick() {
  if (!raf && !REDUCE && visible.size && !document.hidden) raf = requestAnimationFrame(loop);
}

if (all.length) {
  const resize = () =>
    all.forEach((c) => {
      size(c);
      if (REDUCE || !visible.has(c)) draw(c, STILL_T);
    });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(resize);
    all.forEach((c) => ro.observe(c));
  } else {
    window.addEventListener('resize', resize, { passive: true });
  }
  resize();
  // Fonts or a late stylesheet can change a canvas's box or colours after
  // first paint; take the measurements again once everything has loaded.
  window.addEventListener('load', resize, { once: true });

  if (!REDUCE && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          const c = e.target as WaveCanvas;
          if (e.isIntersecting) visible.add(c);
          else visible.delete(c);
        });
        kick();
      },
      { rootMargin: '80px 0px' },
    );
    all.forEach((c) => io.observe(c));
    document.addEventListener('visibilitychange', kick);
  }
}
