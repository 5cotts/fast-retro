#!/usr/bin/env bash
# make release-check [REF=<ref> | PR=<n> | SHA=<sha>]   (default: HEAD of the dev checkout)
#
# Runs CI's gates locally against the exact commit, in a clean worktree
# under fast-retro-releases/ (docs/release-plan.md §2.5). For agents before
# pushing, and the first step of a break-glass build. Informational only:
# CI is the source of truth, and this never marks a build as passing.
source "$(dirname "$0")/lib.sh"

acquire_lock
if [[ -z "${REF:-}${PR:-}${SHA:-}" ]]; then
  SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
  git -C "$REPO_DIR" diff --quiet HEAD -- \
    || warn "the dev checkout has uncommitted changes; they are NOT checked (only ${SHA:0:7} is)"
fi
sha="$(resolve_sha)"
log "release-check ${sha} in ${WORKTREE}"
prepare_worktree "$sha"

export CARGO_TARGET_DIR="$CARGO_TARGET"
cd "$WORKTREE"
step() { log "== $*"; }

step "bun install --frozen-lockfile"
bun install --frozen-lockfile > /dev/null
( cd frontend && bun install --frozen-lockfile > /dev/null )
step "frontend build"
( cd frontend && bun run build > /dev/null )
step "frontend type check"
( cd frontend && bun run check )
step "frontend unit tests"
( cd frontend && bun run test:unit )
step "cargo test"
cargo test --locked
step "clippy (count reported, not gated)"
clippy_log="$(mktemp)"
cargo clippy --locked --all-targets > "$clippy_log" 2>&1 || true
warnings="$(grep '^warning: ' "$clippy_log" | grep -vc ' generated [0-9]* warning' || true)"
rm -f "$clippy_log"
log "clippy warnings: ${warnings:-0}"
step "e2e (./test-local.sh, isolated scratch server)"
./test-local.sh

audit release-check "sha=${sha} result=ok clippy_warnings=${warnings:-0}"
log "local gates passed for ${sha:0:7} (informational; CI is the source of truth)"
