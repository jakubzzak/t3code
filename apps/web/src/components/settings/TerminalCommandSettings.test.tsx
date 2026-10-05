// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { DesktopTerminalCommandState } from "@t3tools/contracts";
import { TerminalCommandSettings } from "./TerminalCommandSettings";
import { searchSettings } from "./settingsSearch";

vi.mock("~/env", () => ({ isElectron: true }));

vi.mock("./settingsLayout", () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingsRow: ({
    children,
    control,
    description,
  }: {
    children: React.ReactNode;
    control: React.ReactNode;
    description: React.ReactNode;
  }) => (
    <div>
      {description}
      {control}
      {children}
    </div>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
const initial: DesktopTerminalCommandState = {
  status: "not-installed",
  installed: false,
  path: "/home/test/.local/bin/t3",
  directory: "/home/test/.local/bin",
  onPath: false,
  conflictingPath: null,
};
const click = async (name: string) => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === name,
  );
  expect(button, `Expected ${name} button`).toBeDefined();
  await act(async () => button!.click());
};
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  Object.assign(window, { desktopBridge: undefined });
});

it("recovers from installation failure, explains PATH, and removes the command", async () => {
  let attempts = 0;
  Object.assign(window, {
    desktopBridge: {
      terminalCommand: {
        get: async () => initial,
        install: async () => {
          if (++attempts === 1) throw new Error("Directory is not writable");
          return { ...initial, status: "installed", installed: true };
        },
        remove: async () => initial,
      },
    },
  });
  await act(async () => root.render(<TerminalCommandSettings />));
  expect(searchSettings("terminal launcher").map((item) => item.id)).toContain("terminal-command");
  await click("Install t3 command");
  expect(container.textContent).toContain("Directory is not writable");
  await click("Install t3 command");
  expect(container.textContent).toContain("PATH");
  expect(container.textContent).toContain(initial.directory);
  await click("Remove command");
  expect(container.textContent).toContain("Install t3 command");
});

it("hides setup and search results without the desktop terminal bridge", async () => {
  await act(async () => root.render(<TerminalCommandSettings />));
  expect(container.textContent).toBe("");
  expect(searchSettings("terminal launcher").map((item) => item.id)).not.toContain(
    "terminal-command",
  );
});

it("leaves independent commands alone and offers refresh after a conflict", async () => {
  let removedConflict = false;
  Object.assign(window, {
    desktopBridge: {
      terminalCommand: {
        get: async () =>
          removedConflict
            ? initial
            : { ...initial, status: "conflict", conflictingPath: "/usr/local/bin/t3" },
      },
    },
  });
  await act(async () => root.render(<TerminalCommandSettings />));
  expect(container.textContent).toContain("/usr/local/bin/t3");
  expect(container.textContent).not.toContain("Remove command");
  removedConflict = true;
  await click("Check again");
  expect(container.textContent).toContain("Install t3 command");
});
