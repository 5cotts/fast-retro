#!/usr/bin/env bash
# Rebuild the SvelteKit frontend, then the Rust binary that embeds it.
set -euo pipefail

cd "$(dirname "$0")"

export PATH="${HOME}/.cargo/bin:${PATH}"

# Version stamp read by the binary (GET /api/version). CI sets these itself;
# local builds derive them from git, marking uncommitted tracked changes.
if [[ -z "${FASTRETRO_GIT_SHA:-}" ]] && git rev-parse --git-dir > /dev/null 2>&1; then
  FASTRETRO_GIT_SHA="$(git rev-parse HEAD)"
  FASTRETRO_GIT_TREE="$(git rev-parse 'HEAD^{tree}')"
  if ! git diff --quiet HEAD --; then
    FASTRETRO_GIT_SHA="${FASTRETRO_GIT_SHA}-dirty"
    FASTRETRO_GIT_TREE="${FASTRETRO_GIT_TREE}-dirty"
  fi
fi
export FASTRETRO_GIT_SHA="${FASTRETRO_GIT_SHA:-dev}"
export FASTRETRO_GIT_TREE="${FASTRETRO_GIT_TREE:-dev}"
export FASTRETRO_BUILT_AT="${FASTRETRO_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
echo "==> Version: sha=$FASTRETRO_GIT_SHA built_at=$FASTRETRO_BUILT_AT"

echo "==> Building frontend (bun run build)"
( cd frontend && bun run build )

echo "==> Building release binary (cargo build --release)"
cargo build --release

ls -lh "${CARGO_TARGET_DIR:-target}/release/fast-retro"
echo "Done. Restart with:"
echo "  RETRO_LEAD_TOKEN=\$RETRO_LEAD_TOKEN nohup ./target/release/fast-retro > /dev/shm/fast-retro.log 2>&1 &"
