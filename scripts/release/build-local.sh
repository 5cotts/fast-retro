#!/usr/bin/env bash
# make release-build-local REF=<ref> | PR=<n> | SHA=<sha>
#
# BREAK-GLASS ONLY: GitHub is down and Scott has explicitly OK'd a local
# build (docs/release-plan.md §2.5). Runs release-check on the commit, then
# builds it in the clean worktree with its own CARGO_TARGET_DIR and writes a
# build with source: local. prod-deploy refuses these unless
# ALLOW_LOCAL_BUILD=1.
source "$(dirname "$0")/lib.sh"

[[ -n "${REF:-}${PR:-}${SHA:-}" ]] || die "usage: make release-build-local REF=<ref> | PR=<n> | SHA=<sha>"
acquire_lock
sha="$(resolve_sha)"
sha7="${sha:0:7}"
warn "break-glass local build of ${sha7}: only with Scott's explicit OK (normal path: make release-fetch)"

if is_true "${DRY_RUN:-}"; then
  log "DRY_RUN: would run release-check, then build ${sha7} in ${WORKTREE}"
  exit 0
fi

SHA="$sha" REF="" PR="" "$(dirname "$0")/check.sh"

prepare_worktree "$sha"
export CARGO_TARGET_DIR="$CARGO_TARGET"
export FASTRETRO_GIT_SHA="$sha"
FASTRETRO_GIT_TREE="$(git -C "$WORKTREE" rev-parse 'HEAD^{tree}')"
FASTRETRO_BUILT_AT="$(now_iso)"
export FASTRETRO_GIT_TREE FASTRETRO_BUILT_AT
( cd "$WORKTREE" && bun install --frozen-lockfile > /dev/null \
    && ( cd frontend && bun install --frozen-lockfile > /dev/null ) \
    && ./build.sh )

find "$BUILDS_DIR" -mindepth 1 -maxdepth 1 -type d -name '.tmp-*' -exec rm -rf {} +
tmp="${BUILDS_DIR}/.tmp-local-$$"
cleanup_tmp() { [[ -d "$tmp" ]] && rm -rf "$tmp"; return 0; }
add_cleanup cleanup_tmp
mkdir "$tmp"
# cp, never a hardlink: the build dir must not share an inode with cargo's.
cp "${CARGO_TARGET}/release/fast-retro" "$tmp/fast-retro"
cp "${WORKTREE}/frontend/build/index.html" "$tmp/index.html"
chmod +x "$tmp/fast-retro"
jq -n \
  --arg sha "$sha" --arg tree "$FASTRETRO_GIT_TREE" --arg built_at "$FASTRETRO_BUILT_AT" \
  --arg host "$(hostname)" --arg rustc "$(rustc --version)" --arg bun "$(bun --version)" \
  --arg binary_sha256 "$(sha256_of "$tmp/fast-retro")" --arg index_sha256 "$(sha256_of "$tmp/index.html")" \
  '{source: "local", sha: $sha, tree: $tree, ref: "local", event: "release-build-local",
    built_at: $built_at, host: $host, rustc: $rustc, bun: $bun,
    binary_sha256: $binary_sha256, index_sha256: $index_sha256}' > "$tmp/BUILD_INFO"
jq -n --arg at "$(now_iso)" '{built_locally_at: $at, attestation: "none (local build)"}' > "$tmp/LOCAL_INFO"
build_intact "$tmp" || die "local build doesn't match its own BUILD_INFO"

id="$(now_ts)-${sha7}"
mv "$tmp" "${BUILDS_DIR}/${id}"
audit build-local "build=${id} sha=${sha} binary_sha256=$(info_get "${BUILDS_DIR}/${id}" binary_sha256)"
log "built ${id} (source: local)"
echo "BUILD=${id}"
