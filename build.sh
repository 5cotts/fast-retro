#!/usr/bin/env bash
# Rebuild the SvelteKit frontend, then the Rust binary that embeds it.
set -euo pipefail

cd "$(dirname "$0")"

export PATH="${HOME}/.cargo/bin:${PATH}"

echo "==> Building frontend (bun run build)"
( cd frontend && bun run build )

echo "==> Building release binary (cargo build --release)"
cargo build --release

ls -lh target/release/fast-retro
echo "Done. Restart with:"
echo "  RETRO_LEAD_TOKEN=\$RETRO_LEAD_TOKEN nohup ./target/release/fast-retro > /dev/shm/fast-retro.log 2>&1 &"
