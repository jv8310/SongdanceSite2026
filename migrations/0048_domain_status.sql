-- Cache of per-domain mail-server (MX/A) checks, used to clean a broadcast's
-- pending queue: a domain with no mail records (or a typo TLD like .con) can't
-- receive mail, so every address there will hard-bounce and is removed before
-- sending. Cached so a domain is only looked up once across batches/broadcasts.
-- See src/lib/broadcasts/clean.ts.
CREATE TABLE IF NOT EXISTS domain_status (
  domain     TEXT PRIMARY KEY,            -- lowercased
  ok         INTEGER NOT NULL,            -- 1 = can receive mail, 0 = dead
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
