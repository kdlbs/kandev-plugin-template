# Repository baseline

This template carries the reviewed repository patterns for Kandev plugins.
Use these patterns when you update a plugin repository. Keep each plugin's
existing identity, settings, permissions, provider behavior, and translations.

## Public SDK and packaging inputs

Current builds and recipes use public SDK `0.1.0` in Go and npm, with no sibling
checkout or local SDK substitutions. Both published release records set the
SDK-wide minimum host to `0.99.0`; API v1 remains supported. Run
`npm ci --ignore-scripts`, `go mod tidy`, and `make sdk-check` before builds.
See [the migration evidence](sdk-migration.md) for the exact public resolution,
standalone tests, packaging, and minimum-host smoke results.

`.kandev-tooling-ref` independently pins backend-owned `plugin-pack` to
`f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`. Only packaging needs this
checkout, including `apps/backend` and root `pluginsdk`. Follow the README's
packaging setup; the plugin module never imports the backend graph.

## Historical validation before SDK publication

The following Action guidance and stable-host results describe the prior
source-pinned baseline (PR #8). The old `0.86.0` minimum and `v0.97.0` smoke
results do not establish compatibility for current SDK builds. Use the current
migration evidence and its commands for verification.

## Action ownership and supported slots

Use `host.ui.Action` inside a supported component slot. Use
`host.ui.ActionGroup` when one registration contributes several standard
actions. The host owns the outer button, icon box, spacing, focus treatment,
disabled style, and responsive size. The plugin owns labels, state, visibility,
callbacks, and rich content.

Do not pass `className`, `style`, `size`, `variant`, `asChild`, or location
overrides to Action. Do not put a button or another interactive control inside
Action. Use the existing Popover, Drawer, or Dialog for rich content. Keep
ordinary page, settings, and dialog buttons on `host.ui.Button`.

Action supports composer slots, `main-top-bar`, `chat-top-bar`,
`sidebar-workspace-actions`, and both app status-bar slots. See the
[pinned authoring guide](https://github.com/kdlbs/kandev/blob/570600439036e81f8e9e1c63f15c4abce8a6c846/docs/public/plugins-authoring.md#standard-actions-in-component-slots)
for the surface behavior and accessible props.

### Icon action in a composer

This recipe keeps the current registration and selects one render path.
Feature-detect Action when older hosts remain supported.

```js
function makeIconAction(host) {
  const { jsx: h, ui } = host;

  return function IconAction() {
    const translate = host.i18n?.useTranslation?.().t;
    const label = translate
      ? translate("openPluginPage", { defaultValue: "Open plugin page" })
      : "Open plugin page";
    const Action = ui.Action;
    const onClick = () => host.navigate("/plugin");

    return typeof Action === "function"
      ? h(Action, { label, icon: myIcon(h), onClick })
      : h(
          ui.Button,
          {
            type: "button",
            variant: "ghost",
            size: "icon",
            "aria-label": label,
            onClick,
          },
          myIcon(h),
        );
  };
}

registry.registerComponent("chat-input-actions", makeIconAction(host));
```

The template uses this pattern in `ui/bundle.js`. Its Action path has no copied
button dimensions or classes. The legacy branch keeps its previous Button.

### Labelled metric in a top bar

Keep the label stable when a value changes or truncates. The value belongs in
`text`; the host bounds it for the selected surface.

```js
function makeUsageAction(host, getPercent, refresh) {
  const { jsx: h, ui } = host;

  return function UsageAction() {
    const translate = host.i18n?.useTranslation?.().t;
    const label = translate
      ? translate("providerUsage", { defaultValue: "Provider usage" })
      : "Provider usage";
    const value = `${getPercent()}%`;

    return typeof ui.Action === "function"
      ? h(ui.Action, { label, text: value, onClick: refresh })
      : h(
          ui.Button,
          { type: "button", "aria-label": label, onClick: refresh },
          value,
        );
  };
}

registry.registerComponent(
  "main-top-bar",
  makeUsageAction(host, getUsagePercent, refreshUsage),
);
```

### Grouped actions in a task top bar

Detect `Action` and `ActionGroup` separately. If either export is absent, keep
the legacy group as one fallback path.

```js
function makeTaskActions(host) {
  const { jsx: h, ui } = host;

  return function TaskActions() {
    const translate = host.i18n?.useTranslation?.().t;
    const label = (key, fallback) =>
      translate ? translate(key, { defaultValue: fallback }) : fallback;
    const Action = ui.Action;
    const ActionGroup = ui.ActionGroup;
    const refresh = () => refreshTask();
    const open = () => openTaskPage();

    if (typeof Action === "function" && typeof ActionGroup === "function") {
      return h(
        ActionGroup,
        { label: label("pluginActions", "Plugin actions") },
        h(Action, {
          label: label("refreshTask", "Refresh task"),
          icon: refreshIcon(h),
          onClick: refresh,
        }),
        h(Action, {
          label: label("openTask", "Open task"),
          icon: openIcon(h),
          onClick: open,
        }),
      );
    }

    return h(
      "div",
      { className: "flex gap-1" },
      h(ui.Button, { type: "button", "aria-label": label("refreshTask", "Refresh task"), onClick: refresh }, refreshIcon(h)),
      h(ui.Button, { type: "button", "aria-label": label("openTask", "Open task"), onClick: open }, openIcon(h)),
    );
  };
}

registry.registerComponent("chat-top-bar", makeTaskActions(host));
```

The group spacing belongs to ActionGroup on new hosts. Keep legacy spacing in
the fallback only. These examples stay in documentation; the template does
not register extra demo actions.

## Stable-host browser smoke

For a release check, use an official stable runtime bundle and verify its
`/health` version before installing the package. Do not treat the SDK source
pin or a development build as a stable release. For this baseline, the
verified host was Kandev `v0.97.0` at
`e43881c7555372897b57ec51c705f1e05da43c40`; the GitHub release publishes the
`kandev-linux-x64.tar.gz` asset with SHA-256
`d15b5ca901fc051dfefbb40a2e0fbec8e92aaf16db8225921f32a6ccdc7d2457`.

Build and verify the host-only package, then upload that exact archive to the
disposable host:

```sh
make verify-package-host
sha256sum kandev-plugin-template-0.1.0.tar.gz
curl --fail --show-error -F 'package=@kandev-plugin-template-0.1.0.tar.gz;type=application/gzip' \
  "$KANDEV_URL/api/plugins/install"
```

Use a separate source checkout at the exact release commit to compare the
runtime's served web files with the production release build. The v0.97.0
release workflow used Node 24, pnpm 9.15.9, the locked `apps` dependencies,
and the `KANDEV_VERSION` stamp:

```sh
git clone --depth 1 --branch v0.97.0 https://github.com/kdlbs/kandev.git \
  "$SMOKE_TMP/source-v0.97.0"
test "$(git -C "$SMOKE_TMP/source-v0.97.0" rev-parse HEAD)" = \
  e43881c7555372897b57ec51c705f1e05da43c40
(cd "$SMOKE_TMP/source-v0.97.0/apps" && corepack pnpm install --frozen-lockfile)
cd "$SMOKE_TMP/source-v0.97.0"
KANDEV_VERSION=v0.97.0 VITE_KANDEV_API_PORT= VITE_KANDEV_DEBUG= \
  corepack pnpm -C apps --filter @kandev/web build
```

Use a task-owned host data directory, database, temporary directory, and port.
Start the official runtime from an empty working directory with a clean
environment, loopback bind, `KANDEV_WEB_DIST_DIR` unset, and no external web
directory candidates. Verify the host log says `dist_dir: embedded`:

```sh
mkdir -p "$SMOKE_TMP"/home "$SMOKE_TMP"/xdg/data "$SMOKE_TMP"/xdg/config \
  "$SMOKE_TMP"/xdg/cache "$SMOKE_TMP"/xdg/state "$SMOKE_TMP"/tmp \
  "$SMOKE_TMP"/empty-cwd
cd "$SMOKE_TMP/empty-cwd"
env -i PATH="$PATH" HOME="$SMOKE_TMP/home" \
  XDG_DATA_HOME="$SMOKE_TMP/xdg/data" \
  XDG_CONFIG_HOME="$SMOKE_TMP/xdg/config" \
  XDG_CACHE_HOME="$SMOKE_TMP/xdg/cache" \
  XDG_STATE_HOME="$SMOKE_TMP/xdg/state" \
  TMPDIR="$SMOKE_TMP/tmp" \
  LANG=C.UTF-8 \
  KANDEV_SERVER_HOST=127.0.0.1 \
  /path/to/release/kandev/bin/kandev run --headless --port 18797
curl --fail --show-error http://127.0.0.1:18797/health
```

Create a local Git-only fixture repository and a task with a composer; do not
use external provider accounts or messages. With the locked Playwright dependency installed here and Chromium available,
return to the plugin template root and run:

```sh
cd /path/to/kandev-plugin-template
KANDEV_RELEASE_SOURCE="$SMOKE_TMP/source-v0.97.0" \
KANDEV_SMOKE_HOST_LOG="$SMOKE_TMP/home/.kandev/logs/backend-logs.log" \
KANDEV_URL=http://127.0.0.1:18797 \
KANDEV_EXPECTED_VERSION=v0.97.0 \
KANDEV_SMOKE_TASK_PATH=/t/<task-id> \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
node scripts/stable-host-smoke.mjs
```

The smoke compares each non-shell file served by the host with the detached
release build and checks that the served shell references the same JS/CSS
assets. It reports a sorted path/content tree SHA-256. It then checks the task
composer's accessible name, exact 28x28 desktop geometry, keyboard focus and
Enter activation, route navigation, disable/re-enable lifecycle, and exactly
one registration after re-enable.

The smoke also opens Quick Chat's setup composer from the desktop sidebar and
the Pixel 5 navigation sheet, before starting a session. Kandev v0.97.0 passes
`taskId: null`, `sessionId: null`, `surface: "quick-chat"`, and the composer
disabled state into the slot. The template action remains enabled because it
navigates independently of message submission; the Quick Chat send control
stays disabled while no profile is selected. Desktop checks the accessible
name, task-free tooltip, focus, and Enter activation. Pixel 5 checks the settled
44x44 host-owned target, coarse pointer, touch, horizontal fit, and tap
navigation. Set `KANDEV_SMOKE_SCREENSHOTS` to keep screenshots elsewhere.
Record the host tag/commit, embedded source log, `/health` version, asset count
and tree digest, package archive name and digest, matrix results, and skips.

The 2026-10-05 run passed on the official `v0.97.0` runtime. Desktop Chromium
rendered a 28x28 Action with accessible name `Template — open page`; Enter
opened `/template`. Disabling the plugin removed the composer action, and
re-enabling it restored exactly one. Pixel 5 rendered one 44x44 action at
393x727 with coarse pointer and touch enabled; the page and plugin route had
no horizontal overflow. The browser reported no page errors. An unauthenticated
POST to the explicitly public API v1 `ping` webhook returned HTTP 200 and
`Hello, webhook!`. No external provider account or real message was used.

The follow-up confirmed embedded web provenance: the official runtime logged
`dist_dir: embedded`; all 655 non-shell files (50,987,359 bytes) served over
HTTP matched the production web build from exact release commit
`e43881c7555372897b57ec51c705f1e05da43c40`. The sorted content tree SHA-256
was `91f577be19688e35aa05245d2aabd695b870549e1a6a0aece429927c66b141ff`.
On desktop and Pixel 5 Quick Chat setup composers, the action had no task or
session scope. With no profile selected, the send control was disabled while
the plugin's navigation Action remained enabled; keyboard and touch activation
both opened `/template`.

## CI and package checks

CI installs public locked npm and Go dependencies without a Kandev checkout,
runs the installed SDK checker, checks Go module tidiness and formatting, runs
vet and the actual backend/UI/recipe tests, and audits recipe dependencies.
Build and release packaging jobs obtain the separate pinned tooling input.

The build workflow compiles the host binary and verifies the five declared
platform binaries. It checks the manifest, UI bundle, exact package file list,
and SHA-256 checksums. Recipe and development files stay outside the package.
Negative tests cover missing files, corrupt content, invalid checksums, and
checksummed recipe or development files.

The release workflow serializes releases without cancelling an active run. A
manual release validates the candidate package before it commits metadata or
pushes a tag. A pushed tag must match the manifest, Makefile, and package
manifest before GitHub creates release assets. Both paths run UI and backend
checks before publication. The published `checksums.txt` contains the package's
internal file checksums and the SHA-256 checksum of the package archive.

## Local validation commands

Use Go `1.26` and Node 24, then run these commands from the plugin repository.
Prepare the README's packaging-tool checkout only before the package targets:

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
make package-host
make verify-package-host
make verify-package
```

`make test` includes Go tests, recipe TypeScript tests and type checking,
composer Action/fallback tests, and negative package and release checks.
`make verify-package-host` checks one host archive. `make verify-package`
cross-compiles and checks every declared platform.

The unit tests prove that one composer registration selects one Action or one
legacy Button. They do not certify a released host. Before a release, smoke the
built package on a disposable host and check focus, keyboard, touch, desktop,
phone, and disable/re-enable behavior at every registered surface.
