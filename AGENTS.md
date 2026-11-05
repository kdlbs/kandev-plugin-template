# Plugin repository workflow

This repository owns only `kandev-plugin-template`. Use the parent project's
[create-kandev-plugin workflow](https://github.com/kdlbs/kandev/blob/f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb/.agents/skills/create-kandev-plugin/SKILL.md)
and [public authoring guide](https://github.com/kdlbs/kandev/blob/f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb/docs/public/plugins-authoring.md).
Preserve plugin identity, API v1, explicit webhook access, capabilities, settings,
and opt-in recipe boundaries unless the requested change requires otherwise.

Go and frontend SDKs share independent version `0.1.0`: use
`github.com/kdlbs/kandev/pluginsdk v0.1.0` and exactly `@kdlbs/plugin-sdk` `0.1.0`.
Do not restore SDK-local replacements, file links, or sibling compilation inputs.
Generated protocol imports belong under `github.com/kdlbs/kandev/pluginsdk/proto/`.
Read installed `sdk-release.json` records before changing the minimum host;
currently both require `0.99.0` and support manifest API versions 1 and 2.
Regenerate committed lockfiles with Go/npm. Keep SDK, host, plugin, and API
versions distinct, and upgrade deliberately.

From the plugin root with Go 1.26 and Node 24, run:

```sh
npm ci --ignore-scripts
go mod tidy
make sdk-check check-format vet test audit-recipes build
```

`make test` includes real backend/recipe tests, recipe type checking, UI Action
and fallback tests, HTTP restart-polling checks, package-verifier negatives,
and release-version negatives.
Verify standalone dependency resolution without sibling SDK sources.

Packaging is separate: `plugin-pack` is backend-owned. Prepare the README's
checkout in `.build/kandev-tooling`, select the revision from
`.kandev-tooling-ref`, and include `apps/backend` and root `pluginsdk`, then
run `make verify-package-host` and `make verify-package`. `KANDEV_TOOLING`
selects its backend directory. Do not claim checkout-free packaging. Inspect
archive contents/checksums and smoke-test the artifact in a disposable host at
the declared minimum. Record exact commands/results and any skipped surfaces.
See `docs/sdk-migration.md` for the current evidence.

Do not merge, publish releases, change catalog versions, or contact external
authors without an explicit instruction.
