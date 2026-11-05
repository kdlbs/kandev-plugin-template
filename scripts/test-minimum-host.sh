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
mkdir -p "$smoke_dir/home" "$smoke_dir/empty-cwd" "$smoke_dir/tmp" \
  "$smoke_dir/xdg/data" "$smoke_dir/xdg/config" "$smoke_dir/xdg/cache" "$smoke_dir/xdg/state"
# Reserve an available loopback port, then release it for the host to bind.
port=$(node --input-type=module -e 'import net from "node:net"; const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
(cd "$smoke_dir/empty-cwd" && exec env -i PATH="$PATH" HOME="$smoke_dir/home" \
  XDG_DATA_HOME="$smoke_dir/xdg/data" XDG_CONFIG_HOME="$smoke_dir/xdg/config" \
  XDG_CACHE_HOME="$smoke_dir/xdg/cache" XDG_STATE_HOME="$smoke_dir/xdg/state" \
  TMPDIR="$smoke_dir/tmp" LANG=C.UTF-8 KANDEV_SERVER_HOST=127.0.0.1 \
  "$smoke_dir/kandev/bin/kandev" run --headless --port "$port") > "$smoke_dir/launcher.log" 2>&1 &
host_pid=$!
url="http://127.0.0.1:$port"
ready=false
for attempt in $(seq 1 120); do
  # /health is also exposed by the bootstrap server before services/routes
  # exist. Wait for the real plugin API and embedded web provenance as well.
  if curl --fail --silent --max-time 2 "$url/health" > "$smoke_dir/health.json" &&
     curl --fail --silent --max-time 2 "$url/api/plugins" > /dev/null &&
     grep -q '"dist_dir": "embedded"' "$smoke_dir/home/.kandev/logs/backend-logs.log" 2>/dev/null; then
    ready=true
    break
  fi
  kill -0 "$host_pid" || { cat "$smoke_dir/launcher.log"; exit 1; }
  sleep 1
done
[ "$ready" = true ] || { cat "$smoke_dir/launcher.log"; exit 1; }
grep '"dist_dir": "embedded"' "$smoke_dir/home/.kandev/logs/backend-logs.log"
KANDEV_SMOKE_URL="$url" \
  KANDEV_SMOKE_PACKAGE="$repo_dir/$(make --no-print-directory -s package-file)" \
  KANDEV_SMOKE_SCREENSHOTS="$smoke_dir/screenshots" npm run test:host
# Inspect only this fixture's database, never the developer's primary instance.
python3 - "$smoke_dir/home/.kandev/data/kandev.db" <<'PY'
import json, sqlite3, sys
with sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True) as conn:
    rows = conn.execute("SELECT value_json FROM plugin_state WHERE plugin_id = ? AND scope = 'instance' AND state_key = 'event_count'", ('kandev-plugin-template',)).fetchall()
assert len(rows) == 1 and json.loads(rows[0][0])['count'] == 2, rows
print('PASS two task.created events persisted through Host GetState/SetState and disable/re-enable')
PY
