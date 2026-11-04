# shellcheck shell=bash
# Constants here are used by the scripts that source this file.
# shellcheck disable=SC2034
# Shared helpers for scripts/release/*.sh. Sourced, never executed.
# Design and rationale: docs/release-plan.md (§2.2 layout, §2.7 checks,
# §2.8 guardrails). Keep every guardrail here so each script gets it.

set -euo pipefail

export PATH="${HOME}/.cargo/bin:${PATH}"

readonly REPO_SLUG="5cotts/fast-retro"
readonly WORKFLOW_PATH=".github/workflows/build.yml"
readonly SIGNER_WORKFLOW="${REPO_SLUG}/${WORKFLOW_PATH}"

# The dev checkout. Only used for `git fetch` / `git worktree`; nothing here
# builds into it or writes to its target/ dir.
REPO_DIR="${FASTRETRO_REPO:-/home/workspace/fast-retro}"
RELEASE_ROOT="${RELEASE_ROOT:-/home/workspace/fast-retro-releases}"
readonly REPO_DIR RELEASE_ROOT
readonly BUILDS_DIR="${RELEASE_ROOT}/builds"
readonly RELEASE_LOG="${RELEASE_ROOT}/release.log"

# Live databases. Scratch servers must never resolve to either of these.
readonly PROD_DB="/home/workspace/fast-retro/data/fastretro.db"
readonly QA_DB="${RELEASE_ROOT}/qa-data/fastretro-qa.db"

readonly PROD_PORT=5102
readonly QA_PORT=5103
readonly SMOKE_PORT=5197
readonly PROD_SERVICE="fast-retro-prod"
readonly QA_SERVICE="fast-retro-qa"
readonly SUPERVISOR_CONF="/etc/zo/supervisord-user.conf"
readonly CANARY_SLUG="zz-release-canary"

# ---------------------------------------------------------------- output

log()  { printf 'release: %s\n' "$*" >&2; }
warn() { printf 'release: WARNING: %s\n' "$*" >&2; }
die()  { printf 'release: ERROR: %s\n' "$*" >&2; exit 1; }

# "1", "true", "yes" are on; empty, "0", "false", "no" are off. (A bare
# non-empty check would treat DRY_RUN=0 as on.)
is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    ""|0|false|FALSE|no|NO|off|OFF) return 1 ;;
    *) die "expected a boolean, got '${1}'" ;;
  esac
}

now_ts()  { date -u +%Y%m%dT%H%M%SZ; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Every destructive step goes through here so DRY_RUN=1 covers it.
run() {
  if is_true "${DRY_RUN:-}"; then
    log "DRY_RUN: $*"
    return 0
  fi
  "$@"
}

# One line per action in release.log: ts, actor, action, then key=value
# fields. Append-only; never rewritten.
audit() {
  local action="$1"; shift
  if is_true "${DRY_RUN:-}"; then
    log "DRY_RUN: audit ${action} $*"
    return 0
  fi
  printf '%s\t%s\t%s\t%s\n' "$(now_iso)" "${RELEASE_ACTOR:-agent}" "$action" "$*" >> "$RELEASE_LOG"
}

# ---------------------------------------------------------------- layout, lock, cleanup

ensure_layout() {
  mkdir -p "$BUILDS_DIR" "${RELEASE_ROOT}/logs" "${RELEASE_ROOT}/qa-data"
  touch "$RELEASE_LOG"
}

CLEANUP_FNS=()
add_cleanup() { CLEANUP_FNS+=("$1"); }
_on_exit() {
  local rc=$? fn
  for (( i=${#CLEANUP_FNS[@]}-1; i>=0; i-- )); do
    fn="${CLEANUP_FNS[$i]}"
    "$fn" || warn "cleanup step ${fn} failed"
  done
  exit "$rc"
}
trap _on_exit EXIT

# One release operation at a time. Held on fd 9 for the life of the script;
# the kernel drops it on exit. Child scripts inherit RELEASE_LOCK_HELD and
# don't try to take it again. Children we launch close fd 9 (9>&-), so an
# orphaned server can't keep it held.
acquire_lock() {
  if [[ "${RELEASE_LOCK_HELD:-}" == 1 ]]; then
    return 0
  fi
  ensure_layout
  exec 9> "${RELEASE_ROOT}/.lock"
  flock -n 9 || die "another release operation holds ${RELEASE_ROOT}/.lock; wait for it to finish"
  export RELEASE_LOCK_HELD=1
}

# ---------------------------------------------------------------- refs and builds

# Resolve PR=<n> | SHA=<sha> | REF=<ref> (default origin/main) to a full sha.
resolve_sha() {
  local pr="${PR:-}" sha="${SHA:-}" ref="${REF:-}"
  local n=0
  [[ -n "$pr" ]] && n=$((n+1)); [[ -n "$sha" ]] && n=$((n+1)); [[ -n "$ref" ]] && n=$((n+1))
  (( n <= 1 )) || die "pass only one of PR=, SHA=, REF="

  if [[ -n "$pr" ]]; then
    [[ "$pr" =~ ^[0-9]+$ ]] || die "PR must be a number, got '$pr'"
    local info
    info="$(gh pr view "$pr" -R "$REPO_SLUG" --json headRefOid,isCrossRepository)"
    [[ "$(jq -r .isCrossRepository <<<"$info")" == false ]] \
      || die "PR #$pr is from a fork; fork builds are never deployable"
    jq -r .headRefOid <<<"$info"
    return 0
  fi

  git -C "$REPO_DIR" fetch --quiet origin >&2 || die "git fetch origin failed in $REPO_DIR"
  local want="${sha:-${ref:-origin/main}}"
  if [[ -n "$sha" && ! "$sha" =~ ^[0-9a-f]{7,40}$ ]]; then
    die "SHA must be hex, got '$sha'"
  fi
  git -C "$REPO_DIR" rev-parse --verify --quiet "${want}^{commit}" \
    || die "can't resolve '$want' to a commit (after git fetch origin)"
}

valid_build_id() { [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}$ ]]; }

build_dir() {
  local id="$1"
  valid_build_id "$id" || die "not a build id: '$id' (expected <UTC-ts>-<sha7>, see make release-status)"
  [[ -d "${BUILDS_DIR}/${id}" ]] || die "no such build: ${BUILDS_DIR}/${id}"
  printf '%s\n' "${BUILDS_DIR}/${id}"
}

info_get() { jq -er --arg k "$2" '.[$k] // empty' "$1/BUILD_INFO"; }

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# A build is intact when its files exist and match the hashes in BUILD_INFO.
# Prints the reason and returns 1 otherwise. Never modifies anything.
build_intact() {
  local dir="$1" f src
  for f in BUILD_INFO fast-retro index.html; do
    [[ -f "$dir/$f" ]] || { log "$dir: missing $f"; return 1; }
  done
  jq -e . "$dir/BUILD_INFO" > /dev/null 2>&1 || { log "$dir: BUILD_INFO isn't valid JSON"; return 1; }
  src="$(info_get "$dir" source || true)"
  case "$src" in
    ci|local|seeded) ;;
    *) log "$dir: unknown source '$src'"; return 1 ;;
  esac
  [[ "$(sha256_of "$dir/fast-retro")" == "$(info_get "$dir" binary_sha256 || true)" ]] \
    || { log "$dir: fast-retro sha256 doesn't match BUILD_INFO"; return 1; }
  if [[ "$src" != seeded ]]; then
    [[ "$(sha256_of "$dir/index.html")" == "$(info_get "$dir" index_sha256 || true)" ]] \
      || { log "$dir: index.html sha256 doesn't match BUILD_INFO"; return 1; }
  fi
  [[ -x "$dir/fast-retro" ]] || { log "$dir: fast-retro isn't executable"; return 1; }
}

# Build ids (newest first) whose BUILD_INFO has this sha and source.
builds_for_sha() {
  local sha="$1" source="$2" dir
  [[ -d "$BUILDS_DIR" ]] || return 0
  while IFS= read -r dir; do
    [[ -f "$dir/BUILD_INFO" ]] || continue
    if [[ "$(jq -r .sha "$dir/BUILD_INFO" 2>/dev/null)" == "$sha" \
       && "$(jq -r .source "$dir/BUILD_INFO" 2>/dev/null)" == "$source" ]]; then
      basename "$dir"
    fi
  done < <(find "$BUILDS_DIR" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort -r)
}

# Verify the binary's attestation was signed by our workflow, on a
# GitHub-hosted runner, in the exact run we downloaded it from. The
# certificate's source digest is GitHub's synthetic merge commit for PR
# runs, so the run id (whose head sha we check via the API) is the binding.
verify_attestation() {
  local bin="$1" run_id="$2" out
  out="$(gh attestation verify "$bin" -R "$REPO_SLUG" \
          --signer-workflow "$SIGNER_WORKFLOW" \
          --deny-self-hosted-runners --format json 2>/dev/null)" \
    || { log "gh attestation verify failed for $bin"; return 1; }
  jq -e --arg run "/actions/runs/${run_id}/attempts/" \
    'any(.[]; .verificationResult.signature.certificate.runInvocationURI | contains($run))' \
    <<<"$out" > /dev/null \
    || { log "attestation for $bin wasn't made by run ${run_id}"; return 1; }
}

# ---------------------------------------------------------------- databases

db_counts() {
  sqlite3 -readonly "$1" \
    "SELECT 'boards=' || (SELECT count(*) FROM boards) || ' board_docs=' || (SELECT count(*) FROM board_docs) || ' archives=' || (SELECT count(*) FROM archives);"
}

# Consistent online copy of a live WAL-mode DB (a plain cp can miss
# committed transactions still in the -wal), then integrity_check the copy.
# Only reads the source. Refuses to overwrite anything.
db_backup() {
  local src="$1" dest="$2" result
  [[ -f "$src" ]] || die "no database at $src"
  [[ ! -e "$dest" && ! -e "$dest-wal" ]] || die "refusing to overwrite $dest"
  [[ "$dest" != *"'"* ]] || die "backup path can't contain a single quote"
  sqlite3 -readonly "$src" ".backup '$dest'"
  result="$(sqlite3 -readonly "$dest" 'PRAGMA integrity_check;')"
  [[ "$result" == ok ]] || die "integrity_check on $dest returned: $result"
}

# ---------------------------------------------------------------- scratch servers

strip_ansi() { sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g'; }

# Start a binary as a scratch server on SMOKE_PORT. It runs from its own
# working directory, with an explicit clean env, so nothing can make it
# resolve to prod's port or DB. Sets SCRATCH_PID.
SCRATCH_PID=""
start_scratch() {
  local bin="$1" workdir="$2" db="$3" token="$4" logfile="$5"
  local port="$SMOKE_PORT"

  [[ "$db" == /* ]] || die "scratch FASTRETRO_DB must be absolute: $db"
  local real_db real_prod real_qa
  real_db="$(realpath -m "$db")"
  real_prod="$(realpath -m "$PROD_DB")"
  real_qa="$(realpath -m "$QA_DB")"
  [[ "$real_db" != "$real_prod" && "$real_db" != "$real_qa" ]] \
    || die "refusing to start a scratch server on a live DB: $db"
  [[ "$port" != "$PROD_PORT" && "$port" != "$QA_PORT" ]] \
    || die "refusing to start a scratch server on a deployed port: $port"
  # ss falls back to /proc/net on gVisor and prints a netlink warning;
  # hide the warning but still fail if ss itself fails.
  local listeners
  listeners="$(ss -Hltn "sport = :$port" 2>/dev/null)" || die "ss failed; can't check port $port"
  [[ -z "$listeners" ]] || die "port $port is already in use; is another smoke run going?"

  ( cd "$workdir" && exec env -i \
      PATH="/usr/bin:/bin" HOME="$HOME" \
      PORT="$port" FASTRETRO_DB="$db" RETRO_LEAD_TOKEN="$token" COOKIE_SECURE=0 \
      "$bin" ) > "$logfile" 2>&1 9>&- &
  SCRATCH_PID=$!

  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/health" > /dev/null 2>&1; then
      break
    fi
    kill -0 "$SCRATCH_PID" 2>/dev/null || { cat "$logfile" >&2; die "scratch server exited during startup"; }
    sleep 0.5
    (( i < 60 )) || { cat "$logfile" >&2; die "scratch server didn't answer on :$port within 30s"; }
  done
  # The process answering must be the one we started, not a stray.
  listeners="$(ss -Hltnp "sport = :$port" 2>/dev/null)" || die "ss failed; can't check port $port"
  grep -q "pid=${SCRATCH_PID}," <<<"$listeners" \
    || die "something other than PID $SCRATCH_PID is listening on :$port"
}

stop_scratch() {
  [[ -n "$SCRATCH_PID" ]] || return 0
  if kill -0 "$SCRATCH_PID" 2>/dev/null; then
    kill "$SCRATCH_PID" 2>/dev/null || true
    local i
    for i in $(seq 1 20); do
      kill -0 "$SCRATCH_PID" 2>/dev/null || break
      sleep 0.25
    done
    kill -0 "$SCRATCH_PID" 2>/dev/null && kill -9 "$SCRATCH_PID" 2>/dev/null
  fi
  wait "$SCRATCH_PID" 2>/dev/null || true
  SCRATCH_PID=""
}

random_token() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# ---------------------------------------------------------------- checks (§2.7)

CHECK_FAILS=0
_pass() { printf '  ok    %s\n' "$*" >&2; }
_fail() { printf '  FAIL  %s\n' "$*" >&2; CHECK_FAILS=$((CHECK_FAILS+1)); }

# The token goes to curl through a header file (process substitution), so it
# never appears in a process's argv.
_curl_auth() {
  local token="$1"; shift
  curl -sS --max-time 10 -H @<(printf 'Authorization: Bearer %s\n' "$token") "$@"
}

ws_status() {
  local base="$1"
  curl -sS --http1.1 --max-time 3 -o /dev/null -w '%{http_code}' \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: ZmFzdC1yZXRyby1zbW9rZQ==' \
    "${base}/ws?board=${CANARY_SLUG}" 2>/dev/null || true
}

# check_instance <label> <base-url> <build-dir> [token] [pid] [log] [db] [min-archives]
# Runs the shared checks; leaves the failure count in CHECK_FAILS.
check_instance() {
  local label="$1" base="$2" dir="$3" token="${4:-}" pid="${5:-}" logfile="${6:-}" db="${7:-}" min_archives="${8:-0}"
  local want_sha body code ctype html entries first n
  want_sha="$(info_get "$dir" sha)"
  CHECK_FAILS=0
  log "checks: ${label} at ${base}"

  body="$(curl -sS --max-time 10 -w $'\n%{http_code}' "${base}/api/health" 2>/dev/null || true)"
  [[ "$body" == $'ok\n200' ]] && _pass "GET /api/health = 200 ok" || _fail "GET /api/health: $(tr '\n' ' ' <<<"$body")"

  body="$(curl -sS --max-time 10 "${base}/api/version" 2>/dev/null || true)"
  if [[ "$(jq -r .sha <<<"$body" 2>/dev/null)" == "$want_sha" ]]; then
    _pass "/api/version sha = ${want_sha:0:7}"
  else
    _fail "/api/version: expected sha ${want_sha:0:7}, got: $body"
  fi

  if [[ -n "$logfile" && -n "$db" ]]; then
    if strip_ansi < "$logfile" | grep -qF "database: $(realpath -m "$db")"; then
      _pass "startup log shows database $(realpath -m "$db")"
    else
      _fail "startup log doesn't show database $(realpath -m "$db")"
    fi
  fi

  if [[ -n "$pid" ]]; then
    local exe
    exe="$(readlink "/proc/${pid}/exe" 2>/dev/null || true)"
    if [[ "$exe" == "$(realpath "$dir/fast-retro")" ]]; then
      _pass "PID $pid runs $(realpath "$dir/fast-retro")"
    else
      _fail "PID $pid runs '${exe}', expected $(realpath "$dir/fast-retro")"
    fi
  fi

  html="$(curl -sS --max-time 10 -w $'\n%{http_code}' "${base}/" 2>/dev/null || true)"
  code="$(tail -n1 <<<"$html")"
  html="$(sed '$d' <<<"$html")"
  entries="$(grep -oE '/_app/immutable/entry/[A-Za-z0-9._-]+\.js' "$dir/index.html" | sort -u)"
  if [[ "$code" != 200 ]]; then
    _fail "GET / = $code"
  elif [[ -z "$entries" ]]; then
    _fail "no /_app/immutable/entry/*.js in $dir/index.html"
  else
    n=0
    while read -r e; do grep -qF "$e" <<<"$html" || n=$((n+1)); done <<<"$entries"
    (( n == 0 )) && _pass "GET / = 200, entry scripts match the build's index.html" \
                 || _fail "GET / serves different entry scripts than $dir/index.html"
    first="$(head -n1 <<<"$entries")"
    read -r code ctype < <(curl -sS --max-time 10 -o /dev/null -w '%{http_code} %{content_type}\n' "${base}${first}" 2>/dev/null || echo "000 -")
    [[ "$code" == 200 && "$ctype" == *javascript* ]] && _pass "GET ${first} = 200 ${ctype}" \
                                                     || _fail "GET ${first} = ${code} ${ctype}"
  fi

  code="$(ws_status "$base")"
  [[ "$code" == 101 ]] && _pass "WebSocket on ${CANARY_SLUG} = 101" || _fail "WebSocket on ${CANARY_SLUG} = ${code:-none}"

  if [[ -n "$token" ]]; then
    local route
    for route in /api/archives /api/boards; do
      body="$(_curl_auth "$token" -w $'\n%{http_code}' "${base}${route}" 2>/dev/null || true)"
      code="$(tail -n1 <<<"$body")"
      if [[ "$code" != 200 ]]; then
        _fail "GET ${route} with lead token = $code"
      elif [[ "$route" == /api/archives ]]; then
        n="$(sed '$d' <<<"$body" | jq length 2>/dev/null || echo -1)"
        (( n >= min_archives )) && _pass "GET ${route} with lead token = 200 (${n} archives, backup had ${min_archives})" \
                                || _fail "GET ${route} returned ${n} archives, backup had ${min_archives}"
      else
        _pass "GET ${route} with lead token = 200"
      fi
      code="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "${base}${route}" 2>/dev/null || true)"
      [[ "$code" == 403 ]] && _pass "GET ${route} without token = 403" || _fail "GET ${route} without token = $code"
    done
  fi

  (( CHECK_FAILS == 0 ))
}

# ---------------------------------------------------------------- supervisor

# "<STATE> <PID> <UPTIME>" for a service, or "ABSENT - -".
service_state() {
  local line
  line="$(supervisorctl -c "$SUPERVISOR_CONF" status "$1" 2>/dev/null || true)"
  if [[ -z "$line" || "$line" == *"no such process"* || "$line" == *ERROR* ]]; then
    echo "ABSENT - -"
    return 0
  fi
  local state pid uptime
  state="$(awk '{print $2}' <<<"$line")"
  pid="$(sed -nE 's/.*pid ([0-9]+).*/\1/p' <<<"$line")"
  uptime="$(sed -nE 's/.*uptime ([0-9:]+( days?, [0-9:]+)?).*/\1/p' <<<"$line")"
  uptime="${uptime// /_}"
  echo "${state} ${pid:--} ${uptime:--}"
}

# ---------------------------------------------------------------- worktree (release-check, break-glass builds)

readonly WORKTREE="${RELEASE_ROOT}/worktree"
readonly CARGO_TARGET="${RELEASE_ROOT}/cargo-target"

# A clean, detached checkout of <sha> outside the dev checkout, so local
# gates and break-glass builds never see uncommitted files and never write
# to fast-retro/target. node_modules are kept between runs for speed;
# `bun install --frozen-lockfile` still pins them to the lockfiles.
prepare_worktree() {
  local sha="$1"
  if [[ ! -e "${WORKTREE}/.git" ]]; then
    git -C "$REPO_DIR" worktree prune
    git -C "$REPO_DIR" worktree add --detach "$WORKTREE" "$sha" >&2
  else
    git -C "$WORKTREE" checkout --quiet --detach --force "$sha"
    git -C "$WORKTREE" clean -fdxq -e node_modules -e frontend/node_modules
  fi
  [[ "$(git -C "$WORKTREE" rev-parse HEAD)" == "$sha" ]] || die "worktree isn't at ${sha}"
  [[ -z "$(git -C "$WORKTREE" status --porcelain)" ]] || die "worktree at ${sha} isn't clean"
}

# ---------------------------------------------------------------- environments, swap, verify (§2.6, §2.7)

# env_get <qa|prod> <field>: service, port, link, db, log, url.
env_get() {
  case "$1:$2" in
    qa:service)   echo "$QA_SERVICE" ;;
    qa:port)      echo "$QA_PORT" ;;
    qa:link)      echo qa ;;
    qa:db)        echo "$QA_DB" ;;
    qa:log)       echo "/dev/shm/${QA_SERVICE}.log" ;;
    qa:url)       echo "$QA_URL" ;;
    prod:service) echo "$PROD_SERVICE" ;;
    prod:port)    echo "$PROD_PORT" ;;
    prod:link)    echo prod ;;
    prod:db)      echo "$PROD_DB" ;;
    prod:log)     echo "/dev/shm/${PROD_SERVICE}.log" ;;
    prod:url)     echo "$PROD_URL" ;;
    *) die "env_get: unknown '$1:$2'" ;;
  esac
}

readonly QA_URL="https://fast-retro-qa-5cotts.zo.computer"
readonly PROD_URL="https://fast-retro.scottschmidt.io"

# Absolute build dir a symlink in RELEASE_ROOT points at, or empty.
link_build() {
  local l="${RELEASE_ROOT}/$1"
  [[ -L "$l" ]] && realpath "$l" || true
}

# Atomically point RELEASE_ROOT/<link> at <build-dir> (relative target, so
# the release root can be inspected from anywhere). rename(2) via mv -T.
swap_link() {
  local link="$1" dir="$2"
  local rel
  rel="builds/$(basename "$dir")"
  [[ -d "${RELEASE_ROOT}/${rel}" ]] || die "swap_link: ${rel} doesn't exist"
  run ln -sfn "$rel" "${RELEASE_ROOT}/.${link}.tmp"
  run mv -T "${RELEASE_ROOT}/.${link}.tmp" "${RELEASE_ROOT}/${link}"
}

# Restore a link to what it was before a swap ("" = it didn't exist).
restore_link() {
  local link="$1" prev="$2"
  if [[ -n "$prev" ]]; then
    swap_link "$link" "$prev"
  else
    run rm -f "${RELEASE_ROOT}/${link}"
  fi
}

# The service's lead token, read from its process env. Printed to stdout
# for capture into a variable only; never log it.
service_token() {
  local pid="$1"
  [[ -r "/proc/${pid}/environ" ]] || return 1
  tr '\0' '\n' < "/proc/${pid}/environ" | sed -n 's/^RETRO_LEAD_TOKEN=//p' | head -n1
}

log_size() { stat -c %s "$1" 2>/dev/null || echo 0; }

# New bytes of a service log since <offset> (from 0 if the log rotated).
log_since() {
  local file="$1" offset="$2"
  [[ -f "$file" ]] || return 0
  (( $(log_size "$file") >= offset )) || offset=0
  tail -c +"$((offset + 1))" "$file" | strip_ansi
}

redact() { sed -E 's/(token|Bearer)[=: ]+[A-Za-z0-9._-]{8,}/\1 [redacted]/Ig'; }

# supervisorctl restart, then wait until RUNNING with a PID. FATAL/BACKOFF or
# a non-zero exit is a failure. Prints the new PID.
restart_service() {
  local service="$1" state pid uptime i
  if is_true "${DRY_RUN:-}"; then
    log "DRY_RUN: supervisorctl restart ${service}"
    read -r state pid uptime < <(service_state "$service")
    echo "$pid"
    return 0
  fi
  local verb=restart
  read -r state pid uptime < <(service_state "$service")
  [[ "$state" == STOPPED || "$state" == EXITED || "$state" == FATAL ]] && verb=start
  supervisorctl -c "$SUPERVISOR_CONF" "$verb" "$service" >&2 \
    || { log "supervisorctl ${verb} ${service} failed"; return 1; }
  for i in $(seq 1 30); do
    read -r state pid uptime < <(service_state "$service")
    case "$state" in
      RUNNING) echo "$pid"; return 0 ;;
      FATAL|BACKOFF|EXITED|ABSENT) log "${service} is ${state} after restart"; return 1 ;;
    esac
    sleep 1
  done
  log "${service} didn't reach RUNNING within 30s (state ${state})"
  return 1
}

# verify_env <qa|prod> <build-dir> <log-offset> <action>
# §2.7 verify: the shared checks on 127.0.0.1 (with the service's own lead
# token), token-free checks on the public URL (prod only; QA's URL is private
# and needs a signed-in browser), the startup log, the same PID for
# VERIFY_STABLE_SECS (default 60), and no WARN/ERROR/panic in the new log
# bytes. Saves a redacted log tail to logs/. Returns non-zero on failure.
verify_env() {
  local env="$1" dir="$2" offset="$3" action="$4"
  local service port db logfile pid pid2 state uptime token newlog fails=0
  service="$(env_get "$env" service)"; port="$(env_get "$env" port)"
  db="$(env_get "$env" db)"; logfile="$(env_get "$env" log)"
  local stable="${VERIFY_STABLE_SECS:-60}"

  if is_true "${DRY_RUN:-}"; then
    log "DRY_RUN: verify ${env} against $(basename "$dir")"
    return 0
  fi

  read -r state pid uptime < <(service_state "$service")
  [[ "$state" == RUNNING && "$pid" =~ ^[0-9]+$ ]] || { log "${service} is ${state}"; return 1; }

  local i
  for i in $(seq 1 60); do
    curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/health" > /dev/null 2>&1 && break
    sleep 0.5
  done

  newlog="$(mktemp /tmp/fast-retro-verify-XXXXXX)"
  log_since "$logfile" "$offset" > "$newlog"
  token="$(service_token "$pid" || true)"
  [[ -n "$token" ]] || { log "can't read ${service}'s lead token from /proc/${pid}/environ"; fails=$((fails+1)); }

  check_instance "${env} (127.0.0.1:${port})" "http://127.0.0.1:${port}" "$dir" \
    "$token" "$pid" "$newlog" "$db" 0 || fails=$((fails+CHECK_FAILS))

  if [[ "$env" == prod ]]; then
    check_instance "${env} (public ${PROD_URL})" "$PROD_URL" "$dir" || fails=$((fails+CHECK_FAILS))
  else
    log "public URL checks skipped for ${env}: $(env_get "$env" url) is private (needs a signed-in browser)"
  fi

  log "watching ${service} for ${stable}s (same PID, no WARN/ERROR/panic)"
  sleep "$stable"
  read -r state pid2 uptime < <(service_state "$service")
  if [[ "$state" == RUNNING && "$pid2" == "$pid" ]]; then
    _pass "${service} still RUNNING as PID ${pid} after ${stable}s"
  else
    _fail "${service} is ${state} PID ${pid2} (was ${pid}): restart loop?"; fails=$((fails+1))
  fi
  log_since "$logfile" "$offset" > "$newlog"
  if grep -E ' (WARN|ERROR) |panicked' "$newlog" | redact >&2; then
    _fail "${service} logged the WARN/ERROR lines above"; fails=$((fails+1))
  else
    _pass "no WARN/ERROR/panic in ${service}'s new log output"
  fi
  local err_log="${logfile%.log}_err.log"
  if [[ -f "$err_log" ]] && grep -q panicked "$err_log"; then
    _fail "${err_log} contains a panic"; fails=$((fails+1))
  fi

  local saved
  saved="${RELEASE_ROOT}/logs/$(now_ts)-${action}.log"
  redact < "$newlog" | tail -n 200 > "$saved"
  rm -f "$newlog"
  log "log tail saved to ${saved}"
  (( fails == 0 ))
}

# Append an entry to a build's LOCAL_INFO (the only file in a build dir the
# box ever writes). jq filter gets $at.
local_info_update() {
  local dir="$1" filter="$2"
  if is_true "${DRY_RUN:-}"; then
    log "DRY_RUN: LOCAL_INFO update on $(basename "$dir"): ${filter}"
    return 0
  fi
  local f="$dir/LOCAL_INFO" tmp
  [[ -f "$f" ]] || echo '{}' > "$f"
  tmp="$(mktemp "$dir/.LOCAL_INFO.XXXXXX")"
  jq --arg at "$(now_iso)" "$filter" "$f" > "$tmp" && mv "$tmp" "$f"
}
