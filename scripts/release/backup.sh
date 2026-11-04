#!/usr/bin/env bash
# make db-backup-check [DB=<path>]
#
# Takes a consistent online backup of a live DB (default: prod's) into a
# scratch dir, runs PRAGMA integrity_check on the copy, and compares row
# counts against the live file. Only reads the live DB; the scratch copy is
# removed on exit. prod-deploy uses the same db_backup helper for its
# restore point (docs/release-plan.md §2.6.1 step 4).
source "$(dirname "$0")/lib.sh"

src="${DB:-$PROD_DB}"
[[ -f "$src" ]] || die "no database at $src"

scratch="$(mktemp -d /tmp/fast-retro-backup-XXXXXX)"
cleanup_scratch() { rm -rf "$scratch"; }
add_cleanup cleanup_scratch

for attempt in 1 2; do
  live="$(db_counts "$src")"
  rm -f "$scratch/copy.db"
  db_backup "$src" "$scratch/copy.db"
  copy="$(db_counts "$scratch/copy.db")"
  if [[ "$live" == "$copy" ]]; then
    log "integrity_check ok; row counts match live: ${copy}"
    log "size: $(du -h "$scratch/copy.db" | cut -f1) (live main file $(du -h "$src" | cut -f1), wal $(du -h "$src-wal" 2>/dev/null | cut -f1 || echo -))"
    exit 0
  fi
  warn "attempt ${attempt}: live ${live} vs copy ${copy} (a write may have landed in between)"
done
die "row counts differ between the live DB and its backup"
