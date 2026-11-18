# One viewer for file panels and rich previews

This opt-in recipe targets the development file-viewer contract. The released
SDK 0.1.0 and host minimum used by the default template do not establish support
for this new contract. Keep the recipe out of default packages until the host
contract and matching SDK are released. Set the minimum host to that actual
release before publishing; do not guess a release number.

Merge this fragment into your plugin manifest (keep its existing bundle path):

```yaml
ui:
  file_viewers:
    - id: model
      title: Model viewer
      extensions: [shape]
```

Bundle `register.js` with your UI. Call it from your existing plugin initializer:

```js
import { registerFileViewer } from './recipes/file-viewer/register.js';
// Inside initialize(registry, host), after registering your translations:
registerFileViewer(registry, host, {
  id: 'model',
  errorKey: 'previewFailed',
  render: renderModel,
});
```

Implement `renderModel(container, bytes, signal)` for your format. It must return
an idempotent cleanup function. Register a localized `previewFailed` message.
The same component is mounted in opened files and rich chat cards. No separate
chat registration, MCP tool, HTML renderer, URL fetch, or file-reading webhook
is required. Built-in previews and source editors retain host priority.

Use the supplied container's dimensions, observe resize, and keep touch controls
reachable in a narrow card. Keep pointer and keyboard handling inside the model
viewport. Leave space outside it for chat scrolling. Release workers, observers,
event listeners, animation frames, geometries, materials, and GPU contexts in
cleanup. Bound parser allocations and geometry before rendering; run expensive
parsing in a worker with a deadline. The recipe only handles read/unmount races;
your renderer owns its format limits and partial-initialization cleanup.

Use only `readBytes(signal)` for model content. The host checks permissions and
external-file Ask/Allow/Deny before mounting the component. Do not bypass that
check with another API. Native plugins remain trusted code, not sandboxed code.
Collapse, scrolling out of view, file switching, plugin unload, and context changes
can dispose a viewer. Do not persist bytes, grants, or DOM/GPU resources.

An agent references a workspace-relative file through `show_rich_output_kandev`:

```json
{"version":2,"catalog_version":1,"title":"Model","spec":{"root":"model","elements":{"model":{"type":"FilePreview","props":{"path":"models/part.shape","repo":"models"},"children":[]}}}}
```

Omit `repo` for an unambiguous single-repository task. A repository symlink to an
external file still requires the external-file policy. The agent cannot select
permissions or supply a component. File previews show the current file, not an
immutable attachment. Missing or disabled viewers show host recovery/discovery.
The host currently admits one live plugin preview per browser; another card can
show Busy until the first is collapsed or leaves view, then Retry preview.

Validate lifecycle behavior with:

```sh
node --test recipes/file-viewer/register.test.js
```

Also install the packaged plugin in a compatible disposable host. Test both a
file panel and a rich FilePreview on desktop and phone, including external
consent, collapse, scroll out of view, re-expansion, plugin disable, malformed
files, and limits. See Kandev's `docs/public/plugins-authoring.md` for the
canonical contract and `docs/plans/plugins/PLUGIN-API.md` for frontend types.
