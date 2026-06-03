# Songdance site — notes for Claude

Astro site deployed to Cloudflare Workers. Media (images) live in an R2 bucket
(`songdance-media`, bound as `MEDIA`) and are served publicly at `/media/<key>`.

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
