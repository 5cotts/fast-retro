#!/usr/bin/env bash
# make release-seed-prod
#
# One-time migration, docs/release-plan.md §3 step 2 (first half). Copies the
# binary fast-retro-prod is running RIGHT NOW into builds/<ts>-<sha7>/ as a
# source: seeded build and points the prod link at it. Doesn't restart or
# reconfigure anything: switching the service's entrypoint to
# fast-retro-releases/prod/fast-retro is a separate update_user_service step.
# A seeded build is a valid rollback target, never a prod-deploy candidate.
source "$(dirname "$0")/lib.sh"

env="$(release_env)"
link="$(env_get "$env" link)"
service="$(env_get "$env" service)"
port="$(env_get "$env" port)"

acquire_lock
ensure_layout

[[ ! -e "${RELEASE_ROOT}/${link}" ]] || die "${link} link already exists ($(basename "$(link_build "$link")")); the migration is done"
read -r state pid uptime < <(service_state "$service")
[[ "$state" == RUNNING && "$pid" =~ ^[0-9]+$ ]] || die "${service} is ${state}; seed from a running, healthy service"
curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" > /dev/null || die "${service} isn't healthy on :${port}"

# The sha comes from the running process, not from notes or the checkout.
version="$(curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/version" 2>/dev/null || true)"
sha="$(jq -r '.sha // empty' <<<"$version" 2>/dev/null || true)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] \
  || die "${service} has no /api/version with a git sha (got: $(head -c 60 <<<"${version:-nothing}" | tr -d '\n')...). Deploy PR 1 (#43) the manual way first, then seed"
tree="$(jq -r '.tree // empty' <<<"$version")"
built_at="$(jq -r '.built_at // empty' <<<"$version")"
exe="$(readlink "/proc/${pid}/exe")"
log "seeding from ${service} PID ${pid}: ${exe} (sha ${sha:0:7})"

id="$(now_ts)-${sha:0:7}"
tmp="${BUILDS_DIR}/.tmp-seed-${id}"
dest="${BUILDS_DIR}/${id}"
if is_true "${DRY_RUN:-}"; then
  log "DRY_RUN: cp /proc/${pid}/exe -> ${dest}/fast-retro, save GET / as index.html, write BUILD_INFO (source: seeded), point ${link} at it"
  exit 0
fi
cleanup_seed() { rm -rf "$tmp"; }
add_cleanup cleanup_seed
mkdir "$tmp"
# /proc/<pid>/exe is the exact inode running, even if the path was replaced.
cp "/proc/${pid}/exe" "$tmp/fast-retro"
chmod 755 "$tmp/fast-retro"
bin_sha="$(sha256_of "$tmp/fast-retro")"
[[ "$bin_sha" == "$(sha256_of "/proc/${pid}/exe")" ]] || die "copy doesn't match the running binary"
# The HTML this binary serves (entry scripts are what verify compares).
curl -fsS --max-time 10 "http://127.0.0.1:${port}/" > "$tmp/index.html"
grep -q '/_app/immutable/entry/' "$tmp/index.html" || die "GET / didn't return the app's HTML"
jq -n --arg sha "$sha" --arg tree "$tree" --arg built_at "$built_at" --arg bin "$bin_sha" \
      --arg from "$exe" --arg at "$(now_iso)" \
  '{source: "seeded", sha: $sha, tree: $tree, built_at: $built_at, binary_sha256: $bin,
    seeded_from: $from, seeded_at: $at}' > "$tmp/BUILD_INFO"
echo '{}' > "$tmp/LOCAL_INFO"
mv -T "$tmp" "$dest"
build_intact "$dest" || die "seeded build ${id} isn't intact"
swap_link "$link" "$dest"
audit seed "env=${env} build=${id} sha=${sha} from=${exe} binary_sha256=${bin_sha} result=ok"
log "seeded ${id}; ${link} -> builds/${id}"
log "next (Zo tool, not a script): update_user_service(<${service} id>, entrypoint=\"${RELEASE_ROOT}/${link}/fast-retro\"). Change only the entrypoint"
echo "BUILD=${id}"
