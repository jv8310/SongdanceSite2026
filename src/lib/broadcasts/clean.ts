// List cleaning for the whole contacts list. For each distinct contact domain we
// check, via DNS-over-HTTPS, whether it can receive mail at all (MX, or an A
// record as fallback). Domains that can't — dead domains, typo TLDs like ".con",
// NXDOMAIN — get all their contacts added to the global suppression list, so
// they're gone from this broadcast, every future broadcast, and lifecycle
// marketing. This removes a real chunk of the bounces on a dormant list for
// free; it does NOT catch dead mailboxes at live providers (a deleted Gmail
// address still resolves Gmail's MX) — that needs a mailbox-level validator on
// the exported list.
//
// Lookups are cached in domain_status (migration 0048) so each domain is only
// resolved once across runs/imports. Failures fail OPEN (treated as deliverable)
// so a transient DNS hiccup never wrongly drops a valid address.

import {
  cacheDomainStatus,
  distinctUncheckedContactDomains,
  suppressContactsAtDeadDomains,
  suppressPendingRecipientsAtDeadDomains,
  uncheckedContactDomainCount,
} from './db';

// Obvious typo / non-deliverable domains we can reject without a DNS lookup.
const KNOWN_BAD = new Set([
  'gmial.com', 'gmai.com', 'gmali.com', 'gnail.com', 'gmaill.com', 'gmail.con',
  'hotmial.com', 'hotmai.com', 'hotmal.com', 'hotmali.com', 'hotmil.com',
  'yahooo.com', 'yaho.com', 'yahoo.con', 'outlok.com', 'outloo.com',
  'iclould.com', 'icloud.con', 'live.con', 'mail.con', 'test.com', 'example.com',
]);

// Common ".com" typos as a trailing-TLD pattern (never a real mail TLD).
const BAD_TLD = /\.(con|cpm|ocm|cmo|comm|xom|vom|coom|cim|con m)$/;

export function isBadDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase();
  if (!d || /\s/.test(d) || !d.includes('.')) return true;
  if (KNOWN_BAD.has(d)) return true;
  return BAD_TLD.test(d);
}

type DohAnswer = { type: number };
type DohResponse = { Status: number; Answer?: DohAnswer[] };

async function dohQuery(domain: string, type: 'MX' | 'A'): Promise<DohResponse> {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
    { headers: { accept: 'application/dns-json' } },
  );
  if (!res.ok) throw new Error(`doh ${res.status}`);
  return (await res.json()) as DohResponse;
}

// Can this domain receive mail? MX present → yes. No MX but an A record → yes
// (implicit MX). NXDOMAIN (Status 3) or neither → no. Errors fail open.
export async function domainCanReceiveMail(domain: string): Promise<boolean> {
  try {
    const mx = await dohQuery(domain, 'MX');
    if (mx.Status === 3) return false; // NXDOMAIN — domain doesn't exist
    if (mx.Answer?.some((a) => a.type === 15)) return true; // has MX
    const a = await dohQuery(domain, 'A');
    if (a.Status === 3) return false;
    return !!a.Answer?.some((r) => r.type === 1); // implicit MX via A
  } catch {
    return true; // fail open — never drop a valid address on a lookup error
  }
}

export type CleanResult = {
  checked: number; // domains resolved this batch
  dead: number; // of those, non-deliverable
  removed: number; // addresses globally suppressed once the scan finished
  remaining: number; // distinct contact domains still unchecked
};

// Process one batch of unchecked contact domains. Called repeatedly from the
// admin page until `remaining` reaches 0. The (whole-list) suppression sweep is
// run once, when the last domain is resolved, so it scans the contacts table a
// single time rather than on every batch.
export async function cleanContactDomains(db: D1Database, maxDomains = 20): Promise<CleanResult> {
  const domains = await distinctUncheckedContactDomains(db, maxDomains);

  // Resolve in parallel (the slow part), then cache verdicts sequentially.
  const verdicts = await Promise.all(
    domains.map(async (d) => ({ d, ok: isBadDomain(d) ? false : await domainCanReceiveMail(d) })),
  );
  let dead = 0;
  for (const { d, ok } of verdicts) {
    await cacheDomainStatus(db, d, ok);
    if (!ok) dead += 1;
  }

  const remaining = await uncheckedContactDomainCount(db);

  // All domains resolved → suppress every contact at a dead domain (globally),
  // and scrub any live broadcast queues to match. Idempotent, so re-running is
  // safe and a first run also catches domains resolved by an earlier pass.
  let removed = 0;
  if (remaining === 0) {
    removed = await suppressContactsAtDeadDomains(db);
    await suppressPendingRecipientsAtDeadDomains(db);
  }

  return { checked: domains.length, dead, removed, remaining };
}
