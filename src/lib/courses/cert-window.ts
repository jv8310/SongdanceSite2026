// The window to apply for certification, for one address — the single answer
// the live-pass page and the SVH app (app.songdance.co, "Apply for
// Certification") both read.
//
// It is the certification course's own end date (cert-access.ts for a site
// order, cert-access-legacy.ts for the Drip-only holders), moved later by a
// certification-window extension (live-pass.ts). The CEEE 2025 cohort hold the
// course without the right to certify (`cert_no_certification`) until they buy
// an extension. Nothing is stored; every read restates it from the orders.

import { brusselsToday } from '../workshops/periods';
import { CERT_ACCESS_FLOOR, getCertAccessForEmail } from './cert-access';
import { getLegacyCertAccessForEmail } from './cert-access-legacy';

export type CertWindow = {
  email: string;
  // Holds the certification course in some form (site order, prod_SVH_9m, CEEE 2025).
  holdsCourse: boolean;
  source: 'site' | 'legacy' | null;
  // The course's own end, before any extension (inclusive, Brussels).
  courseEndsOn: string | null;
  // The last day of a certification-window extension, when it reaches further.
  extendedTo: string | null;
  // The last day the window is open (inclusive) — null when they hold no course.
  endsOn: string | null;
  // False for the CEEE 2025 cohort without an extension: the course, not the
  // right to certify.
  mayCertify: boolean;
  // mayCertify, and today is on or before endsOn.
  open: boolean;
};

export async function certWindowForEmail(db: D1Database, email: string, today = brusselsToday()): Promise<CertWindow> {
  const key = email.trim().toLowerCase();
  const site = await getCertAccessForEmail(db, key);
  if (site) {
    return {
      email: key,
      holdsCourse: true,
      source: 'site',
      courseEndsOn: site.courseEndsOn,
      extendedTo: site.extendedTo,
      endsOn: site.endsOn,
      mayCertify: true,
      open: today <= site.endsOn,
    };
  }
  const legacy = await getLegacyCertAccessForEmail(db, key);
  if (legacy) {
    const mayCertify = !legacy.noCertification;
    return {
      email: key,
      holdsCourse: true,
      source: 'legacy',
      courseEndsOn: CERT_ACCESS_FLOOR,
      extendedTo: legacy.extendedTo,
      endsOn: legacy.endsOn,
      mayCertify,
      open: mayCertify && today <= legacy.endsOn,
    };
  }
  return {
    email: key,
    holdsCourse: false,
    source: null,
    courseEndsOn: null,
    extendedTo: null,
    endsOn: null,
    mayCertify: false,
    open: false,
  };
}

// Would an extension ending on `passEndsOn` buy this person anything? Only a
// course holder can have one, and only when it opens a window they lack or
// reaches past the one they have.
export function extensionWouldHelp(w: CertWindow, passEndsOn: string): boolean {
  if (!w.holdsCourse) return false;
  if (!w.mayCertify) return true;
  return !w.endsOn || passEndsOn > w.endsOn;
}
