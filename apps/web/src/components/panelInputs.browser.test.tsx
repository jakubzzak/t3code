import { createRef } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { installSectionNavigation } from "../sectionNavigation";
import { FileSearchField } from "./files/FileBrowserPanel";
import { PreviewChromeRow } from "./preview/PreviewChromeRow";

const noop = () => {};

function sectionNavigation(): Disposable {
  const cleanup = installSectionNavigation({
    platform: "MacIntel",
    reveal: noop,
    focusComposer: noop,
  });
  return { [Symbol.dispose]: cleanup };
}

it.each(["url", "files"])(
  "preserves the %s input until the second Escape and returns to panel focus",
  async (kind) => {
    using _navigation = sectionNavigation();
    const container = document.createElement("div");
    container.dataset.navigationSection = "surfaces";
    await using screen = await render(
      kind === "url" ? (
        <PreviewChromeRow
          url="https://example.com/draft"
          urlInputRef={createRef<HTMLInputElement>()}
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
      { container },
    );
    const input = screen.container.querySelector("input")!;
    input.focus();
    const before = input.value;
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(document.body);
    expect(input.value).toBe(before);
    expect(document.documentElement.dataset.selectedSection).toBe("surfaces");
  },
);
