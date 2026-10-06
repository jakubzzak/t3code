/* oxlint-disable unicorn/require-post-message-target-origin -- Native WebView bridge accepts one string. */
import { renderMermaid } from "@t3tools/shared/mermaid";

declare global {
  interface Window {
    ReactNativeWebView: { postMessage(message: string): void };
    renderDiagram: (code: string, theme: "light" | "dark") => Promise<void>;
  }
}

window.renderDiagram = async (code, theme) => {
  try {
    const svg = await renderMermaid(code, theme);
    document.body.innerHTML = svg;
    const element = document.querySelector("svg");
    if (element) {
      element.style.maxWidth = "100%";
      element.style.height = "auto";
    }
    window.ReactNativeWebView.postMessage(
      JSON.stringify({ height: Math.ceil(document.body.getBoundingClientRect().height) }),
    );
  } catch {
    window.ReactNativeWebView.postMessage(JSON.stringify({ error: true }));
  }
};
