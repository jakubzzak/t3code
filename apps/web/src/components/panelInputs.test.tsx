// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { installSectionNavigation } from "../sectionNavigation";
import { PreviewChromeRow } from "./preview/PreviewChromeRow";
import { FileSearchField } from "./files/FileBrowserPanel";

let root: Root;
let container: HTMLDivElement;
let cleanup: () => void;
const noop = () => {};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  container.dataset.navigationSection = "surfaces";
  document.body.append(container);
  root = createRoot(container);
  cleanup = installSectionNavigation({ platform: "MacIntel", reveal: noop, focusComposer: noop });
});
afterEach(async () => {
  cleanup();
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each(["url", "files"])(
  "preserves the %s input until the second Escape and returns to panel focus",
  async (kind) => {
    await act(async () =>
      root.render(
        kind === "url" ? (
          <PreviewChromeRow
            url="https://example.com/draft"
            loading={false}
            canGoBack={false}
            canGoForward={false}
            refreshDisabled={false}
            onBack={noop}
            onForward={noop}
            onRefresh={noop}
            onSubmit={noop}
          />
        ) : (
          <FileSearchField
            value="unfinished query"
            ariaLabel="Search files"
            name="files"
            onValueChange={noop}
          />
        ),
      ),
    );
    const input = container.querySelector("input")!;
    await act(async () => input.focus());
    const before = input.value;
    const escape = () =>
      act(async () => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      });
    await escape();
    expect(document.activeElement).toBe(input);
    await escape();
    expect(document.activeElement).toBe(document.body);
    expect(input.value).toBe(before);
    expect(document.documentElement.dataset.selectedSection).toBe("surfaces");
  },
);
