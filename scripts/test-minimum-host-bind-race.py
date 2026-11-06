#!/usr/bin/env python3
"""Exercise the real minimum-host runner against an intentionally occupied port.

Run after dependency/browser installation and make verify-package. --exhaust
keeps all three attempted ports occupied and verifies failure diagnostics.
"""
import argparse
import http.server
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import threading


class BusyPort(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(503)
        self.end_headers()
        self.wfile.write(b"intentionally occupied smoke-test port")

    def log_message(self, *_args):
        pass


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exhaust", action="store_true")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node must be installed before running this test")
    with tempfile.TemporaryDirectory(prefix="kandev-bind-race-") as temporary:
        fixture = Path(temporary)
        marker = fixture / "first-probe-used"
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), BusyPort)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            condition = ":" if args.exhaust else f"[ ! -f {shlex.quote(str(marker))} ]"
            stub = fixture / "node"
            stub.write_text(f'''#!/bin/sh
if [ "$1" = --input-type=module ] && [ "$2" = -e ]; then
  case "$3" in *net.createServer*)
    if {condition}; then
      : > {shlex.quote(str(marker))}
      printf '%s\\n' {server.server_port}
      exit 0
    fi
  esac
fi
exec {shlex.quote(node)} "$@"
''')
            stub.chmod(0o755)
            env = os.environ.copy()
            env["PATH"] = str(fixture) + os.pathsep + env["PATH"]
            evidence = env.get("KANDEV_SMOKE_EVIDENCE")
            if evidence:
                env["KANDEV_SMOKE_EVIDENCE"] = str(Path(evidence).resolve() / "host")
            log = fixture / "smoke.log"
            with log.open("w") as output:
                result = subprocess.run(
                    ["sh", "scripts/test-minimum-host.sh"], cwd=repo, env=env,
                    stdout=output, stderr=subprocess.STDOUT, check=False,
                )
            output = log.read_text()
            print(output, end="")
            if evidence:
                target = Path(evidence).resolve()
                target.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(log, target / "bind-race.log")
            if args.exhaust:
                require(result.returncode != 0, "occupied ports unexpectedly passed")
                require(output.count("Host bind collision") == 3, "expected three bind collisions")
                require("Host bind failed after three attempts" in output, "missing exhausted-retry failure")
                require("already in use" in output or "failed to bind" in output, "missing final startup diagnostic")
                print("PASS exhausted collisions retain final startup diagnostics")
            else:
                require(result.returncode == 0, "minimum-host runner failed")
                require("Host bind collision" in output, "occupied port did not exercise the retry")
                require("PASS two task.created events persisted" in output, "full smoke did not complete")
                print("PASS real bind collision recovers and completes the full host smoke")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    main()
