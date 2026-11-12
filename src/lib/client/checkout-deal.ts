// The discount band and its countdown, shared by the two course checkouts
// (certification: CCRegister, 12-week: TWRegister). Both write their offer
// markup with innerHTML, so this hands them the same HTML and the same clock
// painter; the looks live in src/styles/course-checkout.css.
//
// A clock is found by name (`data-co-clock="deal"` / `"gift"`), so the discount
// timer and the Songdeck gift timer can tick in the same form without painting
// each other. One name may appear more than once: the band at the top of the
// offer and the one-line reminder above the pay button show the same time.

export type Deal = {
  /** The big figure ("25% off"). Left out when the lines carry different rates. */
  percent?: number;
  /** The main line, e.g. "Your workshop discount". */
  title: string;
  /** The small line under it, e.g. "On the whole path · you save €272". */
  detail?: string;
  /** Draw the countdown. Painted by paintClocks(scope, 'deal', msLeft). */
  countdown?: boolean;
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A countdown in three tiles (hours · min · sec). `trimHours` drops the hours
 * tile once it reads zero, for windows that are an hour long (the gift).
 */
export function clockHtml(
  name: string,
  label: string,
  opts: { trimHours?: boolean } = {},
): string {
  return (
    `<span class="co-clock" data-co-clock="${esc(name)}"${opts.trimHours ? ' data-co-trim' : ''} role="timer">` +
    `<span class="co-clock-label">${esc(label)}</span>` +
    `<span class="co-clock-tiles">` +
    `<span class="co-clock-tile" data-co-hwrap><b data-co-h>--</b><i>hours</i></span>` +
    `<span class="co-clock-tile"><b data-co-m>--</b><i>min</i></span>` +
    `<span class="co-clock-tile"><b data-co-s>--</b><i>sec</i></span>` +
    `</span></span>`
  );
}

/** The ember band at the head of an offer: the discount, and how long it runs. */
export function dealHtml(d: Deal): string {
  const fig = d.percent
    ? `<span class="co-deal-fig"><span class="co-deal-num">${d.percent}</span><span class="co-deal-unit">% off</span></span>`
    : '';
  return (
    `<span class="co-deal${d.countdown ? ' co-deal--timed' : ''}">` +
    `<span class="co-deal-main">${fig}` +
    `<span class="co-deal-text">` +
    `<span class="co-deal-title">${esc(d.title)}</span>` +
    (d.detail ? `<span class="co-deal-detail">${esc(d.detail)}</span>` : '') +
    `</span></span>` +
    (d.countdown ? clockHtml('deal', 'Ends in') : '') +
    `</span>`
  );
}

/** Write the time left into every clock of that name inside `scope`. */
export function paintClocks(scope: HTMLElement, name: string, leftMs: number): void {
  const s = Math.max(0, Math.floor(leftMs / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  scope.querySelectorAll<HTMLElement>(`[data-co-clock="${name}"]`).forEach((el) => {
    // The one-line form: "31:12:08".
    if (el.hasAttribute('data-co-text')) {
      el.textContent = `${hh}:${mm}:${ss}`;
      return;
    }
    const set = (sel: string, v: string) => {
      const part = el.querySelector<HTMLElement>(sel);
      if (part && part.textContent !== v) part.textContent = v;
    };
    set('[data-co-h]', hh);
    set('[data-co-m]', mm);
    set('[data-co-s]', ss);
    const hWrap = el.querySelector<HTMLElement>('[data-co-hwrap]');
    if (hWrap) hWrap.hidden = el.hasAttribute('data-co-trim') && hh === '00';
    el.setAttribute('aria-label', `${hh}:${mm}:${ss} left`);
  });
}
