// A dependency-free animated countdown GIF, rendered on the edge.
//
// Why hand-rolled: the site self-hosts its media and avoids third-party
// dependencies, so rather than reach for an external countdown-timer image
// service we encode a tiny GIF89a ourselves. The whole thing is one small file:
// a minimal GIF encoder (LZW, the GIF variant), a 5×7 bitmap font for the
// digits, and a frame renderer that ticks a HH:MM:SS clock down second by
// second. Served from /api/countdown.gif, embedded in the last-chance email.
//
// Honesty by design: the 12-week participant discount window is at most 48h, so
// the remaining time always fits HH:MM:SS (hours 00–47) — no day field, no
// ambiguity. The animation plays once and freezes (no looping countdown that
// secretly resets), and the email's text states the real deadline anyway, so
// even with images off — or proxied/cached by Gmail — the urgency is true. The
// GIF is the flourish, not the source of truth.
//
// Palette is 4 colours (parchment bg, plum ink, ember, muted), so the global
// colour table is the smallest GIF allows and the files stay light.

// The clock is drawn as smooth, anti-aliased seven-segment digits rather than a
// blocky pixel font: each lit segment is a rounded capsule rasterised from a
// signed-distance field, and edges are feathered across a small colour ramp so
// the numerals read clean and intentional (a designed timer, not dot-matrix).
//
// The palette is that ramp: index 0 is the parchment background, then a
// background→ink gradient for the digits and a background→ember gradient for the
// colons + baseline. The in-between shades are the anti-aliasing.
const BG: [number, number, number] = [251, 246, 236]; // #FBF6EC parchment
const INK: [number, number, number] = [42, 27, 42]; // #2A1B2A plum-ink
const EMBER: [number, number, number] = [161, 72, 38]; // #A14826 terracotta

const RAMP_STEPS = 12;
function buildRamp(
  from: [number, number, number],
  to: [number, number, number],
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 1; i <= RAMP_STEPS; i++) {
    const t = i / RAMP_STEPS;
    out.push([
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    ]);
  }
  return out;
}

const INK_BASE = 1; // ink ramp occupies indices [1 .. RAMP_STEPS]
const EMBER_BASE = 1 + RAMP_STEPS; // ember ramp follows it

// index 0 = background, then the ink ramp, then the ember ramp.
export const COUNTDOWN_PALETTE: Array<[number, number, number]> = [
  BG,
  ...buildRamp(BG, INK),
  ...buildRamp(BG, EMBER),
];

// Coverage (0..1) → palette index within one of the two ramps.
function rampIndex(coverage: number, base: number): number {
  if (coverage <= 0) return 0;
  const step = Math.min(RAMP_STEPS, Math.max(1, Math.round(coverage * RAMP_STEPS)));
  return base + step - 1;
}

// Seven-segment map per digit (segments a,b,c,d,e,f,g):
//    aaa
//   f   b
//    ggg
//   e   c
//    ddd
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgecd',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

// Geometry of one digit cell (W×H) — each segment is a line painted with a
// rounded pen of radius t/2; ends are pulled back from the junctions so the
// corners read as separate strokes.
function digitGeometry(W: number, H: number, t: number): Record<string, [number, number, number, number]> {
  const r = t / 2;
  const m = r + 2; // margin from the cell edge
  const midY = H / 2;
  const inset = r + 1.5; // pull segment ends back from the corners
  const L = m;
  const R = W - m;
  const T = m;
  const B = H - m;
  return {
    a: [L + inset, T, R - inset, T],
    b: [R, T + inset, R, midY - inset],
    c: [R, midY + inset, R, B - inset],
    d: [L + inset, B, R - inset, B],
    e: [L, midY + inset, L, B - inset],
    f: [L, T + inset, L, midY - inset],
    g: [L + inset, midY, R - inset, midY],
  };
}

// Distance from a point to a line segment — the core of the rounded-capsule SDF.
function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export type CountdownLayout = {
  digitW: number; // digit cell width
  digitH: number; // digit cell height
  colonW: number; // colon cell width
  gap: number; // horizontal gap between glyphs
  thickness: number; // segment / pen thickness
  padX: number;
  padY: number;
  width: number;
  height: number;
  glyphTop: number;
  baselineY: number;
  cells: Array<{ kind: 'digit' | 'colon'; x: number; w: number }>;
};

// Lay out the eight glyphs of "HH:MM:SS" and size the canvas around them.
function layoutFor(digitW: number, digitH: number, thickness: number): CountdownLayout {
  const colonW = Math.round(digitW * 0.58);
  const gap = 6;
  const padX = 26;
  const padY = 22;
  const order: Array<'digit' | 'colon'> = [
    'digit',
    'digit',
    'colon',
    'digit',
    'digit',
    'colon',
    'digit',
    'digit',
  ];
  const cells: CountdownLayout['cells'] = [];
  let x = padX;
  for (const kind of order) {
    const w = kind === 'colon' ? colonW : digitW;
    cells.push({ kind, x, w });
    x += w + gap;
  }
  const width = x - gap + padX;
  const glyphTop = padY;
  const baselineY = glyphTop + digitH + 12;
  const height = baselineY + 12 + padY;
  return {
    digitW,
    digitH,
    colonW,
    gap,
    thickness,
    padX,
    padY,
    width,
    height,
    glyphTop,
    baselineY,
    cells,
  };
}

export const DEFAULT_LAYOUT = layoutFor(38, 74, 8); // ~366×140

function clampSeconds(totalSec: number): number {
  if (!Number.isFinite(totalSec) || totalSec < 0) return 0;
  // Never show a misleading huge clock: cap at 47:59:59 (the window is ≤48h).
  return Math.min(totalSec, 47 * 3600 + 59 * 60 + 59);
}

export function formatClock(totalSec: number): string {
  const s = clampSeconds(Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

// Paint one HH:MM:SS frame into a fresh index buffer (one byte per pixel, the
// palette index). Digits in the ink ramp, colons + baseline in the ember ramp,
// edges anti-aliased across each ramp.
function renderFrame(totalSec: number, layout: CountdownLayout): Uint8Array {
  const { width, height, digitW: W, digitH: H, thickness: t, glyphTop } = layout;
  const buf = new Uint8Array(width * height); // 0 = background everywhere
  const text = formatClock(totalSec);
  const r = t / 2;
  const feather = 1.4; // edge softness in pixels

  // Keep the strongest coverage where strokes overlap.
  const put = (px: number, py: number, idx: number) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    if (idx > buf[py * width + px]) buf[py * width + px] = idx;
  };

  const geo = digitGeometry(W, H, t);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const cell = layout.cells[i];
    if (!cell) continue;

    if (ch === ':') {
      const cx = cell.x + cell.w / 2;
      const dotR = t * 0.6;
      for (const cy of [glyphTop + H * 0.36, glyphTop + H * 0.66]) {
        const x0 = Math.floor(cx - dotR - 2);
        const x1 = Math.ceil(cx + dotR + 2);
        const y0 = Math.floor(cy - dotR - 2);
        const y1 = Math.ceil(cy + dotR + 2);
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
            const cov = Math.max(0, Math.min(1, (dotR + 0.5 - d) / feather));
            if (cov > 0) put(x, y, rampIndex(cov, EMBER_BASE));
          }
        }
      }
      continue;
    }

    const segs = SEGMENTS[ch];
    if (!segs) continue;
    const ox = cell.x;
    const oy = glyphTop;
    for (let y = -1; y <= H + 1; y++) {
      for (let x = -1; x <= W + 1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let best = 0;
        for (const s of segs) {
          const seg = geo[s];
          const d = distToSegment(px, py, seg[0], seg[1], seg[2], seg[3]);
          const cov = Math.max(0, Math.min(1, (r + 0.5 - d) / feather));
          if (cov > best) best = cov;
        }
        if (best > 0) put(ox + x, oy + y, rampIndex(best, INK_BASE));
      }
    }
  }

  // A soft ember baseline under the clock — a small designed touch, rounded ends.
  const bx0 = layout.padX;
  const bx1 = width - layout.padX;
  const by = layout.baselineY;
  const bt = 5;
  const br = bt / 2;
  for (let y = by - bt; y <= by + bt; y++) {
    for (let x = bx0 - bt; x <= bx1 + bt; x++) {
      const d = distToSegment(x + 0.5, y + 0.5, bx0 + br, by, bx1 - br, by);
      const cov = Math.max(0, Math.min(1, (br + 0.5 - d) / feather));
      if (cov > 0) put(x, y, rampIndex(cov, EMBER_BASE));
    }
  }

  return buf;
}

// ── Minimal GIF89a encoder ──────────────────────────────────────────────────
// LZW compression in the GIF variable-width-code variant, packed into ≤255-byte
// sub-blocks. Standard and well-trodden; kept compact and allocation-light.

class ByteWriter {
  private chunks: number[] = [];
  byte(b: number) {
    this.chunks.push(b & 0xff);
  }
  bytes(arr: number[] | Uint8Array) {
    for (const b of arr) this.chunks.push(b & 0xff);
  }
  short(n: number) {
    this.chunks.push(n & 0xff, (n >> 8) & 0xff); // little-endian
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.chunks.push(s.charCodeAt(i) & 0xff);
  }
  toUint8(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

// LZW-encode one frame's index stream into GIF sub-blocks, appended to `out`.
function lzwEncode(out: ByteWriter, indices: Uint8Array, minCodeSize: number) {
  out.byte(minCodeSize);

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  let dict = new Map<string, number>();
  const resetDict = () => {
    dict = new Map();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };

  // Bit accumulator → bytes → 255-byte sub-blocks.
  let bitBuf = 0;
  let bitCount = 0;
  let block: number[] = [];
  const flushBlock = () => {
    if (block.length === 0) return;
    out.byte(block.length);
    out.bytes(block);
    block = [];
  };
  const emit = (code: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCount -= 8;
      if (block.length === 255) flushBlock();
    }
  };

  emit(clearCode);

  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const combined = prefix + ',' + k;
    if (dict.has(combined)) {
      prefix = combined;
    } else {
      emit(codeFor(prefix));
      dict.set(combined, nextCode);
      nextCode++;
      if (nextCode > 1 << codeSize && codeSize < 12) {
        codeSize++;
      } else if (nextCode > 4095) {
        emit(clearCode);
        resetDict();
      }
      prefix = String(k);
    }
  }
  emit(codeFor(prefix));
  emit(eoiCode);

  // flush remaining bits
  if (bitCount > 0) {
    block.push(bitBuf & 0xff);
    if (block.length === 255) flushBlock();
  }
  flushBlock();
  out.byte(0); // block terminator

  // A code is either a raw single index (< clearCode) or a dictionary entry.
  function codeFor(seq: string): number {
    if (dict.has(seq)) return dict.get(seq)!;
    // single-index sequences map to themselves
    const asInt = Number(seq);
    return asInt;
  }
}

export type GifSpec = {
  width: number;
  height: number;
  palette: Array<[number, number, number]>;
  frames: Uint8Array[]; // each length width*height, palette indices
  delayCs: number; // per-frame delay in centiseconds (1/100 s)
  loop?: boolean; // default false — play once and freeze
};

export function encodeGif(spec: GifSpec): Uint8Array {
  const { width, height, palette, frames, delayCs } = spec;
  const w = new ByteWriter();

  // Header
  w.ascii('GIF89a');

  // Global colour table size: smallest power-of-two ≥ palette length.
  let gctBits = 0;
  while (1 << (gctBits + 1) < palette.length) gctBits++;
  const gctSize = 1 << (gctBits + 1);
  const minCodeSize = Math.max(2, gctBits + 1);

  // Logical Screen Descriptor
  w.short(width);
  w.short(height);
  w.byte(0x80 | (gctBits << 4) | gctBits); // GCT present, colour res, GCT size
  w.byte(0); // background colour index
  w.byte(0); // pixel aspect ratio

  // Global Colour Table (padded to gctSize)
  for (let i = 0; i < gctSize; i++) {
    const c = palette[i] ?? [0, 0, 0];
    w.byte(c[0]);
    w.byte(c[1]);
    w.byte(c[2]);
  }

  // Looping: only emit the NETSCAPE extension when we actually want a loop.
  // Omitting it means a single play (then freeze) in virtually every decoder.
  if (spec.loop) {
    w.byte(0x21);
    w.byte(0xff);
    w.byte(0x0b);
    w.ascii('NETSCAPE2.0');
    w.byte(0x03);
    w.byte(0x01);
    w.short(0); // 0 = loop forever
    w.byte(0);
  }

  for (const frame of frames) {
    // Graphic Control Extension (delay; no transparency)
    w.byte(0x21);
    w.byte(0xf9);
    w.byte(0x04);
    w.byte(0x04); // disposal = 2 (restore to background); no transparency
    w.short(delayCs);
    w.byte(0); // transparent colour index (unused)
    w.byte(0);

    // Image Descriptor
    w.byte(0x2c);
    w.short(0); // left
    w.short(0); // top
    w.short(width);
    w.short(height);
    w.byte(0); // no local colour table

    // Image data
    lzwEncode(w, frame, minCodeSize);
  }

  w.byte(0x3b); // trailer
  return w.toUint8();
}

// ── The countdown ───────────────────────────────────────────────────────────

export type CountdownOptions = {
  deadlineMs: number;
  nowMs: number;
  frames?: number; // how many one-second ticks to animate (default 60)
  layout?: CountdownLayout;
};

// Build the animated countdown GIF: `frames` one-second ticks starting from the
// time remaining at render, then it stops on the last frame. If the deadline is
// already past, a single static 00:00:00 frame.
export function countdownGif(opts: CountdownOptions): Uint8Array {
  const layout = opts.layout ?? DEFAULT_LAYOUT;
  const frameCount = Math.max(1, opts.frames ?? 60);
  const remainingSec = Math.floor((opts.deadlineMs - opts.nowMs) / 1000);

  const frames: Uint8Array[] = [];
  if (remainingSec <= 0) {
    frames.push(renderFrame(0, layout));
  } else {
    for (let i = 0; i < frameCount; i++) {
      frames.push(renderFrame(remainingSec - i, layout));
    }
  }

  return encodeGif({
    width: layout.width,
    height: layout.height,
    palette: COUNTDOWN_PALETTE,
    frames,
    delayCs: 100, // 1.00s per tick
    loop: false,
  });
}
