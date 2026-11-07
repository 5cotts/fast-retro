#!/usr/bin/env bash
# Runs the user guide's clip flows on a scratch instance: its own port and a
# temp database, never prod's or QA's.
#
#   GUIDE_CLIPS_RECORD=1 records, and rewrites frontend/src/lib/guide/clips/.
#   CLIP=<name> runs one clip. FASTRETRO_BIN=<path> uses that binary.
#
# The binary embeds the frontend, so build the frontend first.
set -euo pipefail

BIN=""
if [[ -n "${FASTRETRO_BIN:-}" ]]; then
  BIN="$(realpath "$FASTRETRO_BIN")"
  [[ -x "$BIN" ]] || { echo "FASTRETRO_BIN is not an executable file: $FASTRETRO_BIN" >&2; exit 1; }
fi

cd "$(dirname "$0")/.."
export PATH="${HOME}/.cargo/bin:${PATH}"

PORT="${TEST_PORT:-5198}"
DB="$(mktemp -u /tmp/fastretro-clips-XXXXXX.db)"
LOG="$(mktemp -u /tmp/fastretro-clips-XXXXXX.log)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$DB" "$DB-wal" "$DB-shm" "$LOG"
}
trap cleanup EXIT

if [[ "$PORT" == 5102 || "$PORT" == 5103 ]]; then
  echo "Refusing to run on :$PORT, which is a deployed fast-retro port." >&2
  exit 1
fi

if [[ "${GUIDE_CLIPS_RECORD:-}" == 1 ]] && ! command -v ffmpeg > /dev/null; then
  echo "Recording needs ffmpeg." >&2
  exit 1
fi

if [[ -n "$BIN" ]]; then
  CMD=("$BIN")
else
  CMD=(cargo run)
fi
RETRO_LEAD_TOKEN=dev-token PORT="$PORT" FASTRETRO_DB="$DB" COOKIE_SECURE=false FASTRETRO_RATE_LIMIT=10000 \
  "${CMD[@]}" > "$LOG" 2>&1 &
SERVER_PID=$!

ready=false
for _ in $(seq 1 180); do
  if curl -fsS "http://localhost:$PORT/" > /dev/null 2>&1; then
    ready=true
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Scratch instance didn't come up:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

args=(playwright test --config tests/guide-clips/playwright.config.ts)
if [[ -n "${CLIP:-}" ]]; then
  args+=("$CLIP.clip.ts")
fi
E2E_BASE_URL="http://localhost:$PORT" bunx "${args[@]}"
