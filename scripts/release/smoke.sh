#!/usr/bin/env bash
# make smoke BUILD=<id> [DB=<path>]
#
# docs/release-plan.md §2.7: back up the live DB (default: prod's) into a
# scratch dir, start the candidate against that copy on :5197 and run the
# checks, then start the rollback target against the same migrated copy and
# run them again. Never touches a live DB or port.
source "$(dirname "$0")/lib.sh"

[[ -n "${BUILD:-}" ]] || die "usage: make smoke BUILD=<id>   (ids: make release-status)"
acquire_lock

cand_dir="$(build_dir "$BUILD")"
build_intact "$cand_dir" || die "build ${BUILD} isn't intact; refetch it with make release-fetch"
cand_sha="$(info_get "$cand_dir" sha)"
src_db="${DB:-$PROD_DB}"

# The build that a quick rollback would return to after deploying this
# candidate: today's prod, or prod.prev when the candidate already is prod.
rollback_dir=""
for link in prod prod.prev; do
  [[ -L "${RELEASE_ROOT}/${link}" ]] || continue
  target="$(realpath "${RELEASE_ROOT}/${link}")"
  if [[ "$target" != "$(realpath "$cand_dir")" ]]; then
    rollback_dir="$target"
    break
  fi
done

scratch="$(mktemp -d /tmp/fast-retro-smoke-XXXXXX)"
cleanup_smoke() { stop_scratch; rm -rf "$scratch"; }
add_cleanup cleanup_smoke
mkdir "$scratch/run"
db="$scratch/run/fastretro.db"
token="$(random_token)"

log "smoke ${BUILD} (sha ${cand_sha:0:7}) against a backup of ${src_db}"
db_backup "$src_db" "$db"
counts="$(db_counts "$db")"
min_archives="$(sed -nE 's/.*archives=([0-9]+).*/\1/p' <<<"$counts")"
log "backup ok (integrity_check ok): ${counts}"

result=ok

start_scratch "$cand_dir/fast-retro" "$scratch/run" "$db" "$token" "$scratch/candidate.log"
check_instance "candidate ${BUILD}" "http://127.0.0.1:${SMOKE_PORT}" "$cand_dir" \
  "$token" "$SCRATCH_PID" "$scratch/candidate.log" "$db" "$min_archives" || result=fail
stop_scratch
if strip_ansi < "$scratch/candidate.log" | grep -E ' (WARN|ERROR) |panicked' >&2; then
  warn "candidate logged the warnings/errors above"
  result=fail
fi

rollback_note="skipped (no prod or prod.prev build to roll back to yet)"
if [[ "$result" == ok && -n "$rollback_dir" ]]; then
  if build_intact "$rollback_dir"; then
    start_scratch "$rollback_dir/fast-retro" "$scratch/run" "$db" "$token" "$scratch/rollback.log"
    if check_instance "rollback target $(basename "$rollback_dir") on the migrated copy" \
         "http://127.0.0.1:${SMOKE_PORT}" "$rollback_dir" \
         "$token" "$SCRATCH_PID" "$scratch/rollback.log" "$db" "$min_archives"; then
      rollback_note="ok ($(basename "$rollback_dir"))"
    else
      rollback_note="FAILED ($(basename "$rollback_dir"))"
      result=fail
    fi
    stop_scratch
  else
    rollback_note="FAILED ($(basename "$rollback_dir") isn't intact)"
    result=fail
  fi
fi
log "rollback compatibility: ${rollback_note}"

audit smoke "build=${BUILD} sha=${cand_sha} db=${src_db} ${counts} rollback=\"${rollback_note}\" result=${result}"
[[ "$result" == ok ]] || die "smoke FAILED for ${BUILD}"
log "smoke passed for ${BUILD}"
