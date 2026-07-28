#!/usr/bin/env bash
#
# scripts/concatenate.sh — Phase 4 of the Exhibition Render Pipeline.
#
# Concatenates the three 10-minute batch grids into the final 30-minute
# exhibition video: renders/final/exhibition_final.mp4
#
# Usage:
#   bash scripts/concatenate.sh
#   bash scripts/concatenate.sh --batches="1 2 3"
#   FINAL_DIR=renders/final_offset30 bash scripts/concatenate.sh --out=renders/final_offset30/exhibition_final_offset30.mp4
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FINAL_DIR="${FINAL_DIR:-renders/final}"
if [[ "$FINAL_DIR" != /* ]]; then FINAL_DIR="$ROOT/$FINAL_DIR"; fi
OUT="$FINAL_DIR/exhibition_final.mp4"

BATCHES="1 2 3"
for arg in "$@"; do
  case "$arg" in
    --batches=*) BATCHES="${arg#*=}" ;;
    --out=*) OUT="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ "$OUT" != /* ]]; then OUT="$ROOT/$OUT"; fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ERROR: ffmpeg not found on PATH." >&2
  exit 1
fi

LIST_FILE="$(mktemp "${TMPDIR:-/tmp}/exhibition_concat.XXXXXX")"
trap 'rm -f "$LIST_FILE"' EXIT

count=0
for b in $BATCHES; do
  f="$FINAL_DIR/batch_${b}.mp4"
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing batch grid: $f" >&2
    echo "Run 'bash scripts/stitch_grid.sh --batch=${b}' first." >&2
    exit 1
  fi
  # concat demuxer requires absolute paths / escaped quotes
  printf "file '%s'\n" "$f" >> "$LIST_FILE"
  count=$((count + 1))
done

mkdir -p "$(dirname "$OUT")"
echo "[concat] batches : $BATCHES ($count files)"
OUT_REL="${OUT#$ROOT/}"
echo "[concat] output  : ${OUT_REL}"

# Inputs are all libx264 / same params, so stream-copy concat is lossless & fast.
if ! ffmpeg -y -hide_banner -loglevel error -stats \
  -f concat -safe 0 -i "$LIST_FILE" \
  -c copy -movflags +faststart \
  "$OUT" 2>/dev/null; then
  echo "[concat] stream-copy failed, re-encoding ..."
  ffmpeg -y -hide_banner -loglevel error -stats \
    -f concat -safe 0 -i "$LIST_FILE" \
    -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -movflags +faststart \
    "$OUT"
fi

echo "[concat] wrote $(du -h "$OUT" | cut -f1) -> $OUT"
