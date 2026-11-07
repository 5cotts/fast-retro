#!/usr/bin/env bash
# Clips are compiled into the binary and kept in git history forever, so CI
# holds them to a budget.
set -euo pipefail

MAX_FILE_KB=300
MAX_TOTAL_KB=3072
DIR="$(dirname "$0")/../frontend/src/lib/guide/clips"

total=0
failed=0
for f in "$DIR"/*.webp; do
  [[ -e "$f" ]] || continue
  kb=$(( ($(stat -c %s "$f") + 1023) / 1024 ))
  total=$(( total + kb ))
  if (( kb > MAX_FILE_KB )); then
    echo "$(basename "$f") is $kb KB, over the $MAX_FILE_KB KB limit." >&2
    failed=1
  fi
done
if (( total > MAX_TOTAL_KB )); then
  echo "Clips total $total KB, over the $MAX_TOTAL_KB KB limit." >&2
  failed=1
fi
echo "Guide clips: $total KB of $MAX_TOTAL_KB KB."
exit "$failed"
