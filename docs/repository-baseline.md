# Repository baseline

This template carries the reviewed repository patterns for Kandev plugins.
Use these patterns when you update a plugin repository. Keep each plugin's
existing identity, settings, permissions, provider behavior, and translations.

## Host source pin and runtime floor

`.kandev-sdk-ref` pins the Go and frontend SDK source to
`570600439036e81f8e9e1c63f15c4abce8a6c846`. This host commit merged PR #3943,
which adds `host.ui.Action` and `host.ui.ActionGroup`. The previous source pin,
`f218880ecbaa3d019d65b5d84fca6bdf160eced6`, predates those exports.

CI, package builds, and release workflows read the same pin file. Do not use a
floating branch for an SDK checkout. Keep the source pin separate from the
runtime minimum in `manifest.yaml`. This template keeps its existing
`min_kandev_version: "0.86.0"` because it selects a legacy button when Action
is absent. The source pin is not a runtime release number. Do not guess a new
minimum while the host API awaits a stable release.

## Go module tidy and dependency rationale

Use Go `1.26.0` with this exact SDK source pin. From the plugin root, run
`go mod tidy && git diff --exit-code -- go.mod go.sum`. Run it a second time
with the same Go version and SDK checkout; it must produce no diff.

For this baseline, tidy against SDK commit
`570600439036e81f8e9e1c63f15c4abce8a6c846` updates the transitive Go modules:
`golang.org/x/net` 0.56.0 to 0.58.0, `golang.org/x/sys` 0.46.0 to 0.48.0,
`golang.org/x/text` 0.39.0 to 0.42.0,
`google.golang.org/genproto/googleapis/rpc` from
`v0.0.0-20260414002931-afd174a4e478` to
`v0.0.0-20260526163538-3dc84a4a5aaa`, and `google.golang.org/grpc` 1.82.1 to
1.83.1. Keep this reproducible tidy diff; do not add discretionary Go module
upgrades to it. The gRPC change overlaps [open PR #7](https://github.com/kdlbs/kandev-plugin-template/pull/7).
The `x/net` and `x/text` updates follow security work in [merged PR #3](https://github.com/kdlbs/kandev-plugin-template/pull/3), whose branch also pinned workflow actions. This overlap does not mean this baseline completes or replaces a security review.

These are SDK build dependencies. Their versions do not establish runtime
compatibility with a Kandev release. Keep the separate minimum-host check at
the existing `0.86.0` floor and test the built artifact against each supported
host surface.

The manifest remains API v1. Its explicit `access: "public"` preserves the
existing webhook behavior. At the pinned host commit, API v1 keeps the legacy
public default and API v2 defaults to authenticated access. Do not change the
API version as part of repository cleanup.

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

## CI and package checks

The pull request workflows pin their Actions by commit and use the SDK pin
above. CI installs locked npm dependencies with Node 24, checks Go module
tidiness, checks formatting, runs `go vet` and tests, and audits recipe
dependencies. A separate job tests the provider-free backend on the existing
Kandev 0.86.0 floor.

The build workflow compiles the host binary and verifies the five declared
platform binaries. It checks the manifest, UI bundle, exact package file list,
and SHA-256 checksums. Recipe and development files stay outside the package.
Negative tests cover missing files, corrupt content, invalid checksums, and
checksummed recipe or development files.

The release workflow serializes releases without cancelling an active run. A
manual release validates the candidate package before it commits metadata or
pushes a tag. A pushed tag must match the manifest, Makefile, and package
manifest before GitHub creates release assets. Both paths run UI and backend
checks before publication.

## Local validation commands

Create the sibling Kandev checkout at the source pin before you build. Use Go
`1.26.0`, then run these commands from the plugin repository:

```sh
npm ci --ignore-scripts
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
