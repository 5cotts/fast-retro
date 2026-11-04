# Release tooling for the Zo box. Thin wrappers over scripts/release/*.sh;
# see docs/release-plan.md (and docs/RELEASING.md once it exists).
# Every target is safe to rerun. DRY_RUN=1 prints destructive steps
# instead of running them.

R := scripts/release
# Pass only the variables a script reads, explicitly, so nothing else from
# the caller's environment changes behavior.
ARGS = REF="$(REF)" PR="$(PR)" SHA="$(SHA)" BUILD="$(BUILD)" DB="$(DB)" DRY_RUN="$(DRY_RUN)"

.PHONY: help release-fetch release-check release-build-local release-status smoke db-backup-check release-lint

help:
	@echo "make release-fetch [REF=origin/main | PR=<n> | SHA=<sha>]  download + verify a CI build"
	@echo "make release-status                                        what prod/QA run, builds, restore points"
	@echo "make smoke BUILD=<id>                                      candidate + rollback target vs a copy of prod's DB"
	@echo "make db-backup-check [DB=<path>]                           online backup + integrity_check + row counts"
	@echo "make release-check [REF=... | PR=... | SHA=...]           CI's gates locally, in a clean worktree"
	@echo "make release-build-local REF=... | PR=... | SHA=...        BREAK-GLASS: local build (Scott's OK only)"
	@echo "make release-lint                                          shellcheck the release scripts"

release-fetch:
	@$(ARGS) $(R)/fetch.sh

release-check:
	@$(ARGS) $(R)/check.sh

release-build-local:
	@$(ARGS) $(R)/build-local.sh

release-status:
	@$(ARGS) $(R)/status.sh

smoke:
	@$(ARGS) $(R)/smoke.sh

db-backup-check:
	@$(ARGS) $(R)/backup.sh

release-lint:
	@cd $(R) && shellcheck *.sh lib.sh
