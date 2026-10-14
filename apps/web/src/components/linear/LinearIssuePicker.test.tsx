// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { LinearIssuePicker } from "./LinearIssuePicker";

const state = vi.hoisted(() => ({ running: false }));
vi.mock("~/state/entities", () => ({
  useThreadShellsForProjectRefs: () => [
    { id: "previous", session: { status: state.running ? "running" : "idle" } },
  ],
}));
vi.mock("@tanstack/react-pacer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-pacer")>()),
  useDebouncedValue: (value: string) => [value],
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
const issue = {
  id: "issue-1",
  identifier: "ENG-123",
  title: "Fix login",
  workspace: "acme",
  url: "https://linear.app/acme/issue/ENG-123",
  branchName: "eng-123-fix-login",
};
const projectId = ProjectId.make("project");
const select = vi.fn(async (_issue: typeof issue, takeover: readonly ThreadId[]) =>
  takeover.length
    ? { status: "linked" as const, worktreePath: "/worktree", conflicts: [] }
    : {
        status: "conflict" as const,
        worktreePath: "/worktree",
        conflicts: [
          {
            threadId: ThreadId.make("previous"),
            projectId,
            title: "Previous work",
            running: state.running,
          },
        ],
      },
);
const opened = vi.fn();
const request = vi.fn(async () => ({
  configured: true,
  connection: { workspace: "acme", userId: "me", name: "Me", email: "me@example.com" },
  issues: [issue],
  nextCursor: null,
}));
const render = (running = false) =>
  act(async () => {
    Object.assign(window, { desktopBridge: { linearRequest: request } });
    root.render(
      <LinearIssuePicker
        environmentId={EnvironmentId.make("env")}
        projectId={projectId}
        workspace="acme"
        linkedIssue={null}
        running={running}
        onSelect={select}
        onUnlink={async () => {}}
        onOpenThread={opened}
      />,
    );
  });
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent?.includes(text))!;
const click = (text: string) =>
  act(async () => {
    const target = button(text);
    expect(target).toBeDefined();
    target.click();
  });
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  state.running = false;
  vi.clearAllMocks();
  Object.assign(window, { desktopBridge: undefined });
});
it("selects directly, explains a running conflict, and enables takeover only after the agent stops", async () => {
  state.running = true;
  await render();
  await click("Linear issue");
  await click("Fix login");
  expect(document.body.textContent).toContain("This worktree has an active chat");
  expect(document.body.textContent).toContain("An agent is running in the existing chat");
  expect(button("Use this chat").disabled).toBe(true);
  state.running = false;
  await render();
  expect(button("Use this chat").disabled).toBe(false);
  expect(select).toHaveBeenCalledTimes(1);
  await click("Use this chat");
  expect(select).toHaveBeenCalledTimes(2);
  expect(select.mock.calls[1]?.[1]).toEqual(["previous"]);
});
it("allows opening an existing chat while its agent runs, without taking over", async () => {
  state.running = true;
  await render();
  await click("Linear issue");
  await click("Fix login");
  await click("Open existing chat");
  expect(opened).toHaveBeenCalledExactlyOnceWith("previous");
  expect(select).toHaveBeenCalledTimes(1);
});
it("disables issue selection while the current agent runs and does not queue a switch", async () => {
  await render(true);
  await click("Linear issue");
  expect(document.body.textContent).toContain("Wait for the agent in this chat to finish");
  expect(button("Fix login").disabled).toBe(true);
  await render(false);
  expect(button("Fix login").disabled).toBe(false);
  expect(select).not.toHaveBeenCalled();
});
