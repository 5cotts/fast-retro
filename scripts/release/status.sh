#!/usr/bin/env bash
# make release-status
#
# Read-only: what each environment's symlink points at, what binary the
# service is actually running, the live /api/version, retained builds,
# the latest restore points and the tail of release.log. Takes no lock and
# reads no secrets.
source "$(dirname "$0")/lib.sh"

link_target() {
  local l="${RELEASE_ROOT}/$1"
  if [[ -L "$l" ]]; then basename "$(readlink "$l")"; else echo "(none)"; fi
}

show_env() {
  local name="$1" service="$2" port="$3" link="$4"
  local state pid uptime exe version
  read -r state pid uptime < <(service_state "$service")
  echo "${name}  (service ${service}, :${port})"
  echo "  symlink ${link}:  $(link_target "$link")"
  echo "  symlink ${link}.prev:  $(link_target "${link}.prev")"
  echo "  service:  ${state}  pid ${pid}  uptime ${uptime//_/ }"
  if [[ "$pid" =~ ^[0-9]+$ ]]; then
    exe="$(readlink "/proc/${pid}/exe" 2>/dev/null || echo '?')"
    echo "  running:  ${exe}"
    if [[ -L "${RELEASE_ROOT}/${link}" ]]; then
      if [[ "$exe" == "$(realpath "${RELEASE_ROOT}/${link}/fast-retro")" ]]; then
        echo "            (matches the ${link} symlink)"
      else
        echo "            (does NOT match the ${link} symlink: restart pending or migration not done)"
      fi
    fi
  fi
  version="$(curl -sS --max-time 5 "http://127.0.0.1:${port}/api/version" 2>/dev/null || true)"
  if [[ -n "$version" ]] && jq -e .sha <<<"$version" > /dev/null 2>&1; then
    echo "  version:  $(jq -r '"\(.sha[0:12])  built \(.built_at)"' <<<"$version")"
  elif curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" > /dev/null 2>&1; then
    echo "  version:  (no /api/version: build predates it)"
  else
    echo "  version:  (not answering on :${port})"
  fi
  echo
}

echo "release root: ${RELEASE_ROOT}"
echo
show_env prod "$PROD_SERVICE" "$PROD_PORT" prod
show_env qa "$QA_SERVICE" "$QA_PORT" qa

echo "builds (newest first)"
if [[ -d "$BUILDS_DIR" ]] && find "$BUILDS_DIR" -mindepth 1 -maxdepth 1 -type d -name '2*' | grep -q .; then
  while IFS= read -r dir; do
    id="$(basename "$dir")"
    if build_intact "$dir" 2>/dev/null; then integrity=intact; else integrity=BROKEN; fi
    src="$(jq -r '.source // "?"' "$dir/BUILD_INFO" 2>/dev/null || echo '?')"
    ref="$(jq -r '.ref // "-"' "$dir/BUILD_INFO" 2>/dev/null || echo '-')"
    att="$(jq -r '.attestation // "-"' "$dir/LOCAL_INFO" 2>/dev/null || echo '-')"
    printf '  %-26s %-7s %-7s attestation=%-9s ref=%s\n' "$id" "$src" "$integrity" "$att" "$ref"
  done < <(find "$BUILDS_DIR" -mindepth 1 -maxdepth 1 -type d -name '2*' | sort -r)
else
  echo "  (none yet: make release-fetch)"
fi
echo

echo "latest prod restore points ($(dirname "$PROD_DB"))"
mapfile -t baks < <(find "$(dirname "$PROD_DB")" -maxdepth 1 -name "$(basename "$PROD_DB").bak-*" -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n3 | cut -d' ' -f2-)
if (( ${#baks[@]} )); then
  for b in "${baks[@]}"; do printf '  %-6s %s\n' "$(du -h "$b" | cut -f1)" "$(basename "$b")"; done
else
  echo "  (none)"
fi
echo

echo "release.log (last 10)"
if [[ -s "$RELEASE_LOG" ]]; then tail -n10 "$RELEASE_LOG" | sed 's/^/  /'; else echo "  (empty)"; fi
