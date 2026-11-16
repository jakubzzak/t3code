import type { DesktopTerminalCommandState } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render, stubGlobal } from "../../../test/render";
import { TerminalCommandSettings } from "./TerminalCommandSettings";
import { searchSettings } from "./settingsSearch";

// Desktop-only settings are searchable only in Electron, which a test browser is not.
vi.mock(import("~/env"), async (original) => ({ ...(await original()), isElectron: true }));

const initial: DesktopTerminalCommandState = {
  status: "not-installed",
  installed: false,
  path: "/home/test/.local/bin/t3",
  directory: "/home/test/.local/bin",
  onPath: false,
  conflictingPath: null,
};

const searchIds = () => searchSettings("terminal launcher").map((item) => item.id);

it("recovers from installation failure, explains PATH, and removes the command", async () => {
  let attempts = 0;
  using _bridge = stubGlobal("desktopBridge", {
    terminalCommand: {
      get: async () => initial,
      install: async () => {
        if (++attempts === 1) throw new Error("Directory is not writable");
        return { ...initial, status: "installed", installed: true };
      },
      remove: async () => initial,
    },
  });
  await using screen = await render(<TerminalCommandSettings />);
  expect(searchIds()).toContain("terminal-command");

  await screen.getByRole("button", { name: "Install t3 command" }).click();
  await expect.element(screen.getByRole("alert")).toMatchTextContent("Directory is not writable");

  await screen.getByRole("button", { name: "Install t3 command" }).click();
  await expect.element(screen.getByRole("button", { name: "Remove command" })).toBeVisible();
  await expect.element(screen.container).toMatchTextContent("PATH");
  await expect.element(screen.container).toMatchTextContent(initial.directory);

  await screen.getByRole("button", { name: "Remove command" }).click();
  await expect.element(screen.getByRole("button", { name: "Install t3 command" })).toBeVisible();
});

it("hides setup and search results without the desktop terminal bridge", async () => {
  using _bridge = stubGlobal("desktopBridge", undefined);
  await using screen = await render(<TerminalCommandSettings />);
  expect(screen.container.textContent).toBe("");
  expect(searchIds()).not.toContain("terminal-command");
});

it("leaves independent commands alone and offers refresh after a conflict", async () => {
  let removedConflict = false;
  using _bridge = stubGlobal("desktopBridge", {
    terminalCommand: {
      get: async () =>
        removedConflict
          ? initial
          : { ...initial, status: "conflict", conflictingPath: "/usr/local/bin/t3" },
    },
  });
  await using screen = await render(<TerminalCommandSettings />);
  await expect.element(screen.container).toMatchTextContent("/usr/local/bin/t3");
  await expect.element(screen.container).not.toMatchTextContent("Remove command");

  removedConflict = true;
  await screen.getByRole("button", { name: "Check again" }).click();
  await expect.element(screen.getByRole("button", { name: "Install t3 command" })).toBeVisible();
});
