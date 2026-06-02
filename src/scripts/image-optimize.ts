// Client-side image optimisation, shared by the events editor and the
// image-manager. Cloudflare Workers have no native image processing and this
// site has no `sharp`/WASM in the bundle, so we shrink + re-encode in the
// browser *before* upload: the file that reaches R2 is already small.
//
// Strategy:
//   * cap the longest edge at `maxDim` (never upscale),
//   * re-encode to WebP at `quality` (falls back to JPEG where the browser
//     can't export WebP — older Safari),
//   * keep the original instead if re-encoding wouldn't actually save bytes,
//     or if the source is something we shouldn't touch (SVG, GIF, alpha PNG
//     with no WebP support).
// Any failure falls back to the original file, so an upload never breaks.

export interface OptimizeOptions {
  maxDim?: number; // longest-edge cap in px (default 1600)
  quality?: number; // 0..1 for lossy encoders (default 0.82)
}

// Source types we re-encode. SVG (vector) and GIF (possibly animated) are
// passed through untouched.
const REENCODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAY_HAVE_ALPHA = new Set(['image/png', 'image/webp', 'image/avif']);

export async function optimizeImageFile(file: File, opts: OptimizeOptions = {}): Promise<File> {
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.82;

  if (!REENCODABLE.has(file.type)) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return file; // undecodable (e.g. HEIC) → upload as-is
  }

  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);

    // Prefer WebP; fall back to JPEG. If neither lossy format is available and
    // the source might be transparent, keep the original rather than flatten.
    let blob = await toBlob(canvas, 'image/webp', quality);
    if (!blob || blob.type !== 'image/webp') {
      if (MAY_HAVE_ALPHA.has(file.type)) return file;
      blob = await toBlob(canvas, 'image/jpeg', quality);
    }
    if (!blob) return file;

    // Don't bother if the original was already smaller (e.g. an already-tuned
    // small WebP, or a tiny image we didn't need to touch).
    if (blob.size >= file.size && scale === 1) return file;

    const ext = blob.type === 'image/webp' ? '.webp' : '.jpg';
    const base = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${base}${ext}`, { type: blob.type });
  } finally {
    bitmap.close?.();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  // Fallback path for browsers without createImageBitmap.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

// Replace a file <input>'s selection with a single file (used after we
// optimise a dropped/selected image), so the normal form submit uploads it.
export function setInputFile(input: HTMLInputElement, file: File): void {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
