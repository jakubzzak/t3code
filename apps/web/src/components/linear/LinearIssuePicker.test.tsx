// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type LinearDesktopRequest,
  type LinearDesktopResult,
} from "@t3tools/contracts";
import { useLinearCreations } from "./linearCreation";
import { useLinearIssueViews } from "./LinearIssueViews";
import { useLinearTeamFilters } from "./LinearTeamSelect";
import { LinearIssuePicker } from "./LinearIssuePicker";

let intersect: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      disconnect() {
        intersect = undefined;
      }
    },
  );
});
const reachEnd = () =>
  act(async () => {
    expect(intersect).toBeDefined();
    intersect!();
  });

const state = vi.hoisted(() => ({
  running: false,
  creationResult: null as null | ((value: unknown) => void),
}));
vi.mock("../preview/previewBridge", () => ({
  previewBridge: {
    automation: {
      status: vi.fn(async () => ({
        available: true,
        loading: false,
        url: "https://linear.app/acme",
      })),
      waitFor: vi.fn(async () => {}),
      press: vi.fn(async () => {}),
      evaluate: vi.fn(async (_id: string, input: { expression: string }) => {
        if (input.expression.includes("return task?.token"))
          return new Promise((resolve) => {
            state.creationResult = resolve;
          });
        return true;
      }),
    },
  },
}));
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
const openIssue = vi.fn(async () => {});
const request = vi.fn<(input: LinearDesktopRequest) => Promise<LinearDesktopResult>>(async () => ({
  configured: true,
  connection: { workspace: "acme", userId: "me", name: "Me", email: "me@example.com" },
  issues: [issue],
  nextCursor: null,
}));
const teamRequest = vi.fn<(input: LinearDesktopRequest) => Promise<LinearDesktopResult>>(
  async () => ({
    configured: true,
    connection: null,
    teams: [{ id: "team-1", key: "ENG", name: "Engineering" }],
  }),
);
const bridgeRequest = (input: LinearDesktopRequest) =>
  input.operation === "teams" ? teamRequest(input) : request(input);
const background = vi.fn(async () => ({
  status: "linked" as const,
  worktreePath: "/worktree",
  conflicts: [],
}));
const render = (
  running = false,
  linkedIssue: typeof issue | null = null,
  backgroundEnabled = false,
  creationEnabled = true,
) =>
  act(async () => {
    Object.assign(window, { desktopBridge: { linearRequest: bridgeRequest } });
    root.render(
      <LinearIssuePicker
        threadId={ThreadId.make("origin")}
        {...(creationEnabled ? { onCreate: async () => "runtime-origin" } : {})}
        {...(backgroundEnabled ? { onBackgroundCreated: background } : {})}
        environmentId={EnvironmentId.make("env")}
        projectId={projectId}
        workspace="acme"
        linkedIssue={linkedIssue}
        running={running}
        onSelect={select}
        onUnlink={async () => {}}
        onOpenThread={opened}
        onOpenIssue={openIssue}
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
  state.creationResult = null;
  useLinearCreations.setState({ entries: {} });
  useLinearIssueViews.setState({ byChat: {} });
  useLinearTeamFilters.setState({ byProject: {} });
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
  state.creationResult = null;
  useLinearCreations.setState({ entries: {} });
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

it("keeps load errors inside the picker and clears the pill error after a successful retry", async () => {
  const message = "This desktop build has no Linear OAuth application configured.";
  request.mockRejectedValueOnce(new Error(message));
  await render();
  await click("Linear issue");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
  expect(button("Linear issue").getAttribute("aria-label")).toContain("error, open for details");
  await click("Linear issue");
  expect(container.textContent).not.toContain(message);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(button("Linear issue").getAttribute("aria-label")).toContain("error, open for details");
  await click("Linear issue");
  expect(button("Linear issue").getAttribute("aria-label")).toBe("Link Linear issue");
  expect(document.body.textContent).not.toContain(message);
});

it("preserves a failed selection's details when reopening the picker", async () => {
  const message = "Unable to check the Linear branch on GitHub.";
  select.mockRejectedValueOnce(new Error(message));
  await render();
  await click("Linear issue");
  await click("Fix login");
  expect(container.textContent).not.toContain(message);
  expect(button("Linear issue").getAttribute("aria-label")).toContain("error, open for details");
  await click("Linear issue");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
  expect(container.textContent).not.toContain(message);
});

const createdResult = { status: "created", issueId: issue.id };
it("automatically sets up a created issue in an unlinked chat", async () => {
  select.mockResolvedValueOnce({ status: "linked", worktreePath: "/worktree", conflicts: [] });
  await render();
  await click("Linear issue");
  await click("Create new issue");
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(select).toHaveBeenCalledExactlyOnceWith(issue, []);
  expect(Object.values(useLinearCreations.getState().entries)).toHaveLength(0);
});
it("asks before replacing an issue, and declining leaves the current context", async () => {
  await render(false, { ...issue, id: "old", identifier: "ENG-2" });
  await click("ENG-2");
  await click("Create new issue");
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(document.body.textContent).toContain("Switch to the new Linear issue?");
  expect(select).not.toHaveBeenCalled();
  await click("Keep current chat");
  expect(select).not.toHaveBeenCalled();
});
it("preserves creation if an agent starts, and never queues a switch when it stops", async () => {
  await render();
  await click("Linear issue");
  await click("Create new issue");
  await render(true);
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(button("Use this issue").disabled).toBe(true);
  await render(false);
  expect(button("Use this issue").disabled).toBe(false);
  expect(select).not.toHaveBeenCalled();
  await click("Use this issue");
  expect(select).toHaveBeenCalledExactlyOnceWith(issue, []);
});
it("retains the result for its originating chat after leaving it", async () => {
  await render();
  await click("Linear issue");
  await click("Create new issue");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(select).not.toHaveBeenCalled();
  await render();
  expect(document.body.textContent).toContain("Use the new Linear issue?");
  expect(select).not.toHaveBeenCalled();
});
it("cancelling creation never sets up an issue", async () => {
  await render();
  await click("Linear issue");
  await click("Create new issue");
  await act(async () => {
    state.creationResult!({ status: "cancelled" });
  });
  expect(select).not.toHaveBeenCalled();
  expect(Object.values(useLinearCreations.getState().entries)).toHaveLength(0);
});

it("sets up the origin in the background without switching the displayed chat", async () => {
  await render(false, null, true);
  await click("Linear issue");
  await click("Create new issue");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(background).toHaveBeenCalledExactlyOnceWith(issue);
  expect(select).not.toHaveBeenCalled();
  expect(Object.values(useLinearCreations.getState().entries)).toHaveLength(0);
});

it("browses all three views without switching the linked issue, retaining the tab when reopened", async () => {
  await render();
  await click("Linear issue");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ view: "assigned", query: "" });
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Assigned to me", "Triage", "All issues"]);
  await click("Triage");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ view: "triage", query: "" });
  await click("All issues");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ view: "all", query: "" });
  await click("Linear issue");
  await click("Linear issue");
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    "All issues",
  );
  expect(select).not.toHaveBeenCalled();
});
it("keeps the create action visible and disabled while running", async () => {
  await render(true);
  await click("Linear issue");
  expect(button("Create new issue")).toBeDefined();
  expect(button("Create new issue").disabled).toBe(true);
  await click("Triage");
  expect(button("Create new issue").disabled).toBe(true);
  expect(select).not.toHaveBeenCalled();
});
it("discards a previous view's pending response and resets its cursor", async () => {
  let resolveAssigned!: (value: LinearDesktopResult) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveAssigned = resolve;
      }),
  );
  await render();
  await click("Linear issue");
  await click("Triage");
  await act(async () =>
    resolveAssigned({
      configured: true,
      connection: null,
      issues: [{ ...issue, title: "Stale assigned issue" }],
      nextCursor: "stale-cursor",
    }),
  );
  expect(document.body.textContent).not.toContain("Stale assigned issue");
  expect(button("Load more")).toBeUndefined();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ view: "triage" });
  expect(request.mock.calls.at(-1)?.[0]).not.toHaveProperty("cursor");
});

const search = async (text: string) =>
  act(async () => {
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search Linear issues"]',
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
it("retains search across tabs, pages only the current view, and retains that view across a remount", async () => {
  await render();
  await click("Linear issue");
  await search("login");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ query: "login", view: "assigned" });
  request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [issue],
    nextCursor: "triage-next",
  });
  await click("Triage");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ query: "login", view: "triage" });
  expect(button("Load more")).toBeUndefined();
  await reachEnd();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
    query: "login",
    view: "triage",
    cursor: "triage-next",
  });
  await click("All issues");
  expect(request.mock.calls.at(-1)?.[0]).not.toHaveProperty("cursor");
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Search Linear issues"]')?.value,
  ).toBe("login");
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  await click("Linear issue");
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    "All issues",
  );
});
it("keeps creation available through loading, empty and failed searches, and explains unavailable creation", async () => {
  let resolve!: (value: LinearDesktopResult) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render();
  await click("Linear issue");
  expect(document.body.textContent).toContain("Loading issues");
  expect(button("Create new issue").disabled).toBe(false);
  await act(async () => resolve({ configured: true, connection: null, issues: [] }));
  expect(document.body.textContent).toContain("No issues found");
  expect(button("Create new issue").disabled).toBe(false);
  request.mockRejectedValueOnce(new Error("Temporary query failure"));
  await click("Triage");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Temporary query failure");
  expect(button("Create new issue").disabled).toBe(false);
  await render(false, null, false, false);
  expect(button("Create new issue").disabled).toBe(true);
  expect(document.body.textContent).toContain("Issue creation is unavailable for this chat");
});
it("discards a pending search after the query changes", async () => {
  await render();
  await click("Linear issue");
  let resolve!: (value: LinearDesktopResult) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await search("old");
  await search("new");
  await act(async () =>
    resolve({
      configured: true,
      connection: null,
      issues: [{ ...issue, title: "Stale search result" }],
      nextCursor: "old",
    }),
  );
  expect(document.body.textContent).not.toContain("Stale search result");
  expect(button("Load more")).toBeUndefined();
});

it("keeps a successful created-issue association when opening its panel fails", async () => {
  select.mockResolvedValueOnce({ status: "linked", worktreePath: "/worktree", conflicts: [] });
  openIssue.mockRejectedValueOnce(new Error("Panel offline"));
  await render();
  await click("Linear issue");
  await click("Create new issue");
  await act(async () => state.creationResult!(createdResult));
  await click("Linear issue");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Issue linked to this chat, but Linear could not open",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Panel offline");
  expect(Object.values(useLinearCreations.getState().entries)).toEqual([]);
  expect(button("Use this issue")).toBeUndefined();
});

it("focuses search on opening despite the leading team selector", async () => {
  await render();
  await click("Linear issue");
  expect(document.querySelector('[aria-label="Filter Linear teams"]')).not.toBeNull();
  expect(document.activeElement).toBe(
    document.querySelector('input[aria-label="Search Linear issues"]'),
  );
});

it("remembers the team filter across reopening and stored-state rehydration, and clears it with All teams", async () => {
  await render();
  await click("Linear issue");
  await click("All teams");
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((el) => el.textContent?.includes("Engineering"))!
      .click();
  });
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1", view: "assigned" });
  await search("login");
  await click("Triage");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
    teamId: "team-1",
    query: "login",
    view: "triage",
  });
  const saved = localStorage.getItem("t3code:linear-team-filters:v1")!;
  await act(async () => root.unmount());
  root = createRoot(container);
  useLinearTeamFilters.setState({ byProject: {} });
  localStorage.setItem("t3code:linear-team-filters:v1", saved);
  await useLinearTeamFilters.persist.rehydrate();
  await render();
  await click("Linear issue");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1" });
  expect(document.activeElement).toBe(
    document.querySelector('input[aria-label="Search Linear issues"]'),
  );
  await click("ENG");
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((el) => el.textContent === "All teams")!
      .click();
  });
  expect(request.mock.calls.at(-1)?.[0]).not.toHaveProperty("teamId");
});
it("loads one next page at a time, keeps results on failure, and retries the same cursor", async () => {
  request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [issue],
    nextCursor: "next",
  });
  await render();
  await click("Linear issue");
  let reject!: (cause: Error) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    const notify = intersect!;
    notify();
    notify();
  });
  expect(request.mock.calls.filter(([input]) => input.cursor === "next")).toHaveLength(1);
  await act(async () => reject(new Error("Next page offline")));
  expect(document.body.textContent).toContain("Fix login");
  expect(document.body.textContent).toContain("Next page offline");
  expect(intersect).toBeUndefined();
  request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [{ ...issue, id: "issue-2", title: "Next issue" }],
    nextCursor: null,
  });
  await click("Retry");
  expect(request.mock.calls.at(-1)?.[0].cursor).toBe("next");
  expect(document.body.textContent).toContain("Fix login");
  expect(document.body.textContent).toContain("Next issue");
  expect(button("Load more")).toBeUndefined();
});

it("does not let a pending page or its old observer override a changed team filter", async () => {
  request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [issue],
    nextCursor: "old-next",
  });
  await render();
  await click("Linear issue");
  const oldObserver = intersect!;
  let resolve!: (value: LinearDesktopResult) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await reachEnd();
  await click("All teams");
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((el) => el.textContent?.includes("Engineering"))!
      .click();
    oldObserver();
  });
  await act(async () =>
    resolve({
      configured: true,
      connection: null,
      issues: [{ ...issue, title: "Stale other team" }],
      nextCursor: "stale",
    }),
  );
  expect(document.body.textContent).not.toContain("Stale other team");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1" });
  expect(request.mock.calls.at(-1)?.[0]).not.toHaveProperty("cursor");
});
it("retains a saved filter on team-load failure and retries the team list", async () => {
  useLinearTeamFilters.getState().select(JSON.stringify(["env", "project", "acme"]), "team-1");
  teamRequest.mockRejectedValueOnce(new Error("Teams offline"));
  await render();
  await click("Linear issue");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1" });
  await click("Saved team");
  expect(document.body.textContent).toContain("Could not load teams");
  await click("Retry teams");
  expect(document.body.textContent).toContain("Engineering");
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1" });
});

it("includes teams beyond the first API page in the selector", async () => {
  teamRequest.mockResolvedValueOnce({
    configured: true,
    connection: null,
    teams: [{ id: "team-1", key: "ENG", name: "Engineering" }],
    nextCursor: "teams-next",
  });
  teamRequest.mockResolvedValueOnce({
    configured: true,
    connection: null,
    teams: [{ id: "team-2", key: "DES", name: "Design" }],
    nextCursor: null,
  });
  await render();
  await click("Linear issue");
  expect(teamRequest.mock.calls.at(-1)?.[0].cursor).toBe("teams-next");
  await click("All teams");
  expect(document.body.textContent).toContain("DES · Design");
  expect(document.body.textContent).toContain("ENG · Engineering");
});
