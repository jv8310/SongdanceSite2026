// The moment picker for individual sessions — used by /sessions (booking) and
// /sessions/booking (moving a session). Renders the free moments (UTC instants
// from the server) on the visitor's clock: a "Times shown in" select, a row of
// days, the times of the chosen day. Browser-only; no network.

import { formatInTz, timezoneLabel, usesTwelveHourClock } from '../workshops/time';

export type PickerSlot = { s: string; e: string };

const COMMON_ZONES = [
  'Europe/Brussels', 'Europe/Amsterdam', 'Europe/London', 'Europe/Berlin', 'Europe/Zurich',
  'Europe/Oslo', 'Europe/Stockholm', 'Europe/Copenhagen', 'Europe/Madrid', 'Europe/Lisbon',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto',
  'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Perth',
  'Australia/Sydney', 'Pacific/Auckland',
];

const city = (z: string) => (timezoneLabel(z) ?? z).replace(/_/g, ' ');

export type Picker = {
  tz: () => string;
  selected: () => PickerSlot | null;
  remove: (startUtc: string) => void;
  label: (iso: string) => string; // full "Thu, 12 Nov 2026, 10:00 Brussels time"
};

export function mountPicker(
  root: HTMLElement,
  initial: PickerSlot[],
  opts: { fallbackTz: string; preferTz?: string | null; onChange: (slot: PickerSlot | null) => void },
): Picker {
  let slots = initial.slice();
  let browserTz = opts.fallbackTz;
  try {
    browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || browserTz;
  } catch {}
  let tz = opts.preferTz || browserTz;

  // Typed by hand: this project's DOM + Workers typings disagree on HTMLSelectElement.
  const tzSelect = root.querySelector<HTMLElement>('[data-tz]') as HTMLElement & { value: string };
  const daysEl = root.querySelector<HTMLElement>('[data-days]')!;
  const timesEl = root.querySelector<HTMLElement>('[data-times]')!;
  const emptyEl = root.querySelector<HTMLElement>('[data-empty]');

  const zones = Array.from(new Set([tz, browserTz, ...COMMON_ZONES]));
  tzSelect.innerHTML = zones
    .map((z) => `<option value="${z}">${city(z)}${z === browserTz ? ' (your clock)' : ''}</option>`)
    .join('');
  tzSelect.value = tz;

  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    return {
      wd: new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(d),
      dm: new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).format(d),
    };
  };
  const timeLabel = (iso: string) => {
    const twelve = usesTwelveHourClock(tz);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: twelve ? 'numeric' : '2-digit',
      minute: '2-digit',
      hourCycle: twelve ? 'h12' : 'h23',
    }).formatToParts(new Date(iso));
    return parts
      .map((p, i) => {
        if (p.type === 'dayPeriod') return p.value.toUpperCase();
        if (p.type === 'literal' && parts[i + 1]?.type === 'dayPeriod') return ' ';
        return p.value;
      })
      .join('');
  };

  let selectedDay: string | null = null;
  let selected: PickerSlot | null = null;

  const groups = () => {
    const m = new Map<string, PickerSlot[]>();
    for (const s of slots) {
      const k = dayKey(s.s);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return m;
  };

  function render() {
    const g = groups();
    if (emptyEl) emptyEl.hidden = g.size > 0;
    if (selected && !slots.some((s) => s.s === selected!.s)) selected = null;
    if (selectedDay && !g.has(selectedDay)) selectedDay = null;
    if (!selectedDay) selectedDay = g.keys().next().value ?? null;
    daysEl.innerHTML = Array.from(g.entries())
      .map(([k, list]) => {
        const l = dayLabel(list[0].s);
        return `<button type="button" role="tab" class="ss-day${k === selectedDay ? ' is-on' : ''}" data-day="${k}" aria-selected="${k === selectedDay}"><span class="ss-day-wd">${l.wd}</span><span class="ss-day-dm">${l.dm}</span><span class="ss-day-n">${list.length} free</span></button>`;
      })
      .join('');
    const list = selectedDay ? g.get(selectedDay) ?? [] : [];
    timesEl.innerHTML = list.length
      ? `<p class="ss-times-head">${city(tz)} time</p><div class="ss-time-grid">${list
          .map((s) => `<button type="button" class="ss-time${selected?.s === s.s ? ' is-on' : ''}" data-slot="${s.s}" aria-pressed="${selected?.s === s.s}">${timeLabel(s.s)}</button>`)
          .join('')}</div>`
      : '';
    opts.onChange(selected);
  }

  daysEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (!b) return;
    selectedDay = b.dataset.day ?? null;
    render();
  });
  timesEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    if (!b) return;
    selected = slots.find((s) => s.s === b.dataset.slot) ?? null;
    render();
  });
  tzSelect.addEventListener('change', () => {
    tz = tzSelect.value;
    if (selected) selectedDay = dayKey(selected.s);
    render();
  });
  render();

  return {
    tz: () => tz,
    selected: () => selected,
    remove: (startUtc) => {
      slots = slots.filter((s) => s.s !== startUtc);
      render();
    },
    label: (iso) => formatInTz(iso, tz),
  };
}
