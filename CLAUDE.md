# Songdance site — notes for Claude

Astro site deployed to Cloudflare Workers. Media (images) live in an R2 bucket
(`songdance-media`, bound as `MEDIA`) and are served publicly at `/media/<key>`.

## Copy book — READ THIS FIRST before any page work

**Before creating or editing any page, email, or post, you MUST consult
[`docs/svh-copy-book.md`](docs/svh-copy-book.md).** It is the single source of
truth for the site's voice, headlines, paragraphs, quotes, and the non-negotiable
rules of the practice (Somatic Vocal Healing). No page should be written or
changed without first pulling language and direction from it.

The four laws it enforces (never break these in any string on the site):

1. The sound **of** something, never *for* it (one named exception — chapter 35).
2. **Acknowledgment** — never "release" or "letting go" as the mechanism.
3. **Sounding**, not singing.
4. Facilitators **hold space**; the participant heals themselves.

Also: no outcome promises, no urgency, no rescue framing, and **never** the
words "Hamer" or "German New Medicine" anywhere, in any string. Prices and
program structures do not live in the copy book — only the practice itself.

## Email lifecycle (workshops)

All automated workshop email lives in the workshop engine:

- **Words**: `src/lib/workshops/emails.ts` (every template; copy-book rules apply)
- **Cadence**: `src/lib/workshops/cron.ts` (5-min cron; idempotent claims, staleness
  guards, sequence chaining, suppression checks)
- **Sequences**: abandoned checkout ×2 · confirmation + 7 reminders · attended ×3
  (12-week course, riding the 48h/20% participant-discount window from
  `src/lib/courses/twelve-week.ts`) · attended-PRO ×3 (certification path;
  masterclass attendees now, `is_pro` column when it lands) · no-show ×3 ·
  downsell ×2
- **Unsubscribe**: `src/lib/email/unsubscribe.ts`, `/unsubscribe`,
  `/api/unsubscribe` (RFC 8058 one-click), `email_suppressions` table. Marketing
  sends honor it; transactional (confirmation/reminders) always deliver.
- **Review**: `/admin/emails` previews every email with sample data + test-send.
- **Sanctioned urgency exception** (owner's call, June 2026): discount-deadline
  emails may name the deadline plainly and the final one may be a "last chance"
  send. Keep it factual — no fake scarcity, no countdown theatrics. Marketing
  sends are from `MARKETING_FROM` (Jacob), reply-to `support@songdance.co`.

## R2 image library — how to view and use images

The bucket holds two kinds of images:

- `library/…` — general images uploaded via the admin image manager
- `events/…` — event-card pictures (renaming/deleting one breaks its card)

There is **no Cloudflare credential in the dev container**, so don't reach for
`wrangler r2`. Instead use the public, read-only manifest + the CLI helper:

```bash
# What's in the bucket? (newest first; folders summary at the top)
node scripts/r2-library.mjs list
node scripts/r2-library.mjs list hero --prefix library/   # filter by name + folder

# Pull images down so you can actually look at them with the Read tool.
# They land in .r2-library/ (gitignored).
node scripts/r2-library.mjs pull hero
node scripts/r2-library.mjs pull --limit 12               # newest 12 to eyeball

# Just the URLs to paste onto a page:
node scripts/r2-library.mjs urls --prefix library/
```

Workflow to **use an image on a page**:

1. `list` / `pull` to find the right image, then `Read` the pulled file to
   confirm what it actually shows before using it.
2. Reference it on a page by its public path: `/media/library/<name>.webp`
   (the `url` field in the manifest). No import needed — it's served by the
   worker, same origin.

The manifest endpoint itself: `GET /api/library/manifest.json`
(`?prefix=library/`, `?limit=20`). It's public and returns `{ count, folders,
images[] }` where each image has `key`, `size`, `uploaded`, `contentType`,
`url` (`/media/<key>`) and `absoluteUrl`.

The CLI defaults to `https://site.songdance.co`; override with
`SONGDANCE_BASE_URL` or `--base` (e.g. a `*.workers.dev` preview URL).

## Preview link — always share one after pushing

Every push to a non-`main` branch triggers the **Preview** workflow
(`.github/workflows/preview.yml`): it uploads a Cloudflare preview version of
the worker and prints its `*.workers.dev` URL in the run log / job summary.
After pushing work, **always** fetch that URL (wait for the run to finish,
pull it from the "Upload preview version" step log) and include the clickable
preview link in your reply — Jacob expects one with every change. The preview
shares production bindings (D1, R2), so it shows real data without touching
the live deployment.
