// The host supplies React and admitted bytes on both file and rich-preview surfaces.
export function registerFileViewer(registry, host, { id, render, errorKey }) {
  if (typeof registry.registerFileViewer !== "function") throw Error("file_viewer_host_required");
  const { createElement: h, useEffect, useRef, useState } = host.React;
  function Viewer({ file, readBytes }) {
    const container = useRef(null);
    const [failed, setFailed] = useState(false);
    const { t } = host.i18n.useTranslation();
    useEffect(() => {
      setFailed(false);
      return mountFilePreview(container.current, readBytes, render, () => setFailed(true));
    }, [file.generation, readBytes]);
    return h("div", { style: { width: "100%", height: "100%", minHeight: 0 } },
      failed ? h("p", { role: "alert" }, t(errorKey)) : null,
      h("div", { ref: container, hidden: failed,
        style: { width: "100%", height: "100%", minHeight: 0 } }),
    );
  }
  registry.registerFileViewer({ id, Component: Viewer });
}

export function mountFilePreview(container, readBytes, render, onError) {
  const controller = new AbortController();
  let dispose;
  Promise.resolve().then(() => readBytes(controller.signal)).then((bytes) => {
    if (!controller.signal.aborted) dispose = render(container, bytes, controller.signal);
  }).catch(() => {
    if (!controller.signal.aborted) onError();
  });
  return () => {
    controller.abort();
    dispose?.();
    dispose = undefined;
  };
}
