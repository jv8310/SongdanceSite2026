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

export const COUNTDOWN_PALETTE: Array<[number, number, number]> = [
  [251, 246, 236], // 0 — panel background (#FBF6EC)
  [42, 27, 42], // 1 — ink, the digits (#2A1B2A)
  [161, 72, 38], // 2 — ember, the colons + baseline (#A14826)
  [122, 106, 120], // 3 — muted (#7A6A78), reserved
];

// 5×7 glyphs for the digits and the colon. Each glyph is seven rows of five
// bits; a set bit paints a pixel. Only what a HH:MM:SS clock needs.
const FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['00000', '00000', '00100', '00000', '00100', '00000', '00000'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

export type CountdownLayout = {
  scale: number; // pixel size of one font bit
  gap: number; // horizontal gap between glyphs, in pixels
  width: number;
  height: number;
};

// A clock string is always 8 chars: "HH:MM:SS".
function layoutFor(scale: number, gap: number): CountdownLayout {
  const chars = 8;
  const blockW = chars * GLYPH_W * scale + (chars - 1) * gap;
  const blockH = GLYPH_H * scale;
  return {
    scale,
    gap,
    width: blockW + 2 * (6 * scale), // side padding
    height: blockH + 2 * (4 * scale), // top/bottom padding (+ room for baseline)
  };
}

export const DEFAULT_LAYOUT = layoutFor(6, 6); // 360×96-ish, crisp at retina

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
// palette index). Digits in ink, colons + a thin baseline in ember.
function renderFrame(totalSec: number, layout: CountdownLayout): Uint8Array {
  const { width, height, scale, gap } = layout;
  const buf = new Uint8Array(width * height); // 0 = background everywhere
  const text = formatClock(totalSec);

  const blockW = 8 * GLYPH_W * scale + 7 * gap;
  const blockH = GLYPH_H * scale;
  let x = Math.floor((width - blockW) / 2);
  const y0 = Math.floor((height - blockH) / 2);

  const put = (px: number, py: number, color: number) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    buf[py * width + px] = color;
  };

  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[':'];
    const color = ch === ':' ? 2 : 1; // colon ember, digits ink
    for (let row = 0; row < GLYPH_H; row++) {
      const bits = glyph[row];
      for (let col = 0; col < GLYPH_W; col++) {
        if (bits[col] !== '1') continue;
        // scale up each bit into a scale×scale block
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            put(x + col * scale + dx, y0 + row * scale + dy, color);
          }
        }
      }
    }
    x += GLYPH_W * scale + gap;
  }

  // A thin ember baseline under the clock — a small designed touch.
  const baseY = y0 + blockH + Math.max(2, Math.floor(scale / 2));
  const baseThick = Math.max(2, Math.floor(scale / 3));
  const baseX0 = Math.floor((width - blockW) / 2);
  for (let t = 0; t < baseThick; t++) {
    for (let bx = baseX0; bx < baseX0 + blockW; bx++) put(bx, baseY + t, 2);
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
