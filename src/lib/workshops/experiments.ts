// Bookmarked page changes — a dated record of a deliberate change to a
// funnel, so a number measured afterwards can be read against the same number
// before it.
//
// The site has no page-view analytics of its own, so "did conversion go up?"
// can only ever be answered by comparing like windows of the data we do keep
// (registrations, seats secured, revenue, ad spend). That comparison is
// worthless without an exact date for the change, remembered next to the code
// that made it — hence this file rather than a note in a commit message.
//
// Add an entry here whenever you change what a landing page offers.

export type PageChange = {
  key: string;
  /** YYYY-MM-DD, the day the change went live (Europe/Brussels). */
  date: string;
  title: string;
  /** What changed, in one sentence, for whoever reads the admin panel later. */
  note: string;
};

// 3 Sept 2026 — the masterclass page listed the live €22 workshop dates under
// "in case the masterclass doesn't fit your schedule". A visitor who came for
// the €44 masterclass could take the cheaper seat instead, so the section was
// removed to see whether masterclass conversion rises without it. The
// masterclass replay stays: it is the same product at the same price.
export const MC_WORKSHOP_ALTERNATIVES: PageChange = {
  key: 'mc-workshop-alternatives',
  date: '2026-09-03',
  title: 'Masterclass page: workshop dates removed',
  note:
    'The live workshop dates were removed from /courses/masterclass; the masterclass replay stays. ' +
    'Before this date the page offered both, and a visitor could register for a €22 workshop instead of the €44 masterclass.',
};

// Flip to true to put the workshop dates back on the masterclass page (and add
// a second entry above with that date, so the windows stay readable).
export const MC_PAGE_OFFERS_WORKSHOPS = false;

export const PAGE_CHANGES: PageChange[] = [MC_WORKSHOP_ALTERNATIVES];
