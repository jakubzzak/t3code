// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { markdownCodeBlocks, setMarkdownCodeLanguage } from "@t3tools/shared/markdownCode";
import { useMarkdownCodeViews } from "./useMarkdownCodeViews";

function Document({ markdown }: { markdown: string }) {
  const { blocks, sourceViews, toggleSource } = useMarkdownCodeViews(markdown);
  return [...blocks].map(([offset, block], index) => (
    <button key={offset} data-block={index} onClick={() => toggleSource(block.viewKey)}>
      {sourceViews.has(block.viewKey) ? "Source" : "Diagram"}
    </button>
  ));
}

const markdown =
  "Intro 😀\n\n```text\nflowchart LR\nA-->B\n```\n\n> ```mermaid\n> flowchart LR\n> C-->D\n> ```";
function changeLanguage(text: string, index: number, language: string) {
  const block = markdownCodeBlocks(text)[index]!;
  return setMarkdownCodeLanguage(text, {
    blockStart: block.start,
    expectedLanguage: block.language,
    language,
  });
}
let view: Root;
let container: HTMLDivElement;
const block = (index: number) =>
  container.querySelector<HTMLButtonElement>(`[data-block="${index}"]`)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  view = createRoot(container);
});
afterEach(async () => {
  await act(async () => view?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("native Markdown code view choices", () => {
  it("retains source across earlier language edits and streamed appends, then resets on reopen", async () => {
    await act(async () => {
      view.render(<Document markdown={markdown} />);
    });
    await act(async () => {
      block(1).click();
    });
    expect(block(1).textContent).toBe("Source");
    const edited = changeLanguage(markdown, 0, "mermaid");
    await act(async () => {
      view.render(<Document markdown={edited} />);
    });
    expect(block(0).textContent).toBe("Diagram");
    expect(block(1).textContent).toBe("Source");
    await act(async () => {
      view.render(<Document markdown={edited + "\n\nMore streamed text"} />);
    });
    expect(block(1).textContent).toBe("Source");
    await act(async () => {
      view.unmount();
    });
    await act(async () => {
      view = createRoot(container);
      view.render(<Document markdown={edited} />);
    });
    expect(block(1).textContent).toBe("Diagram");
  });

  it("resets only the block whose own language changes, including a return to Mermaid", async () => {
    const twoDiagrams = changeLanguage(markdown, 0, "mermaid");
    await act(async () => {
      view.render(<Document markdown={twoDiagrams} />);
    });
    await act(async () => {
      block(0).click();
      block(1).click();
    });
    const code = changeLanguage(twoDiagrams, 0, "text");
    await act(async () => {
      view.render(<Document markdown={code} />);
    });
    await act(async () => {
      view.render(<Document markdown={twoDiagrams} />);
    });
    expect(block(0).textContent).toBe("Diagram");
    expect(block(1).textContent).toBe("Source");
    await act(async () => {
      block(1).click();
    });
    expect(block(1).textContent).toBe("Diagram");
  });
});
