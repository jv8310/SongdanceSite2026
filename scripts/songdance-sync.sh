#!/usr/bin/env bash
# songdance-sync — scan a local folder for images, upload them into the
# right place in the SongdanceSite2026 repo, then delete the local copy.
#
# Default watch dir: ~/Desktop/Upload
#
# Folder mapping (based on first subfolder under the watch dir):
#   Upload/<file>                       → public/imagery/<file>
#   Upload/forgiveness/<file>           → public/imagery/forgiveness/<file>
#   Upload/ritual-of-belonging/<file>   → public/imagery/ritual-of-belonging/<file>
#   Upload/workshop-deutsch/<file>      → public/imagery/workshop-deutsch/<file>
#   Upload/brand/<file>                 → public/brand/<file>
#   Upload/<anything else>/<file>       → public/imagery/<anything else>/<file>
#
# Requires: songdance-upload (already in PATH from the install one-liner).

set -euo pipefail

UPLOAD_DIR="${UPLOAD_DIR:-$HOME/Desktop/Upload}"
DRY_RUN=false
KEEP=false
BRANCH=""
MIN_AGE_SECONDS=2

usage() {
  cat <<EOF
songdance-sync — drop images in ~/Desktop/Upload, run this command, done.

Usage:
  songdance-sync [options]

Options:
  -d <dir>     Watch dir (default: \$HOME/Desktop/Upload or \$UPLOAD_DIR)
  -b <branch>  Commit to this branch (default: main)
  -n           Dry run — show what would happen, don't upload or delete
  -k           Keep local files after upload (don't delete)
  -h           Show this help

Folder layout to create under the watch dir (mirrors the repo):
  brand/
  forgiveness/
  ritual-of-belonging/
  workshop-deutsch/
  (loose files at the root → public/imagery/)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d) UPLOAD_DIR="${2:?missing dir}"; shift 2 ;;
    -b) BRANCH="${2:?missing branch}"; shift 2 ;;
    -n) DRY_RUN=true; shift ;;
    -k) KEEP=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

command -v songdance-upload >/dev/null 2>&1 || {
  echo "Error: songdance-upload not found in PATH." >&2
  echo "Install it first — see scripts/songdance-upload.sh in the repo." >&2
  exit 1
}

if [[ ! -d "$UPLOAD_DIR" ]]; then
  echo "Watch dir does not exist: $UPLOAD_DIR"
  echo "Create it with:"
  echo "  mkdir -p \"$UPLOAD_DIR\"/{brand,forgiveness,ritual-of-belonging,workshop-deutsch}"
  exit 1
fi

# Map a file's relative subdir under $UPLOAD_DIR to a repo folder.
compute_target() {
  local subdir="$1"
  if [[ -z "$subdir" || "$subdir" == "." ]]; then
    printf '%s' "public/imagery"
    return
  fi
  local first="${subdir%%/*}"
  if [[ "$first" == "brand" ]]; then
    printf '%s' "public/$subdir"
  else
    printf '%s' "public/imagery/$subdir"
  fi
}

now_epoch=$(date +%s)
found=0
uploaded=0
failed=0
skipped=0

# Use find -print0 so spaces / weird chars in filenames don't break us.
while IFS= read -r -d '' f; do
  found=$((found + 1))
  rel="${f#"$UPLOAD_DIR"/}"
  subdir="$(dirname "$rel")"
  name="$(basename "$rel")"
  target="$(compute_target "$subdir")"

  # Skip very recently modified files — might still be syncing in from Dropbox/iCloud.
  if [[ "$(uname)" == "Darwin" ]]; then
    mtime=$(stat -f %m "$f" 2>/dev/null || echo 0)
  else
    mtime=$(stat -c %Y "$f" 2>/dev/null || echo 0)
  fi
  age=$(( now_epoch - mtime ))
  if (( age < MIN_AGE_SECONDS )); then
    echo "▸ $rel  —  too fresh (${age}s old), skipping this run"
    skipped=$((skipped + 1))
    continue
  fi

  # Skip zero-byte files (partial copies).
  size=$(wc -c <"$f" | tr -d ' ')
  if [[ "$size" == "0" ]]; then
    echo "▸ $rel  —  empty, skipping"
    skipped=$((skipped + 1))
    continue
  fi

  echo "▸ $rel  →  $target/$name"

  if $DRY_RUN; then
    continue
  fi

  upload_args=("$f" -f "$target")
  [[ -n "$BRANCH" ]] && upload_args+=(-b "$BRANCH")

  if songdance-upload "${upload_args[@]}"; then
    uploaded=$((uploaded + 1))
    if ! $KEEP; then
      rm -f "$f"
      echo "  · removed local copy"
    fi
  else
    failed=$((failed + 1))
    echo "  ! upload failed, keeping local file"
  fi
done < <(find "$UPLOAD_DIR" -type f \
    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
       -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.svg' \) \
    -not -path '*/\.*' -print0)

if (( found == 0 )); then
  echo "No images found in $UPLOAD_DIR."
  exit 0
fi

if $DRY_RUN; then
  echo "Dry run: $found image(s) found, $skipped skipped."
else
  echo "Done. Uploaded: $uploaded, failed: $failed, skipped: $skipped."
  (( failed == 0 ))
fi
