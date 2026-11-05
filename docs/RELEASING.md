# Releasing fast-retro

Runbook for agents. Design and rationale: [`release-plan.md`](release-plan.md). Run every command from the `fast-retro/` repo root on the Zo box, on an up-to-date `main`: this runbook and the release scripts both come from whatever branch is checked out.

## The normal flow

1. Quick CI goes green on the PR.
2. Add the `e2e` label (`gh pr edit <n> --add-label e2e`) and wait for the full CI tier. It builds and attests the binary. For a stack, label the tip.
3. `make qa-deploy PR=<n>`, then send Scott the QA URL.
4. Scott QAs it and merges the PR.
5. With Scott's go-ahead, deploy to prod. Reuse the QA'd build if its tree matches `main`. If `main` has moved, use `REF=origin/main` to fetch and QA the `main` build first.

## What needs Scott's explicit go-ahead

Approval for one deploy doesn't carry over to the next.

- Any `make prod-deploy` or `make rollback`
- `FORCE=1`, `SKIP_QA=1` or `ALLOW_LOCAL_BUILD=1`
- `make qa-deploy SEED=prod ALLOW_PUBLIC_SEED=1`, which copies real user boards onto public QA
- `make release-build-local`
- A manual DB restore

`make qa-deploy` without `SEED=prod`, `make release-status`, `make release-fetch` and QA drills don't need it.

## Environments

| | QA | Prod |
|---|---|---|
| Service | `fast-retro-qa` (port 5103) | `fast-retro-prod` (port 5102) |
| URL | https://fast-retro-qa-5cotts.zocomputer.io (**public**: no sign-in, anyone with the URL can open it) | https://fast-retro.scottschmidt.io |
| Runs | `fast-retro-releases/qa/fast-retro` (symlink into `builds/`) | `fast-retro-releases/prod/fast-retro` (symlink into `builds/`) |
| DB | `fast-retro-releases/qa-data/fastretro-qa.db` (persistent) | `fast-retro/data/fastretro.db` |
| Lead token | `fast-retro-releases/qa-lead.token` | Scott's notes |

Google sign-in and GA4 are off on QA.

QA is public because Zo's private `*.zo.computer` proxy doesn't complete WebSocket upgrades: pages load, but `/ws` gets a `400` and boards stay on "Connecting...". Unreleased builds are therefore reachable by anyone with the URL, and QA's DB holds only test boards. Keep real user data off it.

`make release-status` shows what each environment runs, the retained builds and the last `release.log` lines. It's read-only and safe any time.

## Finding a build's CI run

```sh
gh run list --commit <full sha> --workflow build.yml
```

- **Still running:** `make qa-deploy` and `make release-fetch` wait up to 30 min for it.
- **Red:** don't deploy it. `gh run view <id> --log-failed` shows why, and a failed e2e run uploads its Playwright report as `e2e-report-<sha>`. Fix it on the branch. Rerun with `gh run rerun <id> --failed` only if the failure is clearly a flake.
- **Quick tier only:** it has no artifact. Add the `e2e` label on a PR. A `main` push always runs the full tier.

## Deploy to QA

1. Make sure CI built an artifact. Quick-tier runs don't upload one. For a PR (or a stack tip), add the label: `gh pr edit <n> --add-label e2e`. For `main`, the push run builds one.
2. Deploy:

   ```sh
   make qa-deploy PR=<n>            # a PR, or the tip of a stack
   make qa-deploy REF=origin/main   # main
   make qa-deploy SHA=<sha>         # a specific commit
   make qa-deploy BUILD=<id>        # a build already fetched
   ```

   This fetches and verifies the CI build (waits up to 30 min if the run is still going), smokes it against a copy of prod's DB on :5197, points `qa` at it, restarts `fast-retro-qa`, and verifies it (local checks with the lead token, token-free checks on the public URL including a WebSocket upgrade, then 60 s of the same PID and no `WARN`/`ERROR`/panic in the new log output). On success it records the QA deploy in the build's `LOCAL_INFO` and in `release.log`. If verify fails, it puts QA back on the previous build and exits non-zero.
3. Report back to Scott: the QA URL, the build id and sha, and the verify result. Scott clicks through QA.

### Fresh prod data on QA (`SEED=prod`, Scott's OK first)

```sh
make qa-deploy BUILD=<id> SEED=prod ALLOW_PUBLIC_SEED=1
```

This stops QA, moves its DB and its `-wal`/`-shm` aside together as `*.bak-<ts>` (kept), copies prod's DB in with SQLite's online backup (it only reads prod), runs `integrity_check`, then starts and verifies QA. This copies real user boards onto a public URL, so the script refuses without `ALLOW_PUBLIC_SEED=1`, and that needs Scott's go-ahead. Prefer testing on QA's own boards.

## Deploy to prod (Scott's go-ahead for every deploy)

The first scripted prod deploy hasn't happened yet, and `prod.prev` won't exist until it does. Do it with Scott watching: dry run, deploy, a deliberate `make rollback`, then redeploy (`release-plan.md` §5, PR 5). Delete this paragraph once that's done.

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

## Schema and client-compatibility rules

- **Migrations are additive only:** new tables, or `ADD COLUMN` that's nullable or has a default. No `NOT NULL` without a default, and no drops or renames, so the previous binary still works on a migrated DB. Smoke runs the rollback target against the migrated copy to check this.
- **Doc-model changes:** label a PR `doc-model-change` if it changes the Yjs board shape. Open tabs reconnect still running the old JS and keep writing the old shape, so `prod-deploy` for such a release needs zero live participants, and `FORCE=1` doesn't override that.

## Is anyone actually on a board?

The preflight counts connections, so an idle open tab blocks a deploy the same as someone working. To tell them apart:

- `boards.last_active_at` doesn't track edits, and its timestamps are in milliseconds.
- An open tab writes an identical no-op to `doc_updates` about every 15 s, so writes alone don't show activity.
- A board is idle when `count(distinct update_bin)` over its recent `doc_updates` is 1 and its `board_docs` snapshot isn't changing.

Report what you found to Scott. Whether to wait or use `FORCE=1` is Scott's call.

## Manual DB restore (Scott only)

**This loses data.** Everything written since the restore point is gone. A bad deploy normally needs a rollback, not this.

```sh
supervisorctl -c /etc/zo/supervisord-user.conf stop fast-retro-prod
cd /home/workspace/fast-retro/data
ts=$(date -u +%Y%m%dT%H%M%SZ)
for f in fastretro.db fastretro.db-wal fastretro.db-shm; do [ -e "$f" ] && mv "$f" "$f.pre-restore-$ts"; done
cp fastretro.db.bak-<restore point> fastretro.db
supervisorctl -c /etc/zo/supervisord-user.conf start fast-retro-prod
```

Move the DB and its `-wal` and `-shm` files together, and keep what you moved aside. Then check `curl -s localhost:5102/api/health` and `make release-status`.

## Break-glass local build (Scott's OK only)

Only for when GitHub is down and a deploy can't wait. These builds have no attestation.

```sh
make release-build-local REF=origin/main       # runs CI's gates locally, then builds in a clean worktree
make qa-deploy BUILD=<id>
make prod-deploy BUILD=<id> CONFIRM=<sha7> ALLOW_LOCAL_BUILD=1
```

## Manual fallback (the scripts themselves are broken)

Use this only with Scott's OK. It has no guards, smoke test or auto-rollback, so check each step yourself. Pick a build that's already in `builds/` and known to work; for a rollback, that's whatever `prod` pointed at before.

```sh
cd /home/workspace/fast-retro-releases
ts=$(date -u +%Y%m%dT%H%M%SZ)
sqlite3 -readonly ../fast-retro/data/fastretro.db ".backup '../fast-retro/data/fastretro.db.bak-$ts-manual'"
sqlite3 -readonly "../fast-retro/data/fastretro.db.bak-$ts-manual" 'PRAGMA integrity_check;'   # must print ok
ln -sfn "$(readlink prod)" .prod.prev.tmp && mv -T .prod.prev.tmp prod.prev   # only if you're changing builds
ln -sfn builds/<id> .prod.tmp && mv -T .prod.tmp prod
supervisorctl -c /etc/zo/supervisord-user.conf restart fast-retro-prod
curl -s localhost:5102/api/version                     # the sha you expect
curl -s -o /dev/null -w '%{http_code}\n' https://fast-retro.scottschmidt.io/api/health
```

Then append a line to `release.log` saying what you did, and tell Scott which build is live. Run `make release-status` to confirm both links.

## Drills on QA

`make qa-drill-deploy BUILD=<id> CONFIRM=<sha7>` and `make qa-drill-rollback [BUILD=<id> CONFIRM=<sha7>]` run the exact prod-deploy and rollback scripts against `fast-retro-qa` (`qa` / `qa.prev`, guard (c) skipped, restore points in `qa-data/`). Use them to try a change to the release scripts before it touches prod.

Only drills set `qa.prev`. `make qa-deploy` leaves it alone, so it may not be the build QA ran before, and `make qa-drill-rollback` goes to `qa.prev`, not to that build.

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
| `fast-retro-prod is FATAL after restart` (or `BACKOFF`) | The new binary won't stay up. `prod-deploy` restores the old build by itself. Read `/dev/shm/fast-retro-prod_err.log` and `logs/`, and confirm with `make release-status`. |
| `no prod link yet` | The one-time migration isn't done (`release-plan.md` §3 step 2). |

Never stop processes with `pkill -f` (it has matched our own shell before). Use `supervisorctl` or the PID.
