# Public SDK migration evidence

This migration starts from the general template's default branch `main` at
`805d2018773bf3c6f594f5c4f9e1b2d07e71bc48`. It follows the
[approved handoff](https://github.com/kdlbs/kandev/blob/f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb/docs/plans/plugin-sdk-publishing/template-migration.md)
and [public authoring contract](https://github.com/kdlbs/kandev/blob/f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb/docs/public/plugins-authoring.md#install-and-migrate-sdk-dependencies).
Validation date: 2026-11-05. No plugin release or catalog version is changed.

## Verified public release

The release gate was satisfied by merged PR
[#4534](https://github.com/kdlbs/kandev/pull/4534) and successful recovery
[run 42089596215, attempt 3](https://github.com/kdlbs/kandev/actions/runs/42089596215/attempts/3).
The public [SDK release](https://github.com/kdlbs/kandev/releases/tag/pluginsdk/v0.1.0)
resolves to source `f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`.

Commands used to inspect the published packages:

```sh
go mod download -json github.com/kdlbs/kandev/pluginsdk@v0.1.0
npm view @kdlbs/plugin-sdk@0.1.0 version dist --json
node -p 'require("@kdlbs/plugin-sdk/sdk-release.json")'
sha256sum node_modules/@kdlbs/plugin-sdk/sdk-release.json
```

Both installed SDK records are byte-identical with SHA-256
`6cfc2c9d5bfbe671e6eb17a314b484e546e1c37abd721c10958595caa4a07144`:

```json
{
  "schema_version": 1,
  "sdk_version": "0.1.0",
  "host_release": "0.99.0",
  "min_kandev_version": "0.99.0",
  "api_versions": [1, 2],
  "change_kind": "initial"
}
```

Go module sum: `h1:Pov5zE2gGf53FslhpcoGgx6E3nu6kjizT69x3MlEEEs=`.
Go module-file sum: `h1:V0Y6IoJvwa+OuZdfgD3Ck2EgQut7S3jSu8OLQRo7xxs=`.
npm registry integrity:
`sha512-bQjlu+Q7GMQNuts98b5p6CPDOWCchxdq5VlQCwO5FunsEUuaKl/e1i+KJnVK2bvm9FgxuZLMt6W50KPdSA33vw==`.
The registry integrity matches the SDK release receipt. npm generated the
lockfile; no integrity values were authored by hand.

The template retains plugin version `0.2.0`, API v1, explicit public webhook
access, capabilities, settings, UI behavior, and opt-in recipe boundaries.
Its declared minimum rises from `0.86.0` to the installed SDK-wide `0.99.0`
floor. Older hosts are intentionally outside the rebuilt package's declared
support. Existing installed binaries are not changed by this source migration.
Go and frontend recipes use public SDK `0.1.0`; there are no direct generated
protocol imports in this repository. Future protocol imports belong under
`github.com/kdlbs/kandev/pluginsdk/proto/`.

## Fresh standalone checkout

The implementation commit is `1d472909181f7257b8a52936f7b09452b245f9fa`.
A separate clone was created with `git clone --no-local`, outside the task's
worktree layout, at `/tmp/template-sdk-migration-evidence/standalone/plugin`.
Its parent has no Kandev sibling. Public Go and npm cache directories were empty
before the first installation. Toolchain: Go `1.26.6`, Node `24.19.0`, npm
`11.17.0`, Linux amd64.

```sh
git clone --no-local /path/to/migration-checkout /tmp/template-sdk-migration-evidence/standalone/plugin
cd /tmp/template-sdk-migration-evidence/standalone/plugin
export GOWORK=off GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org
export GOMODCACHE=/tmp/template-sdk-migration-evidence/public-go-modules
test ! -e ../kandev
npm ci --ignore-scripts --cache /tmp/template-sdk-migration-evidence/public-npm-cache --registry=https://registry.npmjs.org
go mod tidy
git diff --exit-code -- go.mod go.sum package-lock.json
go test ./server/... ./recipes/source-control/server/...
go vet ./server/... ./recipes/source-control/server/...
npm run typecheck:recipes
npm run test:recipes
npm run test:ui
go run github.com/kdlbs/kandev/pluginsdk/cmd/kandev-sdk-check@v0.1.0 \
  --manifest manifest.yaml --frontend-sdk node_modules/@kdlbs/plugin-sdk
make check-format test-package-verifier test-release-version audit-recipes build
go list -m all
npm ls --depth=0
git status --short
```

All commands above passed. Go tests passed for both actual packages; vet and
recipe typecheck passed; 14 recipe tests and two UI tests passed. Package and
release-verifier negative suites passed. Both SDK checker results were
`SDK 0.1.0: compatible (minimum Kandev 0.99.0)`. Audit reported zero
vulnerabilities. Tidy/lock checks and final `git status --short` produced no
diff. The resolved graph contains `github.com/kdlbs/kandev/pluginsdk v0.1.0`
with no replacement and no `github.com/kandev/kandev` backend module.

Standalone host/full archive verification and the final disposable runner also
passed. The smoke runner fix is commit
`e1db7846484b3739295a1f634330df0ea1df7915`; it changes only test readiness and
signal cleanup, with no production source or artifact changes.

## Packaging remains a separate input

`.kandev-tooling-ref` pins backend-owned `cmd/plugin-pack` to
`f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`. The tooling checkout includes
`apps/backend` **and** root `pluginsdk`, because its backend module has a local
SDK replacement. This is packaging-only tooling, outside the plugin's module
graph; SDK compilation/typechecking requires no checkout. Packaging is not
checkout-free.

```sh
git clone --filter=blob:none --no-checkout https://github.com/kdlbs/kandev.git /tmp/template-sdk-migration-evidence/packaging-source
git -C /tmp/template-sdk-migration-evidence/packaging-source sparse-checkout set apps/backend pluginsdk
git -C /tmp/template-sdk-migration-evidence/packaging-source checkout f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb
make verify-package-host KANDEV_TOOLING=/tmp/template-sdk-migration-evidence/packaging-source/apps/backend
make verify-package KANDEV_TOOLING=/tmp/template-sdk-migration-evidence/packaging-source/apps/backend
sh scripts/verify-release-version.sh v0.2.0 kandev-plugin-template-0.2.0.tar.gz
sha256sum kandev-plugin-template-0.2.0.tar.gz
tar -tzf kandev-plugin-template-0.2.0.tar.gz
```

Package builds explicitly disable cgo for cross-compilation: the executor's
inherited cgo setting otherwise invokes an amd64 assembler for arm64. The
plugin uses the pure-Go SDK transport and needs no C dependency.

Standalone host archive SHA-256:
`a6c17fcb77171eb6f9121af885ac3c2e902529ea839a806240a0fa709cdc9d92`.
Standalone full archive SHA-256:
`a7992ff2339efc1f153d5ef3ea3020676e597c5e24934431859bce014485e835`.
Both construction/verification targets and the full archive's release-identity
check passed. The host archive contains four files; the full archive contains
exactly these eight files, all content files covered by generated checksums:

```text
manifest.yaml
server/plugin-darwin-amd64
server/plugin-darwin-arm64
server/plugin-linux-amd64
server/plugin-linux-arm64
server/plugin-windows-amd64.exe
ui/bundle.js
checksums.txt
```

Current `plugin-pack -platform-only` serializes YAML and retains only the host
executable declaration. The old verifier incorrectly required the original
indentation, quoting, and five declarations. A new regression fixture first
failed with `manifest runtime.executables does not match the supported platform
set`; the updated verifier accepts serialized host manifests while full mode
continues to require all five platforms. Missing files, corruption, unexpected
files, checksummed development files, and invalid platform sets remain rejected.

## Minimum-host smoke

The official `v0.99.0` Linux x64 runtime is from release source
`f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`. Its archive SHA-256 is
`a60656b3dbce2c663965270b22b81301e568ab39c9906f331280b4eda84294bb`.
The runner checks the published checksum, starts the runtime with isolated
HOME/XDG/data directories and a loopback port, verifies `/health` reports
`v0.99.0` and the host logs `dist_dir: embedded`, then installs the package.

```sh
npx playwright install --with-deps chromium
KANDEV_SMOKE_EVIDENCE=/tmp/template-sdk-migration-evidence/final-host-smoke \
  sh scripts/test-minimum-host.sh
```

On the NixOS executor, browser installation used `npx playwright install
chromium`; execution additionally set
`LD_LIBRARY_PATH=/nix/store/vj1w29j7kfsvn83z33yb2rpq4ymz24n5-kandev-builtin-playwright-libs/lib`.
Ubuntu CI uses the documented `--with-deps` command. The smoke test uses the
locked Playwright `1.64.1` and its Chromium browser.

The first end-to-end runner attempt reproduced a startup race: bootstrap
`/health` returned HTTP 200 while service initialization was still running.
The runner now waits for the real plugin API and the embedded-web log marker
as well as health, before beginning artifact checks.

The default package's declared surfaces are covered: active installation and
SDK handshake; API v1 public webhook; config-triggered restart with Host config
read and masked secret; exact served UI module; desktop and Pixel 5 native
route, host components, popover and viewport fit; real task-created WS delivery,
table and Clear; exactly one composer Action with keyboard/touch navigation;
disable/re-enable and configuration persistence; no browser page errors. A
read-only query of the disposable fixture database verifies exactly two
`task.created` deliveries persisted through Host `GetState`/`SetState` and
survived disable/re-enable. No task agent, external provider account, or real
message is used.

The final runner exited zero against the full standalone archive identified
above. It printed all 14 browser/backend checks and
`PASS two task.created events persisted through Host GetState/SetState and disable/re-enable`.
The task-local evidence is under
`/tmp/template-sdk-migration-evidence/final-host-smoke` (launcher/backend logs,
health response, isolated database, and desktop/phone screenshots). The
standalone test log is
`/tmp/template-sdk-migration-evidence/standalone-validation.log`.
These task-local paths are diagnostic artifacts; the commands above and the
committed runner reproduce the checks in CI.

The source-control recipe stays outside this package. Its actual Go tests,
14 TypeScript tests, and typecheck run; installed provider-specific Review,
reference submission, and credential flows require concrete adapters in a
plugin that activates that recipe. They are not claimed as smoke-tested here.

## CI and review

Compilation CI has no Kandev checkout. Packaging and release workflows retain
the separately pinned tooling checkout and root `pluginsdk`. `sdk-check` runs
after dependency installation and before build/package. The PR build workflow
also runs the official minimum-host smoke. Existing format, vet, backend/UI/
recipe tests, package/release negative checks, and audit gates remain enabled.

The required audit initially reported four advisories in the existing test
stack. Vitest was patched from `4.1.11` to `4.1.12`, and npm regenerated its
compatible Vite/source-map transitive patches; audit now reports zero
vulnerabilities. The new smoke-only Playwright dependency is exactly pinned.

Review follow-up: bare `make --dry-run` reproduced a default-target regression
(it printed only the SDK check). `.DEFAULT_GOAL := build` restores the existing
bare-make compilation behavior. The browser lifecycle test now stays in one
loaded document: it asserts the Action disappears on disable, returns exactly
once on re-enable, and retains the same `performance.timeOrigin`. It does not
reload to obtain a clean registration set.
