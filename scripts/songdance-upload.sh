#!/usr/bin/env bash
# songdance-upload — upload images to the SongdanceSite2026 GitHub repo
# from anywhere on your Mac, without cloning the repo.
#
# Requires: gh (brew install gh) and an authenticated session (gh auth login).
#
# Usage:
#   songdance-upload <file>... [-f folder] [-m message] [-b branch] [-n name]
#
# Defaults:
#   folder  -> public/imagery
#   branch  -> main
#   message -> "Add <filename>"

set -euo pipefail

REPO="jv8310/SongdanceSite2026"
DEFAULT_FOLDER="public/imagery"
DEFAULT_BRANCH="main"

usage() {
  cat <<EOF
songdance-upload — upload images to $REPO without a local clone.

Usage:
  songdance-upload <file>... [options]

Options:
  -f <folder>    Target folder in repo (default: $DEFAULT_FOLDER)
  -m <message>   Commit message (default: "Add <filename>")
  -b <branch>    Branch to commit to (default: $DEFAULT_BRANCH)
  -n <name>      Rename uploaded file (only with a single file)
  -l             List allowed folders that already exist in the repo
  -h             Show this help

Examples:
  songdance-upload ~/Desktop/jacob-new.jpg
  songdance-upload portrait.jpg -f public/imagery -n portrait-jacob-2026.jpg
  songdance-upload *.jpg -f public/imagery/forgiveness -m "Add forgiveness gallery"
  songdance-upload logo.png -f public/brand -b some-feature-branch
EOF
}

folder="$DEFAULT_FOLDER"
branch="$DEFAULT_BRANCH"
message=""
rename=""
list_folders=false
files=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f) folder="${2:?missing folder}"; shift 2 ;;
    -m) message="${2:?missing message}"; shift 2 ;;
    -b) branch="${2:?missing branch}"; shift 2 ;;
    -n) rename="${2:?missing name}"; shift 2 ;;
    -l) list_folders=true; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; while [[ $# -gt 0 ]]; do files+=("$1"); shift; done ;;
    -*) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    *) files+=("$1"); shift ;;
  esac
done

command -v gh >/dev/null 2>&1 || {
  echo "Error: gh CLI not found. Install with: brew install gh" >&2
  exit 1
}
gh auth status >/dev/null 2>&1 || {
  echo "Error: gh not authenticated. Run: gh auth login" >&2
  exit 1
}

if $list_folders; then
  echo "Image folders in $REPO (branch: $branch):"
  gh api "repos/$REPO/contents/public?ref=$branch" \
    --jq '.[] | select(.type=="dir") | "  public/" + .name'
  gh api "repos/$REPO/contents/public/imagery?ref=$branch" \
    --jq '.[] | select(.type=="dir") | "  public/imagery/" + .name' 2>/dev/null || true
  exit 0
fi

if [[ ${#files[@]} -eq 0 ]]; then
  echo "Error: no files provided" >&2
  usage
  exit 1
fi
if [[ -n "$rename" && ${#files[@]} -gt 1 ]]; then
  echo "Error: -n can only be used with a single file" >&2
  exit 1
fi

folder="${folder#/}"
folder="${folder%/}"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

upload_one() {
  local path="$1"
  local name="${2:-$(basename "$path")}"
  local target="$folder/$name"
  local msg="${message:-Add $name}"

  [[ -f "$path" ]] || { echo "  ✗ not found: $path" >&2; return 1; }

  local size
  size=$(wc -c <"$path" | tr -d ' ')
  if (( size > 25 * 1024 * 1024 )); then
    echo "  ⚠ $path is $(( size / 1024 / 1024 ))MB — GitHub Contents API caps at ~25MB. Skipping." >&2
    return 1
  fi

  echo "→ $path  →  $REPO:$target  ($branch)"

  local b64="$tmpdir/content.b64"
  base64 -i "$path" 2>/dev/null | tr -d '\n' > "$b64" || base64 "$path" | tr -d '\n' > "$b64"

  local sha
  sha=$(gh api "repos/$REPO/contents/$target?ref=$branch" --jq '.sha' 2>/dev/null || true)

  local args=(--method PUT "repos/$REPO/contents/$target"
              -f "message=$msg"
              -f "content=@$b64"
              -f "branch=$branch")
  if [[ -n "$sha" ]]; then
    args+=(-f "sha=$sha")
    echo "  (replacing existing file)"
  fi

  local commit_url
  commit_url=$(gh api "${args[@]}" --jq '.commit.html_url')
  echo "  ✓ $commit_url"
}

failed=0
for f in "${files[@]}"; do
  upload_one "$f" "$rename" || failed=$((failed + 1))
done

if (( failed > 0 )); then
  echo "Done with $failed failure(s)." >&2
  exit 1
fi
echo "Done."
