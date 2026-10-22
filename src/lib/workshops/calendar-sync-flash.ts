// The one-line summary after "Calendar sync" (the header button on /admin and
// /admin/workshops posts to /api/admin/workshops/calendar-sync and lands back
// with these params). The member app's Q&As ride the same line.

export type CalendarSyncFlash = { tone: 'ok' | 'warn'; text: string } | null;

export function calendarSyncFlash(params: URLSearchParams): CalendarSyncFlash {
  const flash = params.get('flash');
  if (flash === 'cal_notconnected') {
    return { tone: 'warn', text: 'Google Calendar isn’t connected yet — set it up in Settings → Calendar sync.' };
  }
  if (flash === 'cal_error') return { tone: 'warn', text: 'Calendar sync failed. Check Settings → Calendar sync.' };
  if (flash !== 'cal_synced') return null;

  let text = `Calendar sync: ${params.get('created') ?? 0} published, ${params.get('skipped') ?? 0} skipped.`;
  if (params.get('app_error')) {
    return { tone: 'warn', text: `${text} The member app’s Q&As were not synced — see Settings → Calendar sync.` };
  }
  const num = (k: string) => Number(params.get(k) ?? 0) || 0;
  const app = [
    num('app_created') && `${num('app_created')} new`,
    num('app_updated') && `${num('app_updated')} changed`,
    num('app_skipped') && `${num('app_skipped')} skipped`,
  ].filter(Boolean);
  if (app.length) text += ` App Q&As: ${app.join(', ')}.`;
  const missing = num('app_missing');
  if (missing) {
    return {
      tone: 'warn',
      text: `${text} ${missing} app session${missing === 1 ? ' is' : 's are'} no longer on the calendar — Settings → Calendar sync lists ${missing === 1 ? 'it' : 'them'}.`,
    };
  }
  return { tone: 'ok', text };
}
