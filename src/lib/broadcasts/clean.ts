// List cleaning for a broadcast's pending queue. For each distinct pending
// domain we check, via DNS-over-HTTPS, whether it can receive mail at all
// (MX, or an A record as fallback). Domains that can't — dead domains, typo
// TLDs like ".con", NXDOMAIN — get all their pending recipients marked
// 'suppressed' so they're never sent. This removes a real chunk of the bounces
// on a dormant list for free; it does NOT catch dead mailboxes at live
// providers (a deleted Gmail address still resolves Gmail's MX) — that needs a
// mailbox-level validator on the exported list.
//
// Lookups are cached in domain_status (migration 0048) so each domain is only
// resolved once. Failures fail OPEN (treated as deliverable) so a transient DNS
// hiccup never wrongly drops a valid address.

import {
  cacheDomainStatus,
  distinctUncheckedPendingDomains,
  suppressPendingByDomain,
  uncheckedPendingDomainCount,
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
  removed: number; // pending recipients suppressed this batch
  remaining: number; // distinct pending domains still unchecked
};

// Process one batch of unchecked pending domains. Called repeatedly from the
// admin page until `remaining` reaches 0.
export async function cleanPendingDomains(
  db: D1Database,
  broadcastId: number,
  maxDomains = 20,
): Promise<CleanResult> {
  const domains = await distinctUncheckedPendingDomains(db, broadcastId, maxDomains);
  if (domains.length === 0) return { checked: 0, dead: 0, removed: 0, remaining: 0 };

  // Resolve in parallel (the slow part), then apply DB writes sequentially.
  const verdicts = await Promise.all(
    domains.map(async (d) => ({ d, ok: isBadDomain(d) ? false : await domainCanReceiveMail(d) })),
  );

  let dead = 0;
  let removed = 0;
  for (const { d, ok } of verdicts) {
    await cacheDomainStatus(db, d, ok);
    if (!ok) {
      removed += await suppressPendingByDomain(db, broadcastId, d);
      dead += 1;
    }
  }

  const remaining = await uncheckedPendingDomainCount(db, broadcastId);
  return { checked: domains.length, dead, removed, remaining };
}
