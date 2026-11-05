#!/usr/bin/env bash
# make qa-deploy [BUILD=<id> | PR=<n> | REF=<ref> | SHA=<sha>] [SEED=prod]
#
# docs/release-plan.md §2.5/§2.6.2: fetch the CI build if needed, smoke it
# against a copy of prod's DB, point the qa symlink at it, restart
# fast-retro-qa, verify, and record the QA deploy in the build's LOCAL_INFO
# and release.log. SEED=prod first replaces QA's DB with a fresh backup of
# prod's (the old QA files are kept as *.bak-<ts>). If verify fails, the qa
# link goes back to the previous build and QA is restarted on it.
source "$(dirname "$0")/lib.sh"

acquire_lock
ensure_layout

seed="${SEED:-}"
[[ -z "$seed" || "$seed" == prod ]] || die "SEED must be 'prod' or unset, got '$seed'"
if [[ "$seed" == prod ]] && ! is_true "${ALLOW_PUBLIC_SEED:-}"; then
  die "SEED=prod would copy real user boards onto QA, and QA is public. Get Scott's OK, then rerun with ALLOW_PUBLIC_SEED=1"
fi

# ---- which build
if [[ -n "${BUILD:-}" ]]; then
  [[ -z "${PR:-}${REF:-}${SHA:-}" ]] || die "pass BUILD= or one of PR=/REF=/SHA=, not both"
  id="$BUILD"
else
  out="$("$(dirname "$0")/fetch.sh")" || die "release-fetch failed"
  id="$(sed -n 's/^BUILD=//p' <<<"$out" | tail -n1)"
  if [[ -z "$id" ]]; then
    is_true "${DRY_RUN:-}" && { log "DRY_RUN: stopping here (nothing fetched)"; exit 0; }
    die "release-fetch didn't report a build id"
  fi
fi
dir="$(build_dir "$id")"
build_intact "$dir" || die "build ${id} isn't intact; refetch it with make release-fetch"
src="$(info_get "$dir" source)"
sha="$(info_get "$dir" sha)"
[[ "$src" == ci ]] || warn "${id} is a source: ${src} build (fine for QA, but prod-deploy won't accept it as-is)"
log "QA deploy of ${id} (sha ${sha:0:7}, source ${src})${seed:+, SEED=prod}"

# ---- smoke (candidate + rollback target against a copy of prod's DB)
BUILD="$id" "$(dirname "$0")/smoke.sh" || die "smoke failed; QA left unchanged"

# ---- service must exist (setup step 1 in docs/release-plan.md §3)
read -r state pid uptime < <(service_state "$QA_SERVICE")
prev="$(link_build qa)"
if [[ "$state" == ABSENT ]]; then
  if [[ -z "$prev" ]]; then
    swap_link qa "$dir"
    audit qa-bootstrap "build=${id} sha=${sha}"
  fi
  die "service ${QA_SERVICE} isn't registered. The qa link now points at $(basename "$(link_build qa)").
  Register it once (docs/release-plan.md §3 step 1), then rerun: make qa-deploy BUILD=${id}"
fi

logfile="$(env_get qa log)"
offset="$(log_size "$logfile")"

# ---- swap (+ reseed with the service stopped)
# Once QA is stopped (reseed) or its link swapped, any exit before a passed
# verify puts the previous build back and starts QA on it.
STOPPED=0 SWAPPED=0 VERIFIED=0
on_fail_restore() {
  [[ "$STOPPED" == 1 || "$SWAPPED" == 1 ]] || return 0
  [[ "$VERIFIED" != 1 ]] || return 0
  warn "QA deploy didn't finish; putting QA back on ${prev:-(none)}"
  [[ "$SWAPPED" != 1 ]] || restore_link qa "$prev"
  if [[ -n "$prev" ]]; then
    local o; o="$(log_size "$logfile")"
    restart_service "$QA_SERVICE" > /dev/null \
      && VERIFY_STABLE_SECS=10 verify_env qa "$prev" "$o" qa-restore \
      && log "QA is back on $(basename "$prev")" \
      || warn "QA didn't come back cleanly on $(basename "$prev"); check make release-status"
  fi
  audit qa-deploy "build=${id} sha=${sha} result=fail restored=$(basename "${prev:-none}")"
}
add_cleanup on_fail_restore

if [[ "$seed" == prod ]]; then
  ts="$(now_ts)"
  log "reseeding QA from prod (old QA DB files kept as *.bak-${ts})"
  STOPPED=1
  run supervisorctl -c "$SUPERVISOR_CONF" stop "$QA_SERVICE" >&2
  # The -wal and -shm move together with the main file: a leftover WAL next
  # to a new DB file could be replayed into it.
  for ext in "" -wal -shm; do
    if [[ -e "${QA_DB}${ext}" ]]; then
      run mv "${QA_DB}${ext}" "${QA_DB}.bak-${ts}${ext}"
    fi
  done
  if is_true "${DRY_RUN:-}"; then
    log "DRY_RUN: sqlite3 ${PROD_DB} .backup ${QA_DB} + integrity_check"
  else
    db_backup "$PROD_DB" "$QA_DB"
    # Opening the copy for integrity_check creates its own empty -wal; only
    # a non-empty one would mean something else wrote to it.
    [[ ! -s "${QA_DB}-wal" ]] || die "unexpected non-empty ${QA_DB}-wal after reseed"
    log "QA DB reseeded: $(db_counts "$QA_DB")"
  fi
fi

swap_link qa "$dir"
SWAPPED=1
new_pid="$(restart_service "$QA_SERVICE")" || die "${QA_SERVICE} didn't restart"
log "${QA_SERVICE} restarted as PID ${new_pid}"

verify_env qa "$dir" "$offset" "qa-deploy" || die "QA verify FAILED for ${id}"
VERIFIED=1

local_info_update "$dir" ".qa_deploys = ((.qa_deploys // []) + [{at: \$at, verified: true, seed: \"${seed:-none}\"}]) | .qa_verified_at = \$at"
audit qa-deploy "build=${id} sha=${sha} from=$(basename "${prev:-none}") seed=${seed:-none} result=ok"
log "QA is on ${id} (sha ${sha:0:7}): ${QA_URL}"
