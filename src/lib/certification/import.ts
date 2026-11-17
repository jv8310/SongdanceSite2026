// The old Google Form's answers, read from its Google Sheet: pasted straight
// from the sheet (tab-separated) or uploaded as the sheet's CSV download
// (File → Download → Comma-separated values). Pure: text in, rows out.
//
// The sheet's columns are found by their headers, in any order:
//   (no header)   Jacob's own note in the first column ("ELDER", "granted like that")
//   Tijdstempel / Timestamp   d-m-yyyy H:mm:ss, on Brussels' clock
//   First name · Last name · Email
//   I have joined all live classes or watched the replays
//   Provide YouTube link (option 2)
//   Is there anyway I could improve this course? …
//   Testimonial
//   Other comments or questions related to your certification?
// A row with no address is a note between rows ("FROM HERE SVH instead of
// VSH"): it is reported, never imported.

export type ImportedCertRow = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  classes_confirmed: boolean;
  video_url: string | null;
  course_feedback: string | null;
  testimonial: string | null;
  comments: string | null;
  admin_note: string | null;
  submitted_at: string | null; // ISO instant; null when the sheet's time could not be read
  import_key: string;
};

export type CertImportParse = {
  rows: ImportedCertRow[];
  skipped: Array<{ line: number; reason: string; text: string }>;
  problem: string | null;
};

/** Delimited text → cells. Quoted cells may hold the delimiter, line breaks and "" for a quote. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n', 1)[0] ?? '';
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

// The minutes Brussels is ahead of UTC at a given instant.
function brusselsOffsetMin(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** "27-3-2024 18:23:28" (or with slashes, or yyyy-mm-dd) on Brussels' clock → an ISO instant. */
export function sheetTimeToIso(raw: string): string | null {
  const v = raw.trim();
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  let y: number, mo: number, d: number;
  if (m) {
    d = Number(m[1]);
    mo = Number(m[2]);
    y = Number(m[3]);
  } else {
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
    if (!m) return null;
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  }
  const h = Number(m[4] ?? 12);
  const mi = Number(m[5] ?? 0);
  const s = Number(m[6] ?? 0);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const guess = new Date(wall - brusselsOffsetMin(new Date(wall)) * 60_000);
  return new Date(wall - brusselsOffsetMin(guess) * 60_000).toISOString();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function columnOf(headers: string[], ...needles: RegExp[]): number {
  for (const re of needles) {
    const i = headers.findIndex((h) => re.test(h));
    if (i !== -1) return i;
  }
  return -1;
}

export function parseCertImport(text: string): CertImportParse {
  const table = parseDelimited(text).filter((r) => r.some((c) => c.trim()));
  if (table.length < 2) return { rows: [], skipped: [], problem: 'Nothing to import: paste the sheet with its header row, or choose its CSV file.' };
  const headers: string[] = table[0]!.map((h) => h.trim().toLowerCase());
  // A paste that lost the header row's leading empty cell (the note column has no header).
  if (!headers.includes('') && table.slice(1).filter((r) => r.length === headers.length + 1).length > (table.length - 1) / 2) headers.unshift('');
  const col = {
    time: columnOf(headers, /^tijdstempel$/, /^timestamp$/, /tijd|time/),
    first: columnOf(headers, /^first name/, /voornaam/),
    last: columnOf(headers, /^last name/, /achternaam/),
    email: columnOf(headers, /^e-?mail/),
    classes: columnOf(headers, /joined all live classes/, /classes/),
    video: columnOf(headers, /youtube/, /video/),
    feedback: columnOf(headers, /improve this course/, /feedback/),
    testimonial: columnOf(headers, /^testimonial/),
    comments: columnOf(headers, /other comments/, /comments/),
    note: headers.findIndex((h) => h === ''),
  };
  if (col.email === -1) return { rows: [], skipped: [], problem: 'No "Email" column found. Include the sheet\'s header row.' };

  const rows: ImportedCertRow[] = [];
  const skipped: CertImportParse['skipped'] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((r, i) => {
    const at = (c: number) => (c === -1 ? '' : (r[c] ?? '').trim());
    const line = i + 2;
    const email = at(col.email).toLowerCase();
    if (!email) {
      skipped.push({ line, reason: 'no address (a note between rows)', text: r.filter((c) => c.trim()).join(' · ').slice(0, 140) });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      skipped.push({ line, reason: 'not an email address', text: email.slice(0, 140) });
      return;
    }
    const rawTime = at(col.time);
    const submitted = rawTime ? sheetTimeToIso(rawTime) : null;
    const key = `gform:${submitted ?? rawTime ?? ''}|${email}`;
    if (seen.has(key)) {
      skipped.push({ line, reason: 'the same row twice', text: email });
      return;
    }
    seen.add(key);
    rows.push({
      email,
      first_name: at(col.first) || null,
      last_name: at(col.last) || null,
      classes_confirmed: /^y/i.test(at(col.classes)),
      video_url: at(col.video) || null,
      course_feedback: at(col.feedback) || null,
      testimonial: at(col.testimonial) || null,
      comments: at(col.comments) || null,
      admin_note: at(col.note) || null,
      submitted_at: submitted,
      import_key: key,
    });
  });
  return { rows, skipped, problem: rows.length ? null : 'No row with an email address was found.' };
}
