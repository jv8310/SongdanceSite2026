// The certificate maker in the admin's browser (src/lib/certificate/): shows
// the certificate while the form is filled in, and turns it into the PDF that
// rides along with the form.
//
// How the PDF is made: the certificate is one SVG with its fonts inside it; the
// browser draws it onto a canvas at print resolution (300 dpi, A4 landscape) and
// that picture becomes a one-page PDF. So what is previewed is exactly what is
// attached: the same drawing, by the same renderer. (The page is a picture: the
// text in it cannot be selected or searched.)

import { CERT_FONTS } from '../certificate/assets';
import { jpegToPdf } from '../certificate/pdf';
import { certificateFilename, certificateSvg, type CertInput, type NameMeasure } from '../certificate/svg';

const PDF_PX = { w: 3508, h: 2480 }; // A4 landscape at 300 dpi
const NAME_FONT = "italic 500 100px 'Cormorant Garamond'";

let fontsReady: Promise<void> | null = null;

// The certificate's fonts in the page itself, for measuring the name. (The SVG
// carries its own copies; a picture cannot use the page's.)
function loadFonts(): Promise<void> {
  fontsReady ??= (async () => {
    await Promise.all(
      CERT_FONTS.map(async (f) => {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        const face = new FontFace(f.family, bytes.buffer, { style: f.style, weight: String(f.weight) });
        document.fonts.add(await face.load());
      }),
    );
  })();
  return fontsReady;
}

async function nameMeasure(): Promise<NameMeasure> {
  await loadFonts();
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = NAME_FONT;
  return (name, sizeMm) => (ctx.measureText(name).width / 100) * sizeMm;
}

export async function buildCertificateSvg(input: CertInput): Promise<string> {
  return certificateSvg(input, await nameMeasure());
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The certificate could not be drawn.'));
    img.src = url;
  });
}

/** The certificate as a PDF file, ready to go into a form's file field. */
export async function buildCertificatePdf(input: CertInput): Promise<File> {
  const svg = await buildCertificateSvg(input);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    await img.decode().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = PDF_PX.w;
    canvas.height = PDF_PX.h;
    const ctx = canvas.getContext('2d')!;
    // Twice, a moment apart: Safari draws an SVG's own fonts only once it has
    // decoded them, which the first draw starts.
    ctx.drawImage(img, 0, 0, PDF_PX.w, PDF_PX.h);
    await new Promise((r) => setTimeout(r, 120));
    ctx.fillStyle = '#F4ECDF';
    ctx.fillRect(0, 0, PDF_PX.w, PDF_PX.h);
    ctx.drawImage(img, 0, 0, PDF_PX.w, PDF_PX.h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
    if (!blob) throw new Error('The certificate could not be turned into a picture.');
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const filename = certificateFilename(input.kind, input.name);
    const pdf = jpegToPdf(jpeg, PDF_PX.w, PDF_PX.h, filename.replace(/\.pdf$/, ''));
    return new File([pdf.buffer as ArrayBuffer], filename, { type: 'application/pdf' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "2026-11-17" → "17 November 2026", the way the certificate prints its date. */
export function certificateDate(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ── The maker on a form ─────────────────────────────────────────────────────
//
// A block marked [data-cert-maker] inside a form that has a file field named
// "certificate". "Make it here" builds the PDF on submit and puts it in that
// field, so the server gets a certificate exactly as if a file had been chosen.

export function initCertificateMakers(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-cert-maker]').forEach((box) => {
    const form = box.closest('form');
    const fileInput = form?.querySelector<HTMLInputElement>('input[type="file"][name="certificate"]');
    if (!form || !fileInput) return;
    const q = <T extends Element>(sel: string) => box.querySelector<T>(sel);
    const mode = () => box.querySelector<HTMLInputElement>('input[data-cert-mode]:checked')?.value ?? 'none';
    const nameEl = q<HTMLInputElement>('[data-cert-name]')!;
    const yearEl = q<HTMLInputElement>('[data-cert-year]')!;
    const dateEl = q<HTMLInputElement>('[data-cert-date]')!;
    const dayEl = form.querySelector<HTMLInputElement>('input[type="date"][name="on"]');
    const preview = q<HTMLImageElement>('[data-cert-preview]')!;
    const made = q<HTMLElement>('[data-cert-made]')!;
    const upload = q<HTMLElement>('[data-cert-upload]')!;
    const status = q<HTMLElement>('[data-cert-status]')!;
    const kind = (): CertInput['kind'] => (mode() === 'excellence' ? 'excellence' : 'completion');
    const input = (): CertInput => ({ kind: kind(), name: nameEl.value, date: dateEl.value, year: yearEl.value });
    const making = () => mode() === 'completion' || mode() === 'excellence';
    let dateTouched = false;
    let yearTouched = false;
    let previewUrl: string | null = null;
    let turn = 0;

    const paint = async () => {
      const m = mode();
      made.hidden = !making();
      upload.hidden = m !== 'upload';
      fileInput.required = m === 'upload' && fileInput.dataset.certRequired === '1';
      status.textContent = '';
      if (!making()) return;
      const mine = ++turn;
      try {
        const svg = await buildCertificateSvg(input());
        if (mine !== turn) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        preview.src = previewUrl;
      } catch (err) {
        status.textContent = String((err as Error)?.message ?? err);
      }
    };

    // The certificate's date and class year follow "Certified on" until they are typed over.
    const followDay = () => {
      if (!dayEl?.value) return;
      if (!dateTouched) dateEl.value = certificateDate(dayEl.value);
      if (!yearTouched) yearEl.value = dayEl.value.slice(0, 4);
    };
    dateEl.addEventListener('input', () => (dateTouched = true));
    yearEl.addEventListener('input', () => (yearTouched = true));
    dayEl?.addEventListener('input', () => {
      followDay();
      void paint();
    });
    box.addEventListener('input', () => void paint());
    box.addEventListener('change', () => void paint());

    q<HTMLButtonElement>('[data-cert-open]')?.addEventListener('click', async () => {
      status.textContent = 'Making the PDF…';
      try {
        const file = await buildCertificatePdf(input());
        window.open(URL.createObjectURL(file), '_blank', 'noopener');
        status.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB. This is the file they get.`;
      } catch (err) {
        status.textContent = String((err as Error)?.message ?? err);
      }
    });

    let ready = false;
    form.addEventListener('submit', (e) => {
      const m = mode();
      if (m === 'none') {
        fileInput.value = '';
        return;
      }
      if (!making() || ready) return;
      e.preventDefault();
      if (!nameEl.value.trim()) {
        status.textContent = 'The certificate needs a name.';
        nameEl.focus();
        return;
      }
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      if (submitter) submitter.disabled = true;
      status.textContent = 'Making the PDF…';
      buildCertificatePdf(input())
        .then((file) => {
          const dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
          ready = true;
          if (submitter) submitter.disabled = false;
          form.requestSubmit(submitter ?? undefined);
        })
        .catch((err) => {
          if (submitter) submitter.disabled = false;
          status.textContent = `${String((err as Error)?.message ?? err)} Nothing was sent. Try again, or choose "Upload a file".`;
        });
    });

    followDay();
    void paint();
  });
}
