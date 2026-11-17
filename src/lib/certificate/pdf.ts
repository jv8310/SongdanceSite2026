// One JPEG as a one-page PDF (A4 landscape), written by hand: the certificate
// is drawn by the browser (src/lib/certificate/svg.ts), and a PDF that holds
// that picture needs six small objects, not a library. The JPEG goes in as it
// is (DCTDecode), so nothing is recompressed.

const A4_LANDSCAPE = { w: 841.89, h: 595.28 }; // points

export function jpegToPdf(jpeg: Uint8Array, widthPx: number, heightPx: number, title: string): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push('stream\n');
      push(stream);
      push('\nendstream\n');
    }
    push('endobj\n');
  };
  // A PDF string in UTF-16BE, so a name with accents reads right in the title.
  const pdfText = (s: string) => {
    let hex = 'FEFF';
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return `<${hex}>`;
  };
  const content = enc.encode(`q ${A4_LANDSCAPE.w} 0 0 ${A4_LANDSCAPE.h} 0 0 cm /Im0 Do Q`);

  push('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_LANDSCAPE.w} ${A4_LANDSCAPE.h}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  object(4, `<< /Length ${content.length} >>`, content);
  object(
    5,
    `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  );
  object(6, `<< /Title ${pdfText(title)} /Author ${pdfText('Songdance')} /Creator ${pdfText('songdance.co')} >>`);
  const xref = length;
  push(`xref\n0 7\n0000000000 65535 f \n${[1, 2, 3, 4, 5, 6].map((i) => `${String(offsets[i]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
