# Release tooling plan: QA and prod for fast-retro

Status: **proposal, awaiting Scott's review** · 2026-11-04 · author: Claude (SRE view)

Goal: one scripted, repeatable path for an agent to ship fast-retro to **QA** and then **prod**. Each step should be safe to rerun, roll back in one command, and leave an audit trail. Agents should follow a runbook instead of rebuilding the process from chat history each time.

This doc is written for the agent that implements it. Read "Current state" first; the design is shaped by what went wrong on 2026-11-02 and 2026-11-03.

---

## 1. Current state (as found 2026-11-04)

| Thing | Today |
|---|---|
| Prod process | Zo user service `fast-retro-prod` (`svc_OeivC8ngdHY`), supervisord program of the same name, port 5102, public, custom domain `fast-retro.scottschmidt.io`. |
| Prod entrypoint | `/home/workspace/fast-retro/target/release/fast-retro`, which is **inside the dev checkout**. Workdir `/home/workspace/fast-retro`. `FASTRETRO_DB` is unset, so it defaults to relative `data/fastretro.db`. |
| Prod env | `RETRO_LEAD_TOKEN`, `GOOGLE_CLIENT_ID`, `GA_MEASUREMENT_ID`, `PORT=5102`. Set on the Zo service, mirrored in `/etc/zo/supervisord-user.conf`. |
| Restart | `supervisorctl -c /etc/zo/supervisord-user.conf restart fast-retro-prod` works from bash. `stopsignal=TERM`, `stopwaitsecs=4`. The app has no SIGTERM handler, so restart is an abrupt kill. Data is still durable because every Yjs update is appended to `doc_updates` before it is broadcast. |
| Build | `./build.sh` = `bun run build` + `cargo build --release`, run in the dev checkout. Yesterday's deploys built in the checkout or a scratch copy, by hand. |
| DB backup | `cp data/fastretro.db data/fastretro.db.bak-<ts>` while the server runs. |
| Rollback | One level deep: `target/release/fast-retro.prev`, swapped by hand. |
| Smoke test | Ad hoc: start the candidate binary on a scratch port against a DB copy, curl `/`, check a WebSocket upgrade returns 101. |
| Deploy verification | Grepping the served `index.html` for the new bundle hashes. `/api/health` returns the literal `ok`, with no version info. |
| QA / preview | Ad hoc: a **debug** binary copied into a conversation scratch dir, started with `nohup` on :8617 against a scratch DB, exposed with a `bore` tunnel (plain HTTP, random public URL). |
| Gates | `cargo test`, `cargo clippy`, `bun run check`, `bun run test:unit`, `./test-local.sh` (e2e). Documented across README, `tests/README.md` and chat. No CI (`.github/` doesn't exist). |
| Monitoring | None for fast-retro. `zo-monitor` doesn't probe it. |

### Problems this plan fixes

1. **Backups aren't guaranteed consistent.** The DB is in WAL mode. Right now the main file is 272 KB and `fastretro.db-wal` is 4.0 MB. `cp` of only the main file while the server is writing can miss committed transactions still in the WAL, or catch a page mid-checkpoint. Yesterday's backup has 44 rows in `board_docs` against 45 live. That gap may just be a board created later, but nothing checked it. The fix is SQLite's online backup API (`sqlite3 <db> ".backup '<dest>'"`) plus `PRAGMA integrity_check` on the copy. The smoke tests also ran against these copies.
2. **Building can change what prod runs.** `cargo build --release` in the checkout overwrites the exact path supervisord starts. The running process keeps its old inode. But `autorestart=true`, so any crash or box reboot between "build" and "planned restart" starts an untested binary. The box rebooted about 2 hours before this was written. `test-local.sh` and `tests/README.md` carry warnings about this collision for the same reason.
3. **QA didn't test the artifact we shipped.** QA ran a debug build, and prod got a separately compiled release build. A debug build also reads the frontend from `frontend/build/` on disk (rust-embed's debug mode), so switching branches in the checkout silently changes what QA serves. A stale frontend bundle burned us twice yesterday.
4. **There's no version identity.** Neither we nor a script can ask the server "which commit are you?"
5. **QA isn't durable or private.** The bore URL is public over plain HTTP, changes every time, and dies with the box or the conversation. Twice, a `pkill -f <pattern>` used to stop the preview matched the agent's own shell.
6. **Rollback is manual and only one release deep.**
7. **Steps live in chat history**, so every release rediscovers them.

---

## 2. Target design

### 2.1 Principles

- **Build once, promote the same bytes.** QA and prod run the identical release binary. Prod never rebuilds what QA approved.
- **Artifacts are immutable and live outside the dev checkout.** Nothing an agent does in `fast-retro/` (branch switch, `./build.sh`, `./test-local.sh`) can change QA or prod.
- **Switch with a symlink and roll back with a symlink.** Releases are atomic `ln -sfn` swaps followed by a supervisor restart.
- **Prod deploys need an explicit, per-release confirmation** (see §2.5) and a recorded QA pass.
- **Never delete or truncate a `.db`.** Backups use the online backup API and are never auto-pruned (per the workspace rule).

### 2.2 Filesystem layout

```
/home/workspace/fast-retro-releases/          # not a git repo, never committed
  builds/<UTC-ts>-<sha7>/
      fast-retro                              # release binary (frontend embedded)
      BUILD_INFO                              # sha, tree hash, ref, built_at, rustc/bun versions, checks run
  prod      -> builds/<…>                     # symlink: what fast-retro-prod runs
  prod.prev -> builds/<…>                     # symlink: previous prod (rollback target)
  qa        -> builds/<…>                     # symlink: what fast-retro-qa runs
  qa-data/fastretro-qa.db                     # QA's own persistent DB
  worktree/                                   # git worktree the builds use (detached HEAD)
  cargo-target/                               # shared CARGO_TARGET_DIR (warm cache, not the dev checkout's target/)
  release.log                                 # append-only audit log, one line per action
  .lock                                       # flock: one release operation at a time
```

The prod DB stays where it is, at `/home/workspace/fast-retro/data/fastretro.db`. Backups also stay in `data/`, next to the DB, as the workspace rule requires. Name them `fastretro.db.bak-<ts>-pre-<sha7>`.

### 2.3 Environments

| | Local e2e | **QA** (new) | **Prod** |
|---|---|---|---|
| Runs | `cargo run` (debug) via `./test-local.sh` | `fast-retro-releases/qa/fast-retro` | `fast-retro-releases/prod/fast-retro` |
| Managed by | the script, torn down on exit | Zo user service `fast-retro-qa` | Zo user service `fast-retro-prod` |
| Port | 5199 | 5103 | 5102 |
| URL | localhost only | `https://fast-retro-qa-5cotts.zo.computer` (**private**, Scott must be signed in) | `https://fast-retro.scottschmidt.io` |
| DB | temp file, deleted | `qa-data/fastretro-qa.db` (persistent; optional reseed from a prod backup) | `fast-retro/data/fastretro.db` |
| Lead token | `dev-token` | its own token, set as a service env var | prod token (service env var) |
| Google sign-in | off | off by default (Q3) | on |
| GA4 | off | **off**, so QA clicks stay out of prod analytics | on |

Because QA is a supervised service, it survives reboots and has a stable URL. It goes through Zo's HTTPS proxy, which already carries WebSockets for prod, so QA needs no tunnel.

### 2.4 Version stamping (small code change)

- At build time the script exports `FASTRETRO_GIT_SHA`, `FASTRETRO_GIT_TREE` and `FASTRETRO_BUILT_AT`. The binary reads them with `option_env!`, falling back to `"dev"`.
- Add **`GET /api/version`**, which returns `{"sha":"f952b1d","tree":"…","built_at":"…"}`.
- **`/api/health` stays exactly `ok`.** Changing its body could break existing checks and tests for no gain.
- Log the version on the startup banner line too.

### 2.5 Command surface

There is no Makefile in `fast-retro/` yet. Add one, since `make` targets are the workspace convention for entry points. The targets are thin wrappers over `scripts/release/*.sh`, which share a `lib.sh`. Every command is safe to rerun and supports `DRY_RUN=1`, which prints what it would do.

| Command | What it does |
|---|---|
| `make release-check [REF=…]` | Runs every gate against the exact commit: `cargo clippy` (no new warnings beyond a recorded baseline), `cargo test`, `bun run check`, `bun run test:unit`, `./test-local.sh`. Writes the results into `BUILD_INFO` if a build for that sha exists. |
| `make release-build [REF=origin/main]` | Resolves REF to a sha and checks out the worktree there, detached and clean. Runs `bun install --frozen-lockfile`, `bun run build`, then `cargo build --release` with the version env vars and the shared target dir. Copies the binary to `builds/<ts>-<sha7>/` and writes `BUILD_INFO`. If a build for that sha already exists, it is a no-op. |
| `make qa-deploy [BUILD=<id> \| REF=…] [SEED=prod]` | Builds if needed, then runs `smoke` on it. `SEED=prod` replaces the QA DB with a fresh consistent prod backup; the old QA DB is kept as a `.bak`. Points the `qa` symlink at the build, restarts `fast-retro-qa`, runs `verify qa`, and records "QA'd" in `BUILD_INFO` and `release.log`. |
| `make prod-deploy BUILD=<id> CONFIRM=<sha7>` | Runs the full prod sequence in §2.6. Refuses unless all three hold: (a) `CONFIRM` matches the build's sha, (b) the build was QA'd, (c) the build's **git tree hash equals `origin/main`'s tree**. Condition (c) is what lets us QA a PR stack tip, merge it, and promote the same binary without a rebuild, which we checked by hand yesterday. |
| `make rollback [CONFIRM=<sha7 of prod.prev>]` | Points `prod` at `prod.prev` (and `prod.prev` at what was `prod`), restarts, runs `verify prod`. Never touches the DB. |
| `make release-status` | Shows the sha and build for prod, prev and QA, live `/api/version` from both services, service uptime, the latest 3 backups with sizes, and the last 10 `release.log` lines. |
| `make smoke BUILD=<id>` | Takes a consistent backup of prod, starts the build on a scratch port (5197) against a **copy** of it, runs the checks in §2.7, and tears down by PID (never by pattern). |
| `make release-prune` | Removes `builds/` entries that are older than the newest 5 and are not prod, prev or QA. **It never deletes DB backups.** It lists them and leaves the decision to Scott. |

### 2.6 `prod-deploy` sequence

```
1. lock          flock fast-retro-releases/.lock (fail fast if held)
2. guard         CONFIRM, QA'd, tree == origin/main tree (see 2.5)
3. preflight     prod healthy now; disk free > 1 GB;
                 activity check: newest doc_updates.created_at / board_docs.updated_at
                 within 15 min → stop and report ("people may be mid-retro"), unless FORCE=1
4. backup        sqlite3 data/fastretro.db ".backup 'data/fastretro.db.bak-<ts>-pre-<sha7>'"
                 + PRAGMA integrity_check on the copy == ok
5. smoke         candidate binary vs a copy of that backup on :5197 (§2.7)
6. swap          ln -sfn prod → prod.prev ; ln -sfn builds/<id> → prod  (atomic renames)
7. restart       supervisorctl restart fast-retro-prod
8. verify        §2.7 against https://fast-retro.scottschmidt.io, plus /api/version.sha == build sha,
                 plus 60 s with no new lines in /dev/shm/fast-retro-prod_err.log and no restart loop
9. on failure    automatic rollback (step 6 reversed + restart + verify), exit non-zero
10. record       release.log line: ts, actor, from_sha → to_sha, backup path, result
```

### 2.7 Smoke and verify checks (shared)

- `GET /api/health` returns `200 ok`.
- `GET /api/version`: sha matches the expected build.
- `GET /` returns 200, and the `<script type="module">` entry in the served HTML matches the build's `frontend/build/index.html`. This catches a stale embedded bundle.
- One hashed JS asset from that HTML returns 200 with the right content type.
- A WebSocket upgrade on an **existing** board slug returns `101`, then the client closes without sending updates. It is read-only. Pick the slug from the DB: `/ws` creates a room for an unknown slug, so a made-up slug would write.
- `GET /api/lead-token-check/<token>` returns 200 with the real token and 403 with a bogus one. Read the token from the service env and never print it.
- `GET /api/archives` returns 403 without the lead token (the expected auth check, which looked like a failure in yesterday's ad hoc smoke test). With the token it returns 200, and its row count is ≥ the count in the backup.

### 2.8 Guardrails baked into `lib.sh`

- Stop processes only by PID file or `supervisorctl`, **never `pkill -f`**.
- Never read or print `/etc/zo/supervisord-user.conf` env lines or token values. The scripts get the lead token for smoke and verify from `/proc/<pid>/environ` of the service process and pass it on without echoing it.
- Never write to `/home/workspace/fast-retro/target/` or the prod DB, except through `.backup`, which only reads it.
- Use `set -euo pipefail`, plus a trap that releases the lock and kills scratch servers.
- Every destructive step (symlink swap, restart, QA reseed) goes through a single `run` helper that honors `DRY_RUN` and logs.

---

## 3. One-time setup steps (agent, via Zo tools, not scripts)

Zo owns the supervisor config, so service changes go through Zo's service tools. Nobody edits `/etc/zo/supervisord-user.conf` directly.

1. **Create QA:** `register_user_service(label="fast-retro-qa", mode="http", local_port=5103, public="false", entrypoint="/home/workspace/fast-retro-releases/qa/fast-retro", workdir="/home/workspace/fast-retro-releases", env_vars={RETRO_LEAD_TOKEN: <new random>, FASTRETRO_DB: "/home/workspace/fast-retro-releases/qa-data/fastretro-qa.db", PORT: "5103"})`.
2. **Migrate prod's entrypoint** (scheduled with Scott, during a quiet window):
   - Seed `builds/` with the **current** prod binary (`target/release/fast-retro`, the sha deployed 2026-11-04 02:37Z) as the first build. Point `prod` and `prod.prev` at it.
   - Run `update_user_service(svc_OeivC8ngdHY, entrypoint="/home/workspace/fast-retro-releases/prod/fast-retro", env_vars=<existing> + FASTRETRO_DB="/home/workspace/fast-retro/data/fastretro.db")`. Leave workdir unchanged.
   - Verify that the same binary, the same DB, `/` and the WebSocket all respond.
   - **Rollback for the migration itself:** set the entrypoint back to `target/release/fast-retro`, which stays in place until the first scripted deploy succeeds.
3. Confirm `supervisorctl restart fast-retro-prod` (what the script uses) doesn't conflict with Zo's own management. If it does, the script falls back to the documented `update_user_service(service_id)` restart and tells the agent to run it.

---

## 4. Documentation deliverables

- **`docs/RELEASING.md`**, the runbook agents follow. It covers:
  - the normal flow: QA a PR branch, Scott QAs, merge, promote to prod;
  - what needs Scott's explicit go-ahead (any `prod-deploy`, `rollback`, `FORCE=1`, `SEED=prod`);
  - what to report back (QA URL, version, backup path, verify result);
  - a troubleshooting table (lock held, preflight activity, verify failure, auto-rollback fired);
  - a **manual fallback** section with the raw commands, if the scripts themselves are broken.
- **README "Deploying" section:** keep the generic self-host instructions and add a pointer to `RELEASING.md` for this deployment.
- **`tests/README.md` / `test-local.sh` comments:** once prod no longer runs from `target/release`, soften the collision warnings and keep the advice to use scratch ports and DBs.
- **Workspace `AGENTS.md`:** replace the inline deploy recipe in the fast-retro line with "release via `make qa-deploy` / `make prod-deploy`; see `docs/RELEASING.md`".
- **`Skills/fast-retro-release/SKILL.md`** (thin): its description triggers on "deploy / release / preview / QA fast-retro" and its body points at `RELEASING.md`. Skills appear in every agent's context, which makes them the most reliable way for a future agent to find the runbook.

---

## 5. Rollout: stacked PRs

Each PR is small, keeps prod working on its own, and is merged and verified before the next starts.

| PR | Scope | Prod impact | How it's tested |
|---|---|---|---|
| **1. `/api/version` + build stamping** | `option_env!` constants, route, startup log line, Rust unit test for the route; `build.sh` exports the env vars. | Needs one deploy, done the **current manual way**, after which prod reports its sha. | `cargo test`; e2e suite unchanged. |
| **2. Release lib, build, backup, status, smoke** | `Makefile`, `scripts/release/{lib,build,check,smoke,status,backup}.sh`, `fast-retro-releases/` bootstrap. | None, because nothing points at `fast-retro-releases/` yet. | `shellcheck`. `cargo fmt --check` fails on `main` today, so either format the code in this PR or leave fmt out of `release-check`. Build twice to show it's idempotent. Run `smoke` on the build. Verify that a backup's `integrity_check` returns ok and its row counts match live. |
| **3. QA environment** | `qa-deploy`, `fast-retro-qa` service (setup step 1), QA section of the runbook. | None. | Deploy `main` to QA. Scott clicks through it. Reseed with `SEED=prod`. Reboot test: `supervisorctl restart` QA and confirm it comes back on the same build. |
| **4. Prod migration + `prod-deploy` / `rollback`** | Setup step 2, `prod-deploy.sh`, `rollback.sh`, auto-rollback. | **Yes**: one restart for the migration, scheduled with Scott. | Before prod: a rollback drill on QA (deploy A → B → rollback → A). First real prod deploy with Scott watching, a `DRY_RUN=1` pass first, then a deliberate `make rollback` and redeploy to prove the round trip. |
| **5. Docs + skill** | `RELEASING.md`, README, `tests/README.md`, workspace `AGENTS.md`, `Skills/fast-retro-release/`. | None. | A fresh agent session, given only "deploy main to QA", finds and follows the runbook. |

Estimate: PRs 1–3 are about one working session. PR 4 needs a scheduled window with Scott.

---

## 6. Decisions for Scott

| # | Question | Recommendation |
|---|---|---|
| Q1 | QA visibility: **private** (only you, signed into Zo) or **public** (so you can send Valentina a link to unreleased builds)? | Private. Unreleased builds and seeded prod data stay off the internet. If you need to share, send a public link to prod after release. |
| Q2 | QA data: its own persistent DB, with `SEED=prod` on request, or a fresh copy of prod on every QA deploy? | Persistent, reseed on request. Your QA boards survive between deploys, and prod data (real names on non-anonymous boards) is only copied when you ask. |
| Q3 | Google sign-in on QA: add the QA origin to the Google OAuth client (you'd do this in Google Cloud Console), or leave it off? | Off at first. Turn it on only when a release changes the auth flow. |
| Q4 | Must every prod deploy go through QA first? | Yes. The only escape is `SKIP_QA=1` for an urgent hotfix, and it needs your explicit OK. |

## 7. Out of scope (worth a follow-up)

- **Uptime monitoring:** add fast-retro (`/api/health` and the custom domain) to the `zo-monitor` daily digest.
- **Graceful shutdown:** a SIGTERM handler that compacts boards and closes sockets cleanly, and raise `stopwaitsecs`. Restarts are safe today, so this is polish.
- **CI:** a GitHub Actions run of `release-check` on PRs. The local gates are enough for one maintainer.
- **Off-box backups:** the backups currently sit on the same disk as the DB.
