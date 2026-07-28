#!/usr/bin/env bash
#
# scripts/stitch_grid.sh — Phase 4 of the Exhibition Render Pipeline.
#
# Tiles exactly 6 x (1280x1080) videos into a 3840x2160 (3 cols x 2 rows) grid
# using FFmpeg's xstack filter, encoded with libx264 -crf 18.
#
# Usage:
#   bash scripts/stitch_grid.sh --batch=test
#   bash scripts/stitch_grid.sh --batch=1
#
# The 6 book ids for a batch are read from the parse manifest
# (public/exhibition-texts/index.json). Each id maps to renders/raw/<id>.webm.
#
set -euo pipefail

# --- locate repo root (this script lives in <root>/scripts) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MANIFEST="$ROOT/public/exhibition-texts/index.json"
FPS="${FPS:-30}"
CRF="${CRF:-18}"

# Allow alternate raw/final directories (absolute or repo-relative).
RAW_DIR="${RAW_DIR:-renders/raw}"
FINAL_DIR="${FINAL_DIR:-renders/final}"
if [[ "$RAW_DIR" != /* ]]; then RAW_DIR="$ROOT/$RAW_DIR"; fi
if [[ "$FINAL_DIR" != /* ]]; then FINAL_DIR="$ROOT/$FINAL_DIR"; fi

# --- parse --batch ---
BATCH="test"
for arg in "$@"; do
  case "$arg" in
    --batch=*) BATCH="${arg#*=}" ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: manifest not found: $MANIFEST" >&2
  echo "Run 'make parse-books' first." >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ERROR: ffmpeg not found on PATH." >&2
  exit 1
fi

mkdir -p "$FINAL_DIR"

# --- resolve the 6 book ids for this batch via node (no jq dependency) ---
IDS_RAW="$(node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const b = process.argv[2];
  const arr = (m.batches && m.batches[b]) || [];
  process.stdout.write(arr.join("\n"));
' "$MANIFEST" "$BATCH")"

if [[ -z "$IDS_RAW" ]]; then
  echo "ERROR: no ids found for batch '$BATCH' in manifest." >&2
  echo "Available batches:" >&2
  node -e 'const m=require(process.argv[1]);console.error("  "+Object.keys(m.batches||{}).join(", "))' "$MANIFEST" >&2
  exit 1
fi

# Read ids into an array.
IDS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && IDS+=("$line")
done <<< "$IDS_RAW"

if [[ "${#IDS[@]}" -ne 6 ]]; then
  echo "ERROR: batch '$BATCH' resolved to ${#IDS[@]} ids, expected exactly 6." >&2
  exit 1
fi

# --- build input list and verify each file exists ---
INPUTS=()
for id in "${IDS[@]}"; do
  f="$RAW_DIR/$id.webm"
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing render: $f" >&2
    echo "Run 'make render-test' / render_books.js for batch '$BATCH' first." >&2
    exit 1
  fi
  INPUTS+=(-i "$f")
done

OUT="$FINAL_DIR/batch_${BATCH}.mp4"

echo "[stitch] batch  : $BATCH"
echo "[stitch] cells  : ${IDS[*]}"
OUT_REL="${OUT#$ROOT/}"
echo "[stitch] output : ${OUT_REL}"

# Normalise every cell to 1280x1080 @ FPS, then xstack 3x2.
FILTER=""
for i in 0 1 2 3 4 5; do
  FILTER+="[${i}:v]scale=1280:1080:force_original_aspect_ratio=disable,setsar=1,fps=${FPS}[v${i}];"
done
FILTER+="[v0][v1][v2][v3][v4][v5]xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0[out]"

ffmpeg -y -hide_banner -loglevel error -stats \
  "${INPUTS[@]}" \
  -filter_complex "$FILTER" \
  -map "[out]" \
  -c:v libx264 -crf "$CRF" -preset medium -pix_fmt yuv420p \
  -movflags +faststart \
  "$OUT"

echo "[stitch] wrote $(du -h "$OUT" | cut -f1) -> $OUT"
