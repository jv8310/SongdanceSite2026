-- Certification holders the site has no order for: people Drip tags
-- `prod_SVH_9m` because they bought the certification before this site took
-- payments, and the CEEE 2025 cohort (`prod_CEEE-25`), who got the 2026
-- certification course free with their programme. Read from Drip by
-- src/lib/courses/cert-access-legacy.ts; their course ends 31 Dec 2026.
-- One row per address (lowercased). A person who also has a paid order on the
-- site is left to the order — this table never overrides it.
CREATE TABLE IF NOT EXISTS cert_access_legacy (
  email          TEXT PRIMARY KEY,
  name           TEXT,
  has_cert_tag   INTEGER NOT NULL DEFAULT 0, -- prod_SVH_9m
  has_ceee_tag   INTEGER NOT NULL DEFAULT 0, -- prod_CEEE-25
  first_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
