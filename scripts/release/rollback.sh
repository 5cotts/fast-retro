#!/usr/bin/env bash
# make rollback [CONFIRM=<sha7>]              quick: prod <-> prod.prev
# make rollback BUILD=<id> CONFIRM=<sha7>     deep: any build that was live in prod before
# make qa-drill-rollback [BUILD=<id>] ...     the same against QA
#
# docs/release-plan.md §2.5. Never touches the DB on the quick path. The deep
# path skips guards (b) QA'd and (c) tree == main, accepts source: ci and
# source: seeded builds (files must still match BUILD_INFO), and keeps
# CONFIRM, a pre-rollback backup, the swap trap and verify. Live
# participants are reported, not blocking: a rollback is the emergency path.
source "$(dirname "$0")/lib.sh"

env="$(release_env)"
link="$(env_get "$env" link)"
prevlink="$(env_get "$env" prev)"
service="$(env_get "$env" service)"
db="$(env_get "$env" db)"
[[ "$env" == prod ]] || log "DRILL: rolling back ${env}"

acquire_lock
ensure_layout

cur="$(link_build "$link")"
[[ -n "$cur" ]] || die "no ${link} link; nothing to roll back (see make release-status)"

if [[ -n "${BUILD:-}" ]]; then
  mode=deep
  dir="$(build_dir "$BUILD")"
  was_live_in "$env" "$BUILD" \
    || die "${BUILD} was never verified live in ${env} (per release.log); deep rollback only goes to builds that were"
  [[ -n "${CONFIRM:-}" ]] || die "deep rollback needs CONFIRM=<sha7>"
else
  mode=quick
  dir="$(link_build "$prevlink")"
  [[ -n "$dir" ]] || die "no ${prevlink} link to roll back to; use BUILD=<id> (see make release-status)"
fi
id="$(basename "$dir")"
build_intact "$dir" || die "rollback target ${id} isn't intact (files changed?); pick another with BUILD="
src="$(info_get "$dir" source)"
sha="$(info_get "$dir" sha)"
case "$src" in
  ci|seeded) ;;
  local) is_true "${ALLOW_LOCAL_BUILD:-}" || die "${id} is a local build; needs ALLOW_LOCAL_BUILD=1 (Scott's OK only)" ;;
  *) die "unknown source '${src}' for ${id}" ;;
esac
[[ -z "${CONFIRM:-}" ]] || check_confirm "$sha"
[[ "$dir" != "$cur" ]] || die "${env} is already on ${id}"

read -r state pid uptime < <(service_state "$service")
if [[ "$state" == RUNNING ]]; then
  read -r participants who < <(live_participants "$env" 2>/dev/null || echo "? -")
  log "${service} is RUNNING (PID ${pid}); live participants: ${participants} ${who:+(${who})}"
else
  warn "${service} is ${state}; rolling back anyway"
fi
log "${mode} rollback of ${env}: $(basename "$cur") -> ${id} (sha ${sha:0:7}, source ${src})"

bak=-
if [[ "$mode" == deep ]]; then
  bak="${db}.bak-$(now_ts)-pre-${sha:0:7}"
  if is_true "${DRY_RUN:-}"; then
    log "DRY_RUN: sqlite3 ${db} .backup ${bak} + integrity_check"
  else
    db_backup "$db" "$bak"
    log "restore point: ${bak} ($(db_counts "$bak"))"
  fi
fi

promote "$env" "$dir" rollback

local_info_update "$dir" ".rollbacks = ((.rollbacks // []) + [{at: \$at, env: \"${env}\", mode: \"${mode}\", from: \"$(basename "$cur")\"}])"
audit rollback "env=${env} build=${id} from=$(basename "$cur") to_sha=${sha} mode=${mode} backup=${bak} result=ok"
log "${env} is on ${id} (sha ${sha:0:7}); ${prevlink} is now $(basename "$cur")"
gh_release_note_rollback "$env" "$(basename "$cur")" "$id"
