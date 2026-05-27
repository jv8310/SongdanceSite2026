// Helpers used by the /admin/intakes views to keep the page templates lean.
// All input here is treated as untrusted (markdown comes from Claude, payload
// from the deelnemer) — every string is HTML-escaped before being woven into
// rendered output.

import { STEPS, type StepDef } from './steps';
import { STEP_COPY } from './copy';

export interface IntakeRow {
  id: string;
  event_code: string;
  locale: 'nl' | 'en' | string;
  email: string;
  full_name: string | null;
  payload_json: string;
  assessment_md: string | null;
  classification: string | null;
  assessment_error: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export function pillClassFor(classification: string | null | undefined): string {
  switch ((classification ?? '').toUpperCase()) {
    case 'VEILIG': return 'adm-pill--class-veilig';
    case 'NEEDS A CALL': return 'adm-pill--class-call';
    case 'FURTHER INVESTIGATION NEEDED': return 'adm-pill--class-investigate';
    case 'RED FLAG': return 'adm-pill--class-red';
    default: return 'adm-pill--class-none';
  }
}

export function classificationLabel(classification: string | null | undefined): string {
  if (!classification) return 'No assessment';
  return classification;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Tiny markdown → HTML renderer for the assessment.
// Handles only the constructs the system prompt actually produces:
// ## h2, ### h3, **bold**, *italic*, paragraphs, "- " bullet lists.
// Everything is escaped before structural tags are added back.
export function renderAssessmentMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const flushList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  let paragraphBuf: string[] = [];
  const flushPara = () => {
    if (paragraphBuf.length === 0) return;
    const text = paragraphBuf.join(' ').trim();
    if (text) out.push(`<p>${inlineFormat(text)}</p>`);
    paragraphBuf = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      flushPara(); flushList();
      out.push(`<h2>${inlineFormat(h2[1]!)}</h2>`);
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      flushPara(); flushList();
      out.push(`<h3>${inlineFormat(h3[1]!)}</h3>`);
      continue;
    }
    const li = /^[-*]\s+(.+)$/.exec(line);
    if (li) {
      flushPara();
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineFormat(li[1]!)}</li>`);
      continue;
    }
    flushList();
    paragraphBuf.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}

// Pull the "### Korte samenvatting" block out of an assessment, so the
// admin detail page can foreground it at the top. Returns the text
// (without the heading) up to the next heading, trimmed.
export function extractSummary(md: string | null | undefined): string {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    if (/^###\s+Korte\s+samenvatting/i.test(lines[i]!)) {
      i++;
      const out: string[] = [];
      while (i < lines.length && !/^#{1,6}\s+/.test(lines[i]!)) {
        out.push(lines[i]!);
        i++;
      }
      return out.join('\n').trim();
    }
    i++;
  }
  return '';
}

function inlineFormat(s: string): string {
  // Escape first, then re-inject markup for **bold** and *italic*.
  let h = escapeHtml(s);
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return h;
}

// Translate one stored answer back to a human-readable string, using the
// NL labels so it matches what Jacob sees in the email assessment.
export function renderAnswer(step: StepDef, value: unknown): string {
  if (value === undefined || value === null) return '—';
  const labels = STEP_COPY.nl[step.key]?.options;
  switch (step.type) {
    case 'text':
    case 'email':
    case 'number':
    case 'textarea':
      return typeof value === 'string' && value.trim() ? value.trim() : '—';
    case 'radio':
      if (typeof value !== 'string' || !value) return '—';
      return labels?.[value] ?? value;
    case 'checkboxes':
      if (!Array.isArray(value) || value.length === 0) return '—';
      return value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => labels?.[v] ?? v)
        .join(', ');
    case 'consent': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return '—';
      const map = value as Record<string, boolean>;
      const checked = Object.entries(map)
        .filter(([, v]) => v === true)
        .map(([k]) => k);
      if (checked.length === 0) return '—';
      return checked.join(', ');
    }
    default:
      return '—';
  }
}

export interface QAItem {
  question: string;
  answer: string;
}

// Build the same ordered Q→A list the assessor email uses, for the
// admin detail page.
export function buildQAList(payload: Record<string, unknown>): QAItem[] {
  const out: QAItem[] = [];
  for (const step of STEPS) {
    if (step.type === 'intro' || step.type === 'pause' || step.type === 'closing') continue;
    const nl = STEP_COPY.nl[step.key];
    const heading = nl?.title ?? step.key;
    out.push({
      question: heading,
      answer: renderAnswer(step, payload[step.key]),
    });
  }
  return out;
}
