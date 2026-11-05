#!/bin/sh
# Linux amd64 integration test. All runtime data stays in a disposable HOME.
set -eu
repo_dir=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cd "$repo_dir"
[ "$(go env GOOS)-$(go env GOARCH)" = linux-amd64 ] || {
  echo 'minimum-host runner requires Linux amd64' >&2
  exit 1
}
smoke_dir=$(mktemp -d)
host_pid=
cleanup() {
  if [ -n "$host_pid" ]; then
    kill "$host_pid" 2>/dev/null || true
    wait "$host_pid" 2>/dev/null || true
  fi
  # Keep logs and the isolated database for failure diagnosis when requested.
  if [ -n "${KANDEV_SMOKE_EVIDENCE-}" ]; then
    mkdir -p "$KANDEV_SMOKE_EVIDENCE"
    cp -R "$smoke_dir/." "$KANDEV_SMOKE_EVIDENCE/"
  fi
  rm -rf "$smoke_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
minimum=$(node -p 'require("@kdlbs/plugin-sdk/sdk-release.json").min_kandev_version')
asset=kandev-linux-x64.tar.gz
release_url="https://github.com/kdlbs/kandev/releases/download/v$minimum"
curl --fail --silent --show-error --location "$release_url/$asset" -o "$smoke_dir/$asset"
curl --fail --silent --show-error --location "$release_url/$asset.sha256" -o "$smoke_dir/$asset.sha256"
(cd "$smoke_dir" && sha256sum -c "$asset.sha256" && tar -xzf "$asset")
ready=false
# This host release has no socket handoff/port-zero discovery interface. A free
# port probe can race another process, so retry bind collisions with a fresh
# port and a separate HOME. Other startup failures remain fatal.
for bind_attempt in 1 2 3; do
  host_root="$smoke_dir/host-$bind_attempt"
  host_home="$host_root/home"
  host_log="$host_home/.kandev/logs/backend-logs.log"
  launcher_log="$host_root/launcher.log"
  mkdir -p "$host_home" "$host_root/empty-cwd" "$host_root/tmp" \
    "$host_root/xdg/data" "$host_root/xdg/config" "$host_root/xdg/cache" "$host_root/xdg/state"
  port=$(node --input-type=module -e 'import net from "node:net"; const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
  (cd "$host_root/empty-cwd" && exec env -i PATH="$PATH" HOME="$host_home" \
    XDG_DATA_HOME="$host_root/xdg/data" XDG_CONFIG_HOME="$host_root/xdg/config" \
    XDG_CACHE_HOME="$host_root/xdg/cache" XDG_STATE_HOME="$host_root/xdg/state" \
    TMPDIR="$host_root/tmp" LANG=C.UTF-8 KANDEV_SERVER_HOST=127.0.0.1 \
    "$smoke_dir/kandev/bin/kandev" run --headless --port "$port") > "$launcher_log" 2>&1 &
  host_pid=$!
  url="http://127.0.0.1:$port"
  for attempt in $(seq 1 120); do
    kill -0 "$host_pid" 2>/dev/null || break
    # The bootstrap /health endpoint precedes plugin routes and web serving.
    if curl --fail --silent --max-time 2 "$url/health" > "$smoke_dir/health.json" &&
       curl --fail --silent --max-time 2 "$url/api/plugins" > /dev/null &&
       grep -q '"dist_dir": "embedded"' "$host_log" 2>/dev/null; then
      ready=true
      break
    fi
    sleep 1
  done
  [ "$ready" = true ] && break
  kill "$host_pid" 2>/dev/null || true
  wait "$host_pid" 2>/dev/null || true
  host_pid=
  if cat "$launcher_log" "$host_log" 2>/dev/null | grep -Eiq 'address already in use|failed to bind|port .*in use|EADDRINUSE'; then
    echo "Host bind collision on $port; trying another port" >&2
    continue
  fi
  cat "$launcher_log"
  exit 1
done
[ "$ready" = true ] || {
  echo 'Host bind failed after three attempts' >&2
  cat "$launcher_log" "$host_log" 2>/dev/null || true
  exit 1
}
grep '"dist_dir": "embedded"' "$host_log"
KANDEV_SMOKE_URL="$url" \
  KANDEV_SMOKE_PACKAGE="$repo_dir/$(make --no-print-directory -s package-file)" \
  KANDEV_SMOKE_SCREENSHOTS="$smoke_dir/screenshots" npm run test:host
# Inspect only this fixture's database, never the developer's primary instance.
python3 - "$host_home/.kandev/data/kandev.db" <<'PY'
import json, sqlite3, sys
with sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True) as conn:
    rows = conn.execute("SELECT value_json FROM plugin_state WHERE plugin_id = ? AND scope = 'instance' AND state_key = 'event_count'", ('kandev-plugin-template',)).fetchall()
assert len(rows) == 1 and json.loads(rows[0][0])['count'] == 2, rows
print('PASS two task.created events persisted through Host GetState/SetState and disable/re-enable')
PY
