#!/usr/bin/env bash
# make prod-deploy BUILD=<id> CONFIRM=<sha7> [FORCE=1] [SKIP_QA=1] [ALLOW_LOCAL_BUILD=1]
# make qa-drill-deploy BUILD=<id> CONFIRM=<sha7>   (same sequence against QA)
#
# docs/release-plan.md §2.6.1. Refuses unless:
#   (a) CONFIRM matches the build's sha;
#   (b) the build passed a QA deploy (SKIP_QA=1 for a hotfix, Scott's OK only);
#   (c) its git tree equals a freshly fetched origin/main's tree (prod only);
#   (d) it's a source: ci build whose attestation re-verifies now and whose
#       files still match BUILD_INFO (source: local needs ALLOW_LOCAL_BUILD=1;
#       source: seeded is a rollback target only).
# Then: preflight (healthy, disk, no live participants unless FORCE=1), an
# online DB backup, smoke, and promote (swap prev + link, restart, verify;
# any failure puts the old build back).
# After verify: a GitHub release prod-<build id> (best effort; NO_GH_RELEASE=1 skips).
source "$(dirname "$0")/lib.sh"

env="$(release_env)"
link="$(env_get "$env" link)"
service="$(env_get "$env" service)"
port="$(env_get "$env" port)"
db="$(env_get "$env" db)"
action=prod-deploy
[[ "$env" == prod ]] || log "DRILL: running the prod-deploy sequence against ${env}"

[[ -n "${BUILD:-}" ]] || die "usage: make prod-deploy BUILD=<id> CONFIRM=<sha7>   (ids: make release-status)"
acquire_lock
ensure_layout

dir="$(build_dir "$BUILD")"
build_intact "$dir" || die "build ${BUILD} isn't intact (files changed since fetch?); refetch it"
sha="$(info_get "$dir" sha)"
tree="$(info_get "$dir" tree)"
src="$(info_get "$dir" source)"

# ---- guards
check_confirm "$sha"
log "guard (a) ok: CONFIRM matches ${sha:0:7}"

case "$src" in
  ci)
    run_id="$(info_get "$dir" run_id)"
    verify_attestation "$dir/fast-retro" "$run_id" \
      || die "guard (d): attestation for ${BUILD} doesn't verify now"
    # shellcheck disable=SC2016  # $at is a jq variable
    local_info_update "$dir" '.attestation_verified_at = $at'
    log "guard (d) ok: source ci, attestation re-verified (run ${run_id}), files match BUILD_INFO"
    ;;
  local)
    is_true "${ALLOW_LOCAL_BUILD:-}" \
      || die "guard (d): ${BUILD} is a break-glass local build; prod-deploy needs ALLOW_LOCAL_BUILD=1 (Scott's OK only)"
    warn "guard (d): deploying a source: local build (ALLOW_LOCAL_BUILD=1)"
    ;;
  seeded)
    die "guard (d): ${BUILD} is a seeded build; it can only be a rollback target (make rollback BUILD=${BUILD})" ;;
  *) die "guard (d): unknown source '${src}'" ;;
esac

qa_at="$(jq -r '.qa_verified_at // empty' "$dir/LOCAL_INFO" 2>/dev/null || true)"
if [[ -n "$qa_at" ]]; then
  log "guard (b) ok: QA verified at ${qa_at}"
elif is_true "${SKIP_QA:-}"; then
  warn "guard (b): ${BUILD} was never QA'd; continuing because SKIP_QA=1 (Scott's OK only)"
else
  die "guard (b): ${BUILD} was never QA'd. Run make qa-deploy BUILD=${BUILD} first"
fi

main_sha=-
if [[ "$env" == prod ]]; then
  git -C "$REPO_DIR" fetch --quiet origin main >&2 || die "guard (c): git fetch origin main failed"
  main_sha="$(git -C "$REPO_DIR" rev-parse origin/main)"
  main_tree="$(git -C "$REPO_DIR" rev-parse 'origin/main^{tree}')"
  [[ "$tree" == "$main_tree" ]] \
    || die "guard (c): ${BUILD}'s tree ${tree:0:7} isn't origin/main's (${main_sha:0:7}, tree ${main_tree:0:7}). Merge first, or fetch the main build: make release-fetch"
  log "guard (c) ok: tree matches origin/main ${main_sha:0:7}"
else
  log "guard (c) skipped: drill on ${env}"
fi

# ---- preflight
cur="$(link_build "$link")"
[[ -n "$cur" ]] || die "no ${link} link yet. Do the one-time migration first (docs/release-plan.md §3 step 2: make release-seed-prod)"
[[ "$cur" != "$(realpath "$dir")" ]] || die "${env} is already on ${BUILD}"
read -r state pid uptime < <(service_state "$service")
[[ "$state" == RUNNING && "$pid" =~ ^[0-9]+$ ]] || die "preflight: ${service} is ${state}; fix it (or make rollback) before deploying"
exe="$(readlink "/proc/${pid}/exe" 2>/dev/null || true)"
[[ "$exe" == "$(realpath "$cur/fast-retro")" ]] \
  || die "preflight: ${service} runs '${exe}', not the ${link} link's build ($(basename "$cur")). Migration not done, or a restart is pending; see make release-status"
curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" > /dev/null || die "preflight: ${service} isn't healthy on :${port}"
cur_sha="$(curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/version" | jq -r .sha)" \
  || die "preflight: no /api/version on :${port}"
avail_kb="$(df -Pk "$RELEASE_ROOT" | awk 'NR==2 {print $4}')"
(( avail_kb > 1024 * 1024 )) || die "preflight: under 1 GB free on $(df -P "$RELEASE_ROOT" | awk 'NR==2 {print $6}')"

read -r participants who < <(live_participants "$env")
if (( participants > 0 )); then
  if ! is_true "${FORCE:-}"; then
    die "preflight: ${participants} live participant(s) on ${env}: ${who}. Wait for a quiet moment, or FORCE=1 (Scott's OK only)"
  fi
  docprs="$(doc_model_prs "$cur_sha" "$sha" | tr '\n' ' ')"
  [[ -z "${docprs// /}" ]] \
    || die "preflight: this release includes doc-model-change PR(s) ${docprs}; it needs zero live participants, FORCE doesn't apply (§2.9)"
  warn "preflight: deploying with ${participants} live participant(s) (${who}) because FORCE=1"
fi
log "preflight ok: ${service} PID ${pid} on $(basename "$cur") (${cur_sha:0:7}), ${participants} live participants"

# ---- backup (prod-deploy is the only writer of restore points in data/)
bak="${db}.bak-$(now_ts)-pre-${sha:0:7}"
if is_true "${DRY_RUN:-}"; then
  log "DRY_RUN: sqlite3 ${db} .backup ${bak} + integrity_check"
  counts="(dry run)"
else
  db_backup "$db" "$bak"
  counts="$(db_counts "$bak")"
fi
log "restore point: ${bak} (${counts})"

# ---- smoke (candidate, then the build a quick rollback would return to)
BUILD="$BUILD" SMOKE_ENV="$env" DB="$db" "$(dirname "$0")/smoke.sh" || die "smoke failed; ${env} left unchanged"

# ---- swap, restart, verify (auto-restore on any failure)
promote "$env" "$dir" "$action"

local_info_update "$dir" ".${env}_deploys = ((.${env}_deploys // []) + [{at: \$at, from: \"$(basename "$cur")\", main: \"${main_sha}\", backup: \"${bak}\"}])"
audit "$action" "env=${env} build=${BUILD} from=$(basename "$cur") from_sha=${cur_sha} to_sha=${sha} main=${main_sha} run=$(info_get "$dir" run_url || echo -) backup=${bak} ${counts} result=ok"
log "${env} is on ${BUILD} (sha ${sha:0:7}); quick rollback target: $(basename "$cur")"
gh_release_publish "$env" "$dir" "$main_sha" "$cur_sha"
log "report: $(env_get "$env" url)  version ${sha:0:7}  backup ${bak}  verify ok"
