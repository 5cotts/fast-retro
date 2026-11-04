# Releasing fast-retro

Runbook for agents. Design and rationale: [`release-plan.md`](release-plan.md). Run every command from the `fast-retro/` repo root on the Zo box.

> Status: the QA section is live (release PR 4). Prod still deploys the manual way until release PR 5 moves it to `make prod-deploy`; the rest of this runbook lands in PR 6.

## Environments

| | QA | Prod |
|---|---|---|
| Service | `fast-retro-qa` (port 5103) | `fast-retro-prod` (port 5102) |
| URL | https://fast-retro-qa-5cotts.zo.computer (**private**: Scott must be signed in to Zo) | https://fast-retro.scottschmidt.io |
| Runs | `fast-retro-releases/qa/fast-retro` (symlink into `builds/`) | `fast-retro/target/release/fast-retro` (until PR 5) |
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

### Troubleshooting

| Symptom | What to do |
|---|---|
| `no successful full-tier CI build` | Add the `e2e` label (PR) or wait for the `main` push run. The runs for the commit are listed in the error. |
| `another release operation holds .lock` | Another release command is running. Wait for it; don't delete the lock. |
| `service fast-retro-qa isn't registered` | One-time setup, see `release-plan.md` §3 step 1. |
| `smoke failed; QA left unchanged` | The candidate failed a check against prod's data. Read the `FAIL` lines; don't deploy it. |
| `QA verify FAILED` | QA was put back on the previous build. The log tail is in `fast-retro-releases/logs/`. |

Never stop processes with `pkill -f` (it has matched our own shell before). Use `supervisorctl` or the PID.
