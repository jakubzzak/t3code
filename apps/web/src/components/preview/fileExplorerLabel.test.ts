import { FolderOpenIcon } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";

import { FileExplorerIcon, FinderIcon } from "~/components/Icons";
import {
  revealInFileExplorerIcon,
  revealInFileExplorerLabel,
  revealInFileExplorerLabelForKind,
  revealInFileExplorerLabelForOs,
} from "./fileExplorerLabel";

describe("revealInFileExplorerLabel", () => {
  it.each([
    ["MacIntel", "Reveal in Finder"],
    ["Win32", "Reveal in File Explorer"],
    ["Linux x86_64", "Reveal in Files"],
  ])("maps %s to %s", (platform, expected) => {
    expect(revealInFileExplorerLabel(platform)).toBe(expected);
  });
});

describe("revealInFileExplorerIcon", () => {
  it.each([
    ["MacIntel", FinderIcon],
    ["Win32", FileExplorerIcon],
    ["Linux x86_64", FolderOpenIcon],
  ] as const)("uses the matching file manager icon on %s", (platform, Icon) => {
    expect(revealInFileExplorerIcon(platform)).toBe(Icon);
  });
});

describe("revealInFileExplorerLabelForOs", () => {
  it.each([
    ["darwin", "Reveal in Finder"],
    ["windows", "Reveal in File Explorer"],
    ["linux", "Reveal in Files"],
    ["unknown", "Reveal in Files"],
  ] as const)("maps %s to %s", (os, expected) => {
    expect(revealInFileExplorerLabelForOs(os)).toBe(expected);
  });
});

describe("revealInFileExplorerLabelForKind", () => {
  it.each([
    ["finder", "Reveal in Finder"],
    ["file-explorer", "Reveal in File Explorer"],
    ["files", "Reveal in Files"],
  ] as const)("maps %s to %s", (kind, expected) => {
    expect(revealInFileExplorerLabelForKind(kind)).toBe(expected);
  });
});
