# Release tooling for the Zo box. Thin wrappers over scripts/release/*.sh;
# see docs/RELEASING.md (design: docs/release-plan.md).
# Every target is safe to rerun. DRY_RUN=1 prints destructive steps
# instead of running them.

R := scripts/release
# Pass only the variables a script reads, explicitly, so nothing else from
# the caller's environment changes behavior.
ARGS = REF="$(REF)" PR="$(PR)" SHA="$(SHA)" BUILD="$(BUILD)" DB="$(DB)" SEED="$(SEED)" ALLOW_PUBLIC_SEED="$(ALLOW_PUBLIC_SEED)" DRY_RUN="$(DRY_RUN)" \
       CONFIRM="$(CONFIRM)" FORCE="$(FORCE)" SKIP_QA="$(SKIP_QA)" ALLOW_LOCAL_BUILD="$(ALLOW_LOCAL_BUILD)"

.PHONY: help guide-clips guide-clips-check release-fetch release-check release-build-local release-status smoke db-backup-check release-lint qa-deploy prod-deploy rollback release-seed-prod qa-drill-deploy qa-drill-rollback

help:
	@echo "make guide-clips [CLIP=<name>]                             re-record the user guide's clips on a scratch instance"
	@echo "make guide-clips-check [CLIP=<name>]                       run the clip flows without recording"
	@echo "make release-fetch [REF=origin/main | PR=<n> | SHA=<sha>]  download + verify a CI build"
	@echo "make release-status                                        what prod/QA run, builds, restore points"
	@echo "make qa-deploy [BUILD=<id> | PR=<n> | REF=...] [SEED=prod]  smoke, point QA at a build, restart, verify"
	@echo "make prod-deploy BUILD=<id> CONFIRM=<sha7>                 guards, backup, smoke, swap, restart, verify (Scott's OK)"
	@echo "make rollback [BUILD=<id>] [CONFIRM=<sha7>]                prod back to prod.prev, or to an older prod build"
	@echo "make qa-drill-deploy / qa-drill-rollback ...               the same two sequences against QA (drills)"
	@echo "make release-seed-prod                                     one-time: seed builds/ with prod's running binary"
	@echo "make smoke BUILD=<id>                                      candidate + rollback target vs a copy of prod's DB"
	@echo "make db-backup-check [DB=<path>]                           online backup + integrity_check + row counts"
	@echo "make release-check [REF=... | PR=... | SHA=...]           CI's gates locally, in a clean worktree"
	@echo "make release-build-local REF=... | PR=... | SHA=...        BREAK-GLASS: local build (Scott's OK only)"
	@echo "make release-lint                                          shellcheck the release scripts"

guide-clips:
	@CLIP="$(CLIP)" FASTRETRO_BIN="$(FASTRETRO_BIN)" GUIDE_CLIPS_RECORD=1 scripts/guide-clips.sh

guide-clips-check:
	@CLIP="$(CLIP)" FASTRETRO_BIN="$(FASTRETRO_BIN)" scripts/guide-clips.sh

release-fetch:
	@$(ARGS) $(R)/fetch.sh

release-check:
	@$(ARGS) $(R)/check.sh

release-build-local:
	@$(ARGS) $(R)/build-local.sh

release-status:
	@$(ARGS) $(R)/status.sh

qa-deploy:
	@$(ARGS) $(R)/qa-deploy.sh

prod-deploy:
	@$(ARGS) RELEASE_ENV=prod $(R)/prod-deploy.sh

rollback:
	@$(ARGS) RELEASE_ENV=prod $(R)/rollback.sh

qa-drill-deploy:
	@$(ARGS) RELEASE_ENV=qa $(R)/prod-deploy.sh

qa-drill-rollback:
	@$(ARGS) RELEASE_ENV=qa $(R)/rollback.sh

release-seed-prod:
	@$(ARGS) RELEASE_ENV=prod $(R)/seed.sh

smoke:
	@$(ARGS) $(R)/smoke.sh

db-backup-check:
	@$(ARGS) $(R)/backup.sh

release-lint:
	@cd $(R) && shellcheck *.sh lib.sh
