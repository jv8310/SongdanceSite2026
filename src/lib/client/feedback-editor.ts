// The certification feedback editor on a person's page (/admin/people/<email>,
// App access → Certification): a plain textarea, a few buttons that write the
// marks for you, and a preview of how the member app will lay it out.
//
// The feedback is stored as plain text in the member app's own format, the one
// a lesson's text is written in (songdance-app: apps/app/src/lib/rich-text.ts,
// components/course/RichParagraphs.tsx). The app is what the member reads; this
// preview follows the same rules so what Jacob types is what they see:
//
//   paragraphs  a blank line between them; a single line break is kept
//   a heading   a line that is only **bold**, or starts with "## "
//   a list      lines starting with "- ", "• " or "1. "
//   inline      **bold**, *italic*, and web addresses, which become links
//
// Nothing else is read: no HTML, no [label](link) — an address is shown as it is.

type Fmt = 'bold' | 'italic' | 'heading' | 'list' | 'numbered';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ITEM = /^(\s*)(•|-|–|\*|\d{1,2}[.)])\s+(.*\S)\s*$/;
const BOLD_LINE = /^\*\*([^*\n]+)\*\*:?$/;
const HASH_HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
// The app's own inline reading (components/feed/FeedText.tsx MARKS): the text is
// split on **bold**, *italic* and bare web addresses, nothing else.
const TOKEN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|(?:https?:\/\/|www\.)[^\s<>"')\]]+)/gi;
const TRAILING = /[.,;:!?)»”'"\]]+$/;

function inline(text: string): string {
  return text
    .split(TOKEN)
    .map((part) => {
      if (!part) return '';
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return `<strong>${esc(part.slice(2, -2))}</strong>`;
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return `<em>${esc(part.slice(1, -1))}</em>`;
      if (/^(https?:\/\/|www\.)/i.test(part)) {
        const tail = TRAILING.exec(part)?.[0] ?? '';
        const address = tail ? part.slice(0, -tail.length) : part;
        if (!address) return esc(part);
        const href = /^https?:\/\//i.test(address) ? address : `https://${address}`;
        return `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(address)}</a>${esc(tail)}`;
      }
      return esc(part);
    })
    .join('');
}

function headingOf(line: string): string | null {
  const t = line.trim();
  const bold = BOLD_LINE.exec(t);
  if (bold) return bold[1]!.trim().replace(/:$/, '');
  const hash = HASH_HEADING.exec(t);
  return hash ? hash[2]!.replace(/^\*\*|\*\*$/g, '').trim().replace(/:$/, '') : null;
}

/** The feedback as the member app lays it out, as HTML for the preview. */
export function renderFeedback(text: string): string {
  const out: string[] = [];
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.replace(/\s+$/, '')).filter((p) => p.trim());
  for (const para of paragraphs) {
    let lines: string[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;
    const flushLines = () => {
      if (lines.length) out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
      lines = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.ordered ? 'ol' : 'ul'}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.ordered ? 'ol' : 'ul'}>`);
      list = null;
    };
    for (const line of para.split('\n')) {
      const heading = headingOf(line);
      const item = ITEM.exec(line);
      if (heading) {
        flushLines();
        flushList();
        out.push(`<h4>${inline(heading)}</h4>`);
      } else if (item) {
        flushLines();
        const ordered = /\d/.test(item[2]!);
        if (list && list.ordered !== ordered) flushList();
        if (!list) list = { ordered, items: [] };
        list.items.push(item[3]!);
      } else {
        flushList();
        lines.push(line.trim());
      }
    }
    flushLines();
    flushList();
  }
  return out.join('');
}

// Wrap the selection in a mark (bold, italic), or put a mark in front of each
// selected line (heading, list); with nothing selected, a placeholder to type over.
function apply(area: HTMLTextAreaElement, fmt: Fmt): void {
  const { selectionStart: a, selectionEnd: b, value } = area;
  if (fmt === 'bold' || fmt === 'italic') {
    const mark = fmt === 'bold' ? '**' : '*';
    const picked = value.slice(a, b) || (fmt === 'bold' ? 'bold words' : 'italic words');
    area.setRangeText(`${mark}${picked}${mark}`, a, b, 'end');
    area.setSelectionRange(a + mark.length, a + mark.length + picked.length);
  } else {
    const start = value.lastIndexOf('\n', a - 1) + 1;
    const endAt = value.indexOf('\n', b);
    const end = endAt === -1 ? value.length : endAt;
    const lines = value.slice(start, end).split('\n');
    const strip = (l: string) => l.replace(/^(#{1,6}\s+|\s*(?:•|-|–|\*|\d{1,2}[.)])\s+)/, '');
    // The line just above: a list item there means this one carries the same list on
    // (no blank line between, and a numbered list keeps counting).
    const above = start > 0 ? value.slice(value.lastIndexOf('\n', start - 2) + 1, start - 1) : '';
    const aboveItem = ITEM.exec(above);
    const continues = fmt !== 'heading' && !!aboveItem && /\d/.test(aboveItem[2]!) === (fmt === 'numbered');
    const from = continues && fmt === 'numbered' ? Number.parseInt(aboveItem![2]!, 10) + 1 : 1;
    const marked = lines.map((l, i) => {
      const bare = strip(l);
      if (fmt === 'heading') return `## ${bare || 'A heading'}`;
      if (fmt === 'list') return `- ${bare}`;
      return `${from + i}. ${bare}`;
    });
    // A heading or a new list reads as its own block: a blank line before it when it follows text.
    const before =
      !continues && start > 0 && value.slice(0, start).trimEnd() !== '' && !/\n\s*\n$/.test(value.slice(0, start)) ? '\n' : '';
    area.setRangeText(before + marked.join('\n'), start, end, 'end');
  }
  area.focus();
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

export function initFeedbackEditors(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-feedback-editor]').forEach((box) => {
    const area = box.querySelector<HTMLTextAreaElement>('textarea');
    const preview = box.querySelector<HTMLElement>('[data-feedback-preview]');
    const count = box.querySelector<HTMLElement>('[data-feedback-count]');
    if (!area) return;
    const paint = () => {
      if (preview) {
        const html = renderFeedback(area.value);
        preview.innerHTML = html || '<p class="fb-empty">The preview shows here as you write.</p>';
      }
      if (count) count.textContent = `${area.value.length.toLocaleString('en')} / ${Number(area.maxLength || 20000).toLocaleString('en')}`;
    };
    box.querySelectorAll<HTMLButtonElement>('[data-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => apply(area, btn.dataset.fmt as Fmt));
    });
    area.addEventListener('keydown', (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i') {
        e.preventDefault();
        apply(area, k === 'b' ? 'bold' : 'italic');
      }
    });
    area.addEventListener('input', paint);
    paint();
  });
}
