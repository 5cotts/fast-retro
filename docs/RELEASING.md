# Releasing fast-retro

Runbook for agents. Design and rationale: [`release-plan.md`](release-plan.md). Run every command from the `fast-retro/` repo root on the Zo box.

> Status: QA is live (release PR 4). `make prod-deploy` and `make rollback` exist (release PR 5) but only work after the one-time prod migration (`release-plan.md` §3 step 2), which is scheduled with Scott. Until then prod deploys the manual way. The rest of this runbook lands in PR 6.

## Environments

| | QA | Prod |
|---|---|---|
| Service | `fast-retro-qa` (port 5103) | `fast-retro-prod` (port 5102) |
| URL | https://fast-retro-qa-5cotts.zo.computer (**private**: Scott must be signed in to Zo) | https://fast-retro.scottschmidt.io |
| Runs | `fast-retro-releases/qa/fast-retro` (symlink into `builds/`) | `fast-retro/target/release/fast-retro` until the migration, then `fast-retro-releases/prod/fast-retro` |
| DB | `fast-retro-releases/qa-data/fastretro-qa.db` (persistent) | `fast-retro/data/fastretro.db` |
| Lead token | `fast-retro-releases/qa-lead.token` | Scott's notes |

Google sign-in and GA4 are off on QA.

`make release-status` shows what each environment runs, the retained builds and the last `release.log` lines. It's read-only and safe any time.

## Deploy to QA

1. Make sure CI built an artifact. Quick-tier runs don't upload one. For a PR (or a stack tip), add the label: `gh pr edit <n> --add-label e2e`. For `main`, the push run builds one.
2. Deploy:

   ```sh
   make qa-deploy PR=<n>          # or REF=origin/main, SHA=<sha>, or BUILD=<id> for a build already fetched
   ```

   This fetches and verifies the CI build (waits up to 30 min if the run is still going), smokes it against a copy of prod's DB on :5197, points `qa` at it, restarts `fast-retro-qa`, and verifies it (local checks with the lead token, then 60 s of the same PID and no `WARN`/`ERROR`/panic in the new log output). On success it records the QA deploy in the build's `LOCAL_INFO` and in `release.log`. If verify fails, it puts QA back on the previous build and exits non-zero.
3. Report back to Scott: the QA URL, the build id and sha, and the verify result. Scott clicks through QA.

### Fresh prod data on QA (`SEED=prod`, Scott's OK first)

```sh
make qa-deploy BUILD=<id> SEED=prod
```

This stops QA, moves its DB and its `-wal`/`-shm` aside together as `*.bak-<ts>` (kept), copies prod's DB in with SQLite's online backup (it only reads prod), runs `integrity_check`, then starts and verifies QA. This copies real user boards into QA, which is why it needs Scott's go-ahead.

## Deploy to prod (Scott's go-ahead for every deploy)

Prerequisites: the build was QA'd (`make qa-deploy`) and its commit's tree is what `main` has now (merge the PR first; a stack tip's build qualifies once the stack is merged).

```sh
make prod-deploy BUILD=<id> CONFIRM=<sha7> DRY_RUN=1   # read the plan it prints
make prod-deploy BUILD=<id> CONFIRM=<sha7>
```

It refuses unless all four guards pass: `CONFIRM` matches, the build was QA'd, its tree equals a fresh `origin/main`, and it's a CI build whose attestation re-verifies now. Then it checks prod is healthy and nobody is on a board, takes a restore point (`data/fastretro.db.bak-<ts>-pre-<sha7>`), smokes the candidate and the rollback target, swaps `prod.prev` → current and `prod` → candidate, restarts and verifies (including the public URL). Any failure, or the script dying before verify passes, puts both links back and restarts the old build.

Overrides, each needing Scott's explicit OK: `FORCE=1` (deploy with live participants; never allowed for `doc-model-change` releases), `SKIP_QA=1` (hotfix), `ALLOW_LOCAL_BUILD=1` (break-glass build).

After verify passes, it creates a GitHub release `prod-<build id>`, tagged at the `origin/main` commit, with the binary and `BUILD_INFO.json` attached and the PRs merged since the previous prod release listed. It's marked Latest, so the repo's Releases list is the history of what went live. This step is best effort: prod is already live, so a failure only warns (`gh-release ... result=fail` in `release.log`). To redo it by hand, use `gh release create prod-<id> --target <main sha> ...` with the same assets. `NO_GH_RELEASE=1` skips it. QA and drills never create releases.

Report back: prod URL, build id and sha, the restore-point path, the GitHub release URL, and the verify result.

## Rollback (Scott's go-ahead)

```sh
make rollback                              # quick: prod <-> prod.prev, no DB backup
make rollback BUILD=<id> CONFIRM=<sha7>    # deep: any build that was live in prod before (per release.log)
```

A prod rollback adds a "Rolled back" note to the release it rolled away from (it's kept, not deleted) and marks the target's release Latest if it has one. Seeded builds have none.

Rollback never restores the DB. Migrations are additive, so the old binary runs on the migrated DB (smoke checks that before every deploy).

## Drills on QA

`make qa-drill-deploy BUILD=<id> CONFIRM=<sha7>` and `make qa-drill-rollback [BUILD=<id> CONFIRM=<sha7>]` run the exact prod-deploy and rollback scripts against `fast-retro-qa` (`qa` / `qa.prev`, guard (c) skipped, restore points in `qa-data/`). Use them to try a change to the release scripts before it touches prod.

### Troubleshooting

| Symptom | What to do |
|---|---|
| `no successful full-tier CI build` | Add the `e2e` label (PR) or wait for the `main` push run. The runs for the commit are listed in the error. |
| `another release operation holds .lock` | Another release command is running. Wait for it; don't delete the lock. |
| `service fast-retro-qa isn't registered` | One-time setup, see `release-plan.md` §3 step 1. |
| `smoke failed; QA left unchanged` | The candidate failed a check against prod's data. Read the `FAIL` lines; don't deploy it. |
| `QA verify FAILED` | QA was put back on the previous build. The log tail is in `fast-retro-releases/logs/`. |
| `guard (c): … isn't origin/main's` | The build isn't what `main` has. Merge the PR, or `make release-fetch` the `main` build, QA it, and deploy that. |
| `preflight: N live participant(s)` | Someone is on a board. Wait and retry; `FORCE=1` only with Scott's OK. |
| `prod-deploy didn't verify; restoring …` | Auto-rollback fired. Check `make release-status` shows the old build running, and read the log tail in `logs/`. The release line says `restore_verify=ok` or `FAILED`; if `FAILED`, tell Scott immediately. |
| `no prod link yet` | The one-time migration isn't done (`release-plan.md` §3 step 2). |

Never stop processes with `pkill -f` (it has matched our own shell before). Use `supervisorctl` or the PID.
