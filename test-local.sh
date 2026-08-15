#!/usr/bin/env bash
# Runs the full e2e suite against a fully isolated, disposable local
# instance: its own port, its own scratch database, and cargo run (never
# target/release/fast-retro). This is the only documented way to run e2e
# tests locally — see tests/README.md for why isolation matters here.
set -euo pipefail
cd "$(dirname "$0")"

export PATH="${HOME}/.cargo/bin:${PATH}"

PORT="${TEST_PORT:-5199}"
LEAD_TOKEN="${RETRO_LEAD_TOKEN:-dev-token}"
DB="$(mktemp -u /tmp/fastretro-e2e-XXXXXX.db)"
LOG="$(mktemp -u /tmp/fastretro-e2e-XXXXXX.log)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$DB" "$DB-wal" "$DB-shm" "$LOG"
}
trap cleanup EXIT

echo "==> Starting isolated backend on :$PORT (scratch db: $DB)"
RETRO_LEAD_TOKEN="$LEAD_TOKEN" PORT="$PORT" FASTRETRO_DB="$DB" COOKIE_SECURE=false \
  cargo run > "$LOG" 2>&1 &
SERVER_PID=$!

echo "==> Waiting for it to come up..."
ready=false
for _ in $(seq 1 90); do
  if curl -fsS "http://localhost:$PORT/" > /dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Backend on :$PORT never came up after 90s. Log:"
  cat "$LOG"
  exit 1
fi

echo "==> Running Playwright suite against http://localhost:$PORT"
E2E_BASE_URL="http://localhost:$PORT" RETRO_LEAD_TOKEN="$LEAD_TOKEN" bun run test:e2e
