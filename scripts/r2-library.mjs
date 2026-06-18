#!/usr/bin/env node
// r2-library — browse and pull the Songdance R2 image library from the
// command line. Built so Claude (or anyone) can discover what's in the bucket,
// download images locally to actually look at them, and then reuse their
// /media/… URLs on pages.
//
// It talks to the public manifest endpoint (/api/library/manifest.json) on the
// live site — no Cloudflare credentials needed. Images themselves are public
// at /media/<key>.
//
// Usage:
//   node scripts/r2-library.mjs list [filter]        list images (optional name/key substring)
//   node scripts/r2-library.mjs pull [filter]        download matching images into .r2-library/
//   node scripts/r2-library.mjs urls [filter]        print just the /media/… paths (one per line)
//
// Options:
//   --prefix <p>   only this folder, e.g. --prefix library/ or --prefix events/
//   --limit <n>    cap results (newest first)
//   --base <url>   site origin (default: $SONGDANCE_BASE_URL or https://songdance.co)
//   --out <dir>    download dir for `pull` (default: .r2-library/)
//   --json         print raw manifest JSON (for `list`)
//
// Examples:
//   node scripts/r2-library.mjs list
//   node scripts/r2-library.mjs list jacob --prefix library/
//   node scripts/r2-library.mjs pull hero
//   node scripts/r2-library.mjs pull --limit 12        # newest 12, to eyeball them

import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const DEFAULT_BASE = process.env.SONGDANCE_BASE_URL || 'https://songdance.co';

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--prefix') opts.prefix = argv[++i];
    else if (a === '--limit') opts.limit = argv[++i];
    else if (a === '--base') opts.base = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts._.push(a);
  }
  return opts;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function help() {
  // The header comment doubles as the help text.
  console.log(
    `r2-library — browse & pull the Songdance R2 image library

Commands:
  list [filter]   list images (optional name/key substring match)
  pull [filter]   download matching images into .r2-library/ so you can view them
  urls [filter]   print just the /media/… paths, one per line

Options:
  --prefix <p>    only this folder (library/ or events/)
  --limit <n>     cap results (newest first)
  --base <url>    site origin (default $SONGDANCE_BASE_URL or ${DEFAULT_BASE})
  --out <dir>     download dir for pull (default .r2-library/)
  --json          print raw manifest JSON (list only)`,
  );
}

async function fetchManifest(base, { prefix, limit } = {}) {
  const u = new URL('/api/library/manifest.json', base);
  if (prefix) u.searchParams.set('prefix', prefix);
  if (limit) u.searchParams.set('limit', limit);
  const res = await fetch(u);
  if (!res.ok) {
    throw new Error(`Manifest fetch failed: ${res.status} ${res.statusText} (${u})`);
  }
  return res.json();
}

function applyFilter(images, filter) {
  if (!filter) return images;
  const q = filter.toLowerCase();
  return images.filter((it) => it.key.toLowerCase().includes(q));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  const filter = opts._[1];
  const base = opts.base || DEFAULT_BASE;

  if (opts.help || !cmd) {
    help();
    process.exit(opts.help ? 0 : 1);
  }

  const manifest = await fetchManifest(base, { prefix: opts.prefix, limit: opts.limit });
  const images = applyFilter(manifest.images || [], filter);

  if (cmd === 'list') {
    if (opts.json) {
      console.log(JSON.stringify({ ...manifest, images }, null, 2));
      return;
    }
    const folderSummary = Object.entries(manifest.folders || {})
      .map(([f, n]) => `${f} ${n}`)
      .join('   ');
    console.log(`${images.length} image(s)${filter ? ` matching "${filter}"` : ''}   ${folderSummary}\n`);
    for (const it of images) {
      console.log(
        `${fmtBytes(it.size).padStart(8)}  ${(it.uploaded || '').slice(0, 10)}  ${it.url}`,
      );
    }
    return;
  }

  if (cmd === 'urls') {
    for (const it of images) console.log(it.url);
    return;
  }

  if (cmd === 'pull') {
    if (images.length === 0) {
      console.log('Nothing to pull (no images matched).');
      return;
    }
    const outDir = opts.out || '.r2-library';
    await mkdir(outDir, { recursive: true });
    let ok = 0;
    for (const it of images) {
      // Fetch bytes from the same origin we read the manifest from, so a
      // --base preview/local URL stays self-consistent (the manifest's
      // absoluteUrl is baked from PUBLIC_BASE_URL and may point elsewhere).
      const url = new URL(it.url, base).toString();
      const dest = join(outDir, basename(it.key));
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        await writeFile(dest, Buffer.from(await res.arrayBuffer()));
        console.log(`✓ ${dest}  (${fmtBytes(it.size)})`);
        ok++;
      } catch (err) {
        console.error(`✗ ${it.key}: ${err.message}`);
      }
    }
    console.log(`\nPulled ${ok}/${images.length} → ${outDir}/`);
    return;
  }

  console.error(`Unknown command: ${cmd}\n`);
  help();
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
