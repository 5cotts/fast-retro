#!/usr/bin/env bash
# make release-fetch [REF=origin/main | PR=<n> | SHA=<sha>]
#
# Download the CI-built release artifact for a commit into
# fast-retro-releases/builds/<UTC-ts>-<sha7>/ and verify it came from our
# workflow (docs/release-plan.md §2.10.3). Safe to rerun: an intact build
# for the same sha is reused. Prints the build id on stdout as BUILD=<id>.
source "$(dirname "$0")/lib.sh"

acquire_lock

sha="$(resolve_sha)"
sha7="${sha:0:7}"
artifact="fast-retro-${sha}"
log "commit ${sha}"

# ---- already fetched?
while IFS= read -r id; do
  [[ -n "$id" ]] || continue
  dir="${BUILDS_DIR}/${id}"
  if build_intact "$dir" && jq -e '.attestation == "verified"' "$dir/LOCAL_INFO" > /dev/null 2>&1; then
    log "already fetched and intact: ${id}"
    echo "BUILD=${id}"
    exit 0
  fi
  broken="${BUILDS_DIR}/.broken-${id}-$(now_ts)"
  warn "${id} is incomplete or doesn't match its BUILD_INFO; moving it to $(basename "$broken") and fetching again"
  run mv "$dir" "$broken"
  audit fetch-broken "build=${id} moved_to=$(basename "$broken")"
done < <(builds_for_sha "$sha" ci)

# ---- find a successful run of our workflow, in our repo, for this exact
#      head sha, that uploaded the artifact.
find_run() {
  local arts run_id run
  arts="$(gh api "repos/${REPO_SLUG}/actions/artifacts?name=${artifact}&per_page=100" \
           --jq '[.artifacts[] | select(.expired | not)] | sort_by(.created_at) | reverse | .[].workflow_run.id')" || return 1
  for run_id in $arts; do
    run="$(gh api "repos/${REPO_SLUG}/actions/runs/${run_id}")" || continue
    if jq -e --arg sha "$sha" --arg repo "$REPO_SLUG" --arg path "$WORKFLOW_PATH" '
         .status == "completed" and .conclusion == "success"
         and .head_sha == $sha and .path == $path
         and .head_repository.full_name == $repo and .repository.full_name == $repo' \
         <<<"$run" > /dev/null; then
      echo "$run_id"
      return 0
    fi
  done
  return 1
}

run_id="$(find_run || true)"
if [[ -z "$run_id" ]]; then
  pending="$(gh run list -R "$REPO_SLUG" --workflow build.yml --commit "$sha" \
               --json databaseId,status --jq '[.[] | select(.status != "completed")] | .[0].databaseId // empty')"
  if [[ -n "$pending" ]]; then
    log "CI run ${pending} for ${sha7} is still going; waiting for it (up to 30 min)"
    timeout 1800 gh run watch "$pending" -R "$REPO_SLUG" --interval 30 > /dev/null 2>&1 || true
    run_id="$(find_run || true)"
  fi
fi
if [[ -z "$run_id" ]]; then
  gh run list -R "$REPO_SLUG" --workflow build.yml --commit "$sha" \
    --json url,event,status,conclusion --jq '.[] | "  \(.event) \(.status)/\(.conclusion // "-") \(.url)"' >&2 || true
  die "no successful full-tier CI build of ${sha7} with artifact ${artifact}.
  For a PR, add the 'e2e' label so CI builds one; for main, wait for the push run.
  Any runs for this commit are listed above (quick-tier runs don't upload an artifact)."
fi
run_url="https://github.com/${REPO_SLUG}/actions/runs/${run_id}"
log "CI run ${run_url}"

if is_true "${DRY_RUN:-}"; then
  log "DRY_RUN: would download ${artifact} from run ${run_id} and verify it"
  exit 0
fi

# ---- download into a temp dir; only a fully verified build gets renamed in.
#      We hold the lock, so any .tmp-* left behind is from a killed fetch.
find "$BUILDS_DIR" -mindepth 1 -maxdepth 1 -type d -name '.tmp-*' -exec rm -rf {} +
tmp="${BUILDS_DIR}/.tmp-${run_id}-$$"
cleanup_tmp() { [[ -d "$tmp" ]] && rm -rf "$tmp"; return 0; }
add_cleanup cleanup_tmp
gh run download "$run_id" -R "$REPO_SLUG" -n "$artifact" -D "$tmp"

# ---- verify
fail() { audit fetch-failed "sha=${sha} run=${run_id} reason=$1"; die "$1"; }
[[ "$(jq -r .sha "$tmp/BUILD_INFO")" == "$sha" ]]       || fail "BUILD_INFO sha isn't ${sha}"
[[ "$(jq -r .source "$tmp/BUILD_INFO")" == ci ]]        || fail "BUILD_INFO source isn't ci"
[[ "$(jq -r .run_id "$tmp/BUILD_INFO")" == "$run_id" ]] || fail "BUILD_INFO run_id isn't ${run_id}"
chmod +x "$tmp/fast-retro"
build_intact "$tmp"                                     || fail "downloaded files don't match BUILD_INFO hashes"
verify_attestation "$tmp/fast-retro" "$run_id"          || fail "attestation check failed"
log "sha256 matches BUILD_INFO; attestation verified (signer ${SIGNER_WORKFLOW}, run ${run_id})"

jq -n --arg at "$(now_iso)" --arg run_id "$run_id" --arg run_url "$run_url" \
  '{fetched_at: $at, run_id: $run_id, run_url: $run_url, attestation: "verified", attestation_verified_at: $at}' \
  > "$tmp/LOCAL_INFO"

id="$(now_ts)-${sha7}"
mv "$tmp" "${BUILDS_DIR}/${id}"
audit fetch "build=${id} sha=${sha} run=${run_url} binary_sha256=$(info_get "${BUILDS_DIR}/${id}" binary_sha256)"
log "fetched ${id}"
echo "BUILD=${id}"
