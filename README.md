# kandev-plugin-template

A starter template for building a [kandev](https://github.com/kdlbs/kandev)
**native-UI plugin** — its own git repo, packaged into a versioned tarball and
installed against a running kandev instance. Click **“Use this template”** on
GitHub (or copy this repo) to bootstrap your own plugin.

It is a small, complete example of the core plugin surfaces, wired together so
you can delete what you do not need rather than assemble it from scratch:

- **Native nav item + route** — `ui/bundle.js` adds a sidebar entry that opens
  `/template`, a page rendered natively inside the kandev SPA (not an iframe)
  using the host's own React instance.
- **A page built from host components** — one `Card` containing a `Popover`
  (host-positioned, no `getBoundingClientRect` math), a `Progress` bar, a
  `Table` that swaps to `Empty` when there's nothing to show, and `Kbd` for a
  keyboard hint. Each part is independent: delete the ones you don't want.
- **Toasts** — the page's Clear button calls `host.toast.success` and
  `host.toast.error`. The host mounts the single `<Toaster/>`, so there is
  nothing to render and it works from anywhere, modals included.
- **Locale-aware timestamps** — `host.utils.formatRelativeTime` renders each
  row's "seen" column through `Intl.RelativeTimeFormat`, and `host.utils.cn`
  merges conditional classes the same way the host components do.
- **Live theme** — `host.onThemeChange` keeps a readout in the popover current
  when the user flips light/dark.
- **Chat toolbar action** — one component registration uses `host.ui.Action`
  when the host provides it and keeps the legacy button on older supported
  hosts. The composer passes `{ sessionId, taskId, taskTitle }` as `slotProps`.
- **Live WS-driven page** — a `registerWsHandler("task.created", ...)`
  handler updates module state that the page re-renders from, live, with no
  reload.
- **Backend event handling with Host state** — `OnEvent` counts `task.created`
  deliveries in a persistent counter via the `Host.GetState`/`SetState` round
  trip, so restarts don't reset it.
- **Backend webhook** — `HandleWebhook` logs the `ping` request and returns a
  greeting from the operator settings. Its access is public and declared in
  the manifest. See [Webhook access](#webhook-access) before you copy it.
- **Operator settings (`config_schema`)** — a `greeting` string and a secret
  `api_token`, rendered as a form at **Settings > Plugins > Template Plugin**.
  The plugin reads `greeting`; `api_token` only demonstrates secret-field
  handling and is not used by this example.

Source-control providers need several newer hooks that would swamp this default
starter. The compile-tested [provider-neutral source-control recipe](recipes/source-control/README.md)
shows repository search/paging/inspection/branches/create, task Link and unlink,
review status and responsive Review UI, composer `#` references, cancellation,
and unload fencing. It is opt-in and intentionally excluded from the generated
package until you copy its declarations and adapters into your plugin.

## Make it yours

The plugin **id** appears in the runtime files and smoke fixtures. Rename all of
them from `kandev-plugin-template` to your own id (e.g. `kandev-plugin-acme`):

1. `manifest.yaml` — `id`, plus `display_name` / `description` / `author`.
2. `go.mod` — the `module` line.
3. `Makefile` — `BIN` and `VERSION` to match the manifest. The package name
   is derived from them.
4. `ui/bundle.js` — the id passed to `window.registerKandevPlugin(...)`.
5. `scripts/smoke-minimum-host.mjs` and `scripts/test-minimum-host.sh` — plugin
   API/state fixture ids; align browser expectations when customizing the UI.

Then trim the scaffolding: drop the webhook / event / config blocks in
`manifest.yaml` you don't use, delete the matching handlers in
`server/plugin.go`, and keep only the `registry.register*` calls in
`ui/bundle.js` your plugin actually contributes. Update `server/plugin_test.go`
to cover what remains.

If you are building a Git provider, opt into `recipes/source-control/` as one
cohesive slice. Do not activate only its UI or only its manifest fragment:
provider ownership, declared actions, backend optional interfaces, and frontend
registrations are one contract.

The page in `ui/bundle.js` is deliberately built from independent parts —
`AboutPopover`, the `Progress` block, `RecentTasksTable`, `EmptyState`, the
Clear button — so you can delete any of them without unpicking the others.
Adjust `min_kandev_version` in `manifest.yaml` to match whatever you keep.
The Action recipes and repository conventions are in
[docs/repository-baseline.md](docs/repository-baseline.md).

## Use the host's React — and the host's recharts

`initialize(registry, host)` hands you `host.React` (and `host.jsx`, an alias
for `host.React.createElement`). Use it. **Never import or bundle your own
React**: a second React instance has its own hook dispatcher and context
registry, so host components rendered inside your tree lose their providers,
refs break, and `asChild` stops composing.

The same hazard applies to **recharts**, which is why the host exposes
`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`,
`ChartLegendContent` and `ChartStyle` through `host.ui` rather than leaving you
to install it: recharts resolves its tooltips and legends through its own React
context and renders them into portals, so a bundled second copy splits exactly
what the host copy is holding. It costs nothing to use the host's — recharts is
already a dependency of the app. The same reasoning covers every
Radix/portal/context-based package. Pure-React libraries (`@tabler/icons-react`,
say) bundle fine, but this template ships hand-drawn inline SVG so it needs no
bundler at all.

`host.ui` is much broader than what this template uses — `Accordion*`,
`Collapsible*`, `Select*`, `Tabs*`, `Sheet*`, `Pagination*`, `ScrollArea`,
`Skeleton`, `Switch`, `Spinner`, `TooltipProvider`, plus kandev's own
`PageTopbar`, `Combobox` and `TaskCreateDialog`. Check it before hand-rolling a
component: the published plugins that hand-rolled progress bars and popovers
did so only because this template used to stop at `Button`. The authoritative
list is `PLUGIN_UI` in `apps/web/lib/plugins/host-api.ts`.

## Webhook access

The manifest uses `api_version: 1` and sets `access: "public"` explicitly.
For API v1, an omitted access field keeps the legacy public default. Current
API v2 uses an authenticated default. Keep the explicit value when you adapt
the manifest. Read the [pinned authoring contract](https://github.com/kdlbs/kandev/blob/f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb/docs/public/plugins-authoring.md)
for the current rules.

```yaml
webhooks:
  - key: "ping"
    method: "POST"
    access: "public"
```

The `ping` handler in this template does not authenticate the caller. It logs
the request body and returns a greeting. Add sender verification before you
use this pattern for a public service. The `api_token` setting is not a
verification mechanism in this example.

| `access:`       | Caller                                           | Body limit |
| --------------- | ------------------------------------------------ | ---------- |
| `public`        | Anonymous service. Check a provider signature or shared secret in your handler. | 4 MiB |
| `authenticated` | Kandev session or PAT. Use it for your scripts and CI. | 16 MiB |

If you want to call your plugin from your **own** frontend bundle, neither is
right: declare an `actions:` entry instead. The host authenticates and
authorizes those and passes a verified resource context to your backend, and
`host.api.fetch` is documented as MUST NOT target a public webhook path.

## Minimum host version

`manifest.yaml` declares `min_kandev_version: "0.99.0"`, read from both
published SDK 0.1.0 `sdk-release.json` records. This is the SDK-wide floor,
including for plugins that use only a small subset of its APIs. Retain at least
this minimum when trimming the starter or enabling the source-control recipe.
API v1 remains supported by both SDKs, so the template keeps its existing
`api_version: 1`, explicit public webhook, permissions, and runtime behavior.

The SDK version (`0.1.0`), minimum host (`0.99.0`), plugin version (`0.2.0`),
and manifest API version (`1`) are independent. Upgrade SDKs deliberately:
inspect their installed records, raise the host minimum if needed, rerun the
compatibility checker and tests, then smoke-test the package on that minimum
released host. A successful development-host install does not certify a
released-host floor.

## How a plugin runs (gRPC subprocess, not HTTP)

kandev spawns the platform-matching binary from `runtime.executables` in
`manifest.yaml` as a subprocess and talks to it over a private gRPC connection
([hashicorp/go-plugin](https://github.com/hashicorp/go-plugin)) — there is no
HTTP listen address, no shared secret, and no manual wiring: `pluginsdk.Serve`
in `server/main.go` owns the entire transport. The base interface has two RPCs
and gives you a `Host` handle back:

```go
type Plugin interface {
    OnEvent(ctx context.Context, e *Event) error
    HandleWebhook(ctx context.Context, req *WebhookRequest) (*WebhookResponse, error)
}
```

`server/plugin.go`'s `templatePlugin` embeds `pluginsdk.UnimplementedPlugin`
(a no-op default for both RPCs, plus `Host()`/`SetHost()` accessors) and
overrides what it needs. `server/main.go` is just
`pluginsdk.Serve(&templatePlugin{})`.

Newer features are additive optional interfaces. For example, the
source-control recipe implements `pluginsdk.ActionHandler`,
`pluginsdk.EntityReferenceSearcher`, and
`pluginsdk.EntityReferenceAuthorizer`; a provider that needs transient Git
credentials can separately implement `GitCredentialResolver` and
`GitCredentialBinder`. Embedding the no-op base preserves the minimal plugin.

## Developing against the SDK

Go uses `github.com/kdlbs/kandev/pluginsdk v0.1.0`; frontend recipes use exactly
`@kdlbs/plugin-sdk` `0.1.0`. Both resolve publicly without a Kandev sibling,
SDK replacements, or npm file links. The default `ui/bundle.js` remains a
dependency-free ES module; the frontend SDK is a type-only recipe dependency.

```sh
git clone https://github.com/kdlbs/kandev-plugin-template.git
cd kandev-plugin-template
npm ci --ignore-scripts
go mod download
make sdk-check
node -p 'require("@kdlbs/plugin-sdk/sdk-release.json")'
```

`make sdk-check` runs the published checker after dependency installation:

```sh
go run github.com/kdlbs/kandev/pluginsdk/cmd/kandev-sdk-check@v0.1.0 \
  --manifest manifest.yaml --frontend-sdk node_modules/@kdlbs/plugin-sdk
```

It verifies the resolved Go SDK, installed frontend SDK, exact lockfile entry,
minimum host, and supported manifest API version. Build and package targets run
it automatically. For an upgrade, change both exact SDK pins, regenerate
`go.sum` with `go mod tidy` and `package-lock.json` with npm, inspect the new
records, and repeat validation. See the [public migration contract](https://github.com/kdlbs/kandev/blob/f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb/docs/public/plugins-authoring.md#install-and-migrate-sdk-dependencies).
Packaging still requires the separate backend tooling input described below.

## Layout

```
manifest.yaml          # plugin manifest — id, capabilities, runtime.executables, ui.bundle, config_schema
server/
  main.go              # pluginsdk.Serve wiring — no flags, no HTTP, no secrets
  plugin.go            # templatePlugin: OnEvent / HandleWebhook
  plugin_test.go       # tests against a fake Host, no subprocess spawn needed
ui/
  bundle.js            # hand-written, no-build ES module — the plugin's frontend half
recipes/source-control/
  manifest.fragment.yaml
  server/              # provider-neutral backend ports and contract tests
  ui/                  # typed native registrations and lifecycle tests
package.json           # recipe-only TypeScript tests/types; no production bundle
tsconfig.recipes.json  # strict public-SDK contract check
```

`ui/bundle.js` is hand-written, dependency-free ES module JavaScript. There is
no build step: it ships byte-for-byte inside the package tar.gz, and kandev
serves it directly. Edit the file and repackage — nothing else to run.

## Build and test

Use Go 1.26.0 and a Node version allowed by `package.json`. The CI workflows use
Node 24. Install the locked UI test dependencies from the plugin directory.

```sh
npm ci --ignore-scripts
make sdk-check
make check-format
go mod tidy
git diff --exit-code -- go.mod go.sum
make vet
make test
make audit-recipes
make build
```

`make test` runs backend and recipe tests, recipe type checking, the Action
fallback test, and negative package and release-version checks. The package
checks do not replace a disposable-host smoke test.

> Note: bare `go build ./server/...` (no `-o`) fails with `build output
> "server" already exists and is a directory` — Go's default output name for a
> lone main package is the last path element ("server"), which collides with
> the `server/` source directory. Always pass `-o`, run `go build .` from
> inside `server/`, or use `make build`. `go vet`/`go test` are unaffected.

## Package it

`plugin-pack` remains backend-owned. Compilation and tests are standalone;
package construction needs a source checkout at `.kandev-tooling-ref`
(`f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`), independently pinned from SDK
and plugin versions. Its backend module needs the root `pluginsdk/` directory.
Prepare this packaging-only input explicitly:

```sh
git clone --filter=blob:none --no-checkout https://github.com/kdlbs/kandev.git .build/kandev-tooling
git -C .build/kandev-tooling sparse-checkout set apps/backend pluginsdk
git -C .build/kandev-tooling checkout "$(cat .kandev-tooling-ref)"
```

```sh
make package        # cross-compiles linux/darwin (amd64+arm64) + windows/amd64,
                    # then packs manifest + ui/ + binaries into a versioned .tar.gz

make package-host   # host platform only — faster local iteration
make verify-package # build + validate the five-platform archive
make verify-package-host # build + validate the host-platform archive
```

Both stage `manifest.yaml` and `ui/` beside the freshly built
`server/plugin-<goos>-<goarch>[.exe]` binaries. Kandev's `cmd/plugin-pack`
computes `checksums.txt` and writes the archive. The verifier checks every
manifest-declared binary, the UI bundle, the exact file list, and all checksums.
It rejects recipe and development files even when their checksums are valid.

The Makefile runs `go run ./cmd/plugin-pack` inside the tooling backend's
module context, keeping its dependency graph out of the plugin's `go.sum`.
The default `KANDEV_TOOLING` is `.build/kandev-tooling/apps/backend`; override
it with an absolute backend path when needed, for example
`make verify-package KANDEV_TOOLING=/tmp/kandev-tools/apps/backend`.
CI and releases prepare that pinned checkout only in packaging jobs. This is
an explicit source requirement for packaging, not checkout-free packaging.

## Install it against a running Kandev

The manifest requires Kandev 0.99.0 or later. It packages Linux amd64 and
arm64, macOS amd64 and arm64, and Windows amd64 binaries. It requests access to
`task.created` events and plugin-scoped state. The `ping` webhook is public.

Either through the UI (**Settings > Plugins > Install plugin**, URL or file
upload), or directly:

```sh
curl -F package=@kandev-plugin-template-0.2.0.tar.gz \
  http://localhost:<kandev-port>/api/plugins/install
```

Kandev verifies the package checksums, validates the manifest, extracts the
package, and starts the host-matching binary. An unsigned package is marked
unsigned in **Settings > Plugins**. Checksums detect file changes against the
included checksum list and can catch accidental corruption. They do not prove
who published the package. A
directory sideload is a different flow: Kandev registers it as disabled and
does not start it.
Reinstalling the same version returns 409 — bump `version` in `manifest.yaml`.

For the Linux amd64 disposable-host smoke used by the PR build workflow:

```sh
npx playwright install --with-deps chromium
sh scripts/test-minimum-host.sh
```

This downloads the official runtime at the installed SDK's minimum host,
verifies its archive checksum, starts it with isolated data, installs the
package, and exercises backend/config/state plus desktop/phone UI lifecycle.
Run `make verify-package` first. `KANDEV_SMOKE_EVIDENCE=/absolute/path` retains
logs, screenshots, and the fixture database. The opt-in provider recipe still
needs its own concrete adapter/host smoke when activated.

## Publish a release

Pull requests run CI, UI and backend tests, and full platform packaging. The
release workflow supports a manual version bump from `main` and a pushed
`vX.Y.Z` tag. Both paths run format, vet, test, audit, and package checks before
GitHub creates a release. Manual releases update the manifest and Makefile,
then create a commit and matching tag only after those checks pass.

- `kandev-plugin-template-<version>.tar.gz` — the plugin package with its own
  `checksums.txt`, which Kandev checks during installation.
- `checksums.txt` — the package's internal file checksums plus the SHA-256
  checksum of the published package archive.

In GitHub Actions, open the release workflow from `main`. Choose a version
bump. Set `dry_run` to `true` to preview the version without publishing.

The tag path requires the tag, manifest version, Makefile version, and package
manifest to match. SDK upgrades change the public exact pins and lockfiles;
packaging-tool upgrades change `.kandev-tooling-ref` separately. Test each
change and retain the SDK-wide runtime minimum from the installed records.

Migration validation and minimum-host smoke evidence are recorded in
[docs/sdk-migration.md](docs/sdk-migration.md).

## License

MIT — see [LICENSE](LICENSE). This template is meant to be copied and made your
own; your resulting plugin can carry whatever license you choose.
