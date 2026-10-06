let queue = Promise.resolve();
let nextId = 0;

/** Mermaid's configuration is global. Serialize initialization and rendering across themes. */
export function renderMermaid(code: string, theme: "light" | "dark", signal?: AbortSignal) {
  const result = queue.then(async () => {
    signal?.throwIfAborted();
    if (code.length > 50_000) throw new Error("This diagram is too large to preview.");
    const { default: mermaid } = await import("mermaid");
    signal?.throwIfAborted();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: "system-ui, sans-serif",
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
    });
    const { svg } = await mermaid.render(`t3-mermaid-${++nextId}`, code);
    signal?.throwIfAborted();
    return svg;
  });
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
