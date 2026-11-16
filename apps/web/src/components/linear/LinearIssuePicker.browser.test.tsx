import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type LinearDesktopRequest,
  type LinearDesktopResult,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render, stubGlobal } from "../../../test/render";
import { useLinearCreations } from "./linearCreation";
import { useLinearIssueViews } from "./LinearIssueViews";
import { useLinearTeamFilters } from "./LinearTeamSelect";
import { useLinearIssuePreferences } from "./linearIssuePreferences";
import { LinearIssuePicker } from "./LinearIssuePicker";

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
    { id: "previous", runtime: { status: state.running ? "running" : "idle" } },
  ],
}));
const issue = {
  id: "issue-1",
  identifier: "ENG-123",
  title: "Fix login",
  workspace: "acme",
  url: "https://linear.app/acme/issue/ENG-123",
  branchName: "eng-123-fix-login",
};
const projectId = ProjectId.make("project");

const resetStores = () => {
  useLinearCreations.setState({ entries: {} });
  useLinearIssueViews.setState({ byChat: {} });
  useLinearTeamFilters.setState({ byProject: {} });
  useLinearIssuePreferences.setState({ byProject: {} });
};

/**
 * Resets the shared mock state and stores, stubs IntersectionObserver so tests decide when the
 * list end is reached, and installs the desktop Linear bridge. Dispose restores all of it.
 */
function setup() {
  using stack = new DisposableStack();
  state.running = false;
  state.creationResult = null;
  resetStores();
  stack.defer(resetStores);
  let intersect: (() => void) | undefined;
  stack.use(
    stubGlobal(
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
    ),
  );
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
  const unlink = vi.fn(async () => {});
  const request = vi.fn<(input: LinearDesktopRequest) => Promise<LinearDesktopResult>>(
    async () => ({
      configured: true,
      connection: { workspace: "acme", userId: "me", name: "Me", email: "me@example.com" },
      issues: [issue],
      nextCursor: null,
    }),
  );
  const teamRequest = vi.fn<(input: LinearDesktopRequest) => Promise<LinearDesktopResult>>(
    async () => ({
      configured: true,
      connection: null,
      teams: [{ id: "team-1", key: "ENG", name: "Engineering" }],
    }),
  );
  const stateRequest = vi.fn<(input: LinearDesktopRequest) => Promise<LinearDesktopResult>>(
    async () => ({
      configured: true,
      connection: null,
      states: [
        {
          id: "testing",
          name: "Testing",
          type: "started",
          color: "#4cb782",
          position: 2,
          team: { id: "team-1", key: "ENG" },
        },
        {
          id: "grooming",
          name: "Grooming",
          type: "unstarted",
          color: "#c951f9",
          position: 1,
          team: { id: "team-1", key: "ENG" },
        },
      ],
    }),
  );
  const background = vi.fn(async () => ({
    status: "linked" as const,
    worktreePath: "/worktree",
    conflicts: [],
  }));
  stack.use(
    stubGlobal("desktopBridge", {
      linearRequest: (input: LinearDesktopRequest) =>
        input.operation === "teams"
          ? teamRequest(input)
          : input.operation === "states"
            ? stateRequest(input)
            : request(input),
    }),
  );
  const picker = (
    running = false,
    linkedIssue: typeof issue | null = null,
    backgroundEnabled = false,
    creationEnabled = true,
    displayMode: "toolbar" | "panel" = "panel",
  ) => (
    <LinearIssuePicker
      displayMode={displayMode}
      threadId={ThreadId.make("origin")}
      {...(creationEnabled ? { onCreate: async () => "runtime-origin" } : {})}
      {...(backgroundEnabled ? { onBackgroundCreated: background } : {})}
      environmentId={EnvironmentId.make("env")}
      projectId={projectId}
      workspace="acme"
      linkedIssue={linkedIssue}
      running={running}
      onSelect={select}
      onUnlink={unlink}
      onOpenThread={opened}
      onOpenIssue={openIssue}
    />
  );
  const resources = stack.move();
  return {
    select,
    opened,
    openIssue,
    unlink,
    request,
    teamRequest,
    stateRequest,
    background,
    picker,
    /** The current list-end observer's callback, or undefined once it disconnects. */
    get intersect() {
      return intersect;
    },
    reachEnd: () =>
      act(async () => {
        expect(intersect).toBeDefined();
        intersect!();
      }),
    [Symbol.dispose]: () => resources.dispose(),
  };
}

const button = (text: string) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent?.includes(text))!;
const click = async (text: string) => {
  await act(async () => {
    const target = button(text);
    expect(target).toBeDefined();
    target.click();
  });
  if (vi.isFakeTimers()) await act(async () => vi.advanceTimersByTimeAsync(0));
};
it("selects directly, explains a running conflict, and enables takeover only after the agent stops", async () => {
  using t = setup();
  state.running = true;
  await using screen = await render(t.picker());
  await click("Linear issue");
  await click("Fix login");
  expect(document.body.textContent).toContain("This worktree has an active chat");
  expect(document.body.textContent).toContain("An agent is running in the existing chat");
  expect(button("Use this chat").disabled).toBe(true);
  state.running = false;
  state.creationResult = null;
  useLinearCreations.setState({ entries: {} });
  await screen.rerender(t.picker());
  expect(button("Use this chat").disabled).toBe(false);
  expect(t.select).toHaveBeenCalledTimes(1);
  await click("Use this chat");
  expect(t.select).toHaveBeenCalledTimes(2);
  expect(t.select.mock.calls[1]?.[1]).toEqual(["previous"]);
});
it("allows opening an existing chat while its agent runs, without taking over", async () => {
  using t = setup();
  state.running = true;
  await using _screen = await render(t.picker());
  await click("Linear issue");
  await click("Fix login");
  await click("Open existing chat");
  expect(t.opened).toHaveBeenCalledExactlyOnceWith("previous");
  expect(t.select).toHaveBeenCalledTimes(1);
});
it.each(["toolbar", "panel"] as const)(
  "opens and unlinks an issue from the %s",
  async (displayMode) => {
    using t = setup();
    await using screen = await render(t.picker(false, issue, false, true, displayMode));
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Choose Linear issue"]')!
        .click(),
    );
    expect(document.querySelector('input[aria-label="Search Linear issues"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Fix login");
    await click("Unlink issue");
    expect(t.unlink).toHaveBeenCalledOnce();
    await screen.rerender(t.picker(false, null, false, true, displayMode));
    expect(button("Linear issue").getAttribute("aria-expanded")).toBe("false");
    await click("Linear issue");
    expect(button("Unlink issue")).toBeUndefined();
    expect(document.body.textContent).toContain("Fix login");
  },
);
it.each(["toolbar", "panel"] as const)(
  "opens the linked issue from the %s label and reserves the chevron for selection",
  async (displayMode) => {
    using t = setup();
    await using _screen = await render(t.picker(true, issue, false, true, displayMode));
    await click("ENG-123");
    expect(t.openIssue).toHaveBeenCalledExactlyOnceWith(issue);
    expect(document.querySelector('input[aria-label="Search Linear issues"]')).toBeNull();
    expect(t.select).not.toHaveBeenCalled();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Choose Linear issue"]')!
        .click(),
    );
    expect(document.querySelector('input[aria-label="Search Linear issues"]')).not.toBeNull();
    expect(t.openIssue).toHaveBeenCalledTimes(1);
  },
);
it("disables issue selection while the current agent runs and does not queue a switch", async () => {
  using t = setup();
  await using screen = await render(t.picker(true));
  await click("Linear issue");
  expect(document.body.textContent).toContain("Wait for the agent in this chat to finish");
  expect(button("Fix login").disabled).toBe(true);
  await screen.rerender(t.picker(false));
  expect(button("Fix login").disabled).toBe(false);
  expect(t.select).not.toHaveBeenCalled();
});

it("keeps a failed issue-open error available through the selector without changing the link", async () => {
  using t = setup();
  t.openIssue.mockRejectedValueOnce(new Error("Linear panel could not open."));
  await using _screen = await render(t.picker(false, issue));
  await click("ENG-123");
  expect(document.querySelector('input[aria-label="Search Linear issues"]')).toBeNull();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Choose Linear issue"]')!.click(),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Linear panel could not open.",
  );
  expect(t.select).not.toHaveBeenCalled();
});

it("keeps load errors inside the picker and clears the pill error after a successful retry", async () => {
  using t = setup();
  const message = "This desktop build has no Linear OAuth application configured.";
  t.request.mockRejectedValueOnce(new Error(message));
  await using screen = await render(t.picker());
  await click("Linear issue");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
  expect(button("Linear issue").getAttribute("aria-label")).toContain("error, open for details");
  await click("Linear issue");
  expect(screen.container.textContent).not.toContain(message);
  expect(screen.container.querySelector('[role="alert"]')).toBeNull();
  expect(button("Linear issue").getAttribute("aria-label")).toContain("error, open for details");
  await click("Linear issue");
  expect(button("Linear issue").getAttribute("aria-label")).toBe("Link Linear issue");
  expect(document.body.textContent).not.toContain(message);
});

it("preserves a failed selection's details when reopening the picker", async () => {
  using t = setup();
  const message = "Unable to check the Linear branch on GitHub.";
  t.select.mockRejectedValueOnce(new Error(message));
  await using screen = await render(t.picker());
  await click("Linear issue");
  await click("Fix login");
  expect(screen.container.textContent).not.toContain(message);
  expect(button("Linear issue").getAttribute("aria-label")).toContain("error, open for details");
  await click("Linear issue");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
  expect(screen.container.textContent).not.toContain(message);
});

const createdResult = { status: "created", issueId: issue.id };
it("automatically sets up a created issue in an unlinked chat", async () => {
  using t = setup();
  t.select.mockResolvedValueOnce({ status: "linked", worktreePath: "/worktree", conflicts: [] });
  await using _screen = await render(t.picker());
  await click("Linear issue");
  await click("Create issue");
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(t.select).toHaveBeenCalledExactlyOnceWith(issue, []);
  expect(Object.values(useLinearCreations.getState().entries)).toHaveLength(0);
});
it("asks before replacing an issue, and declining leaves the current context", async () => {
  using t = setup();
  await using _screen = await render(t.picker(false, { ...issue, id: "old", identifier: "ENG-2" }));
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Choose Linear issue"]')!.click(),
  );
  await click("Create issue");
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(document.body.textContent).toContain("Switch to the new Linear issue?");
  expect(t.select).not.toHaveBeenCalled();
  await click("Keep current chat");
  expect(t.select).not.toHaveBeenCalled();
});
it("preserves creation if an agent starts, and never queues a switch when it stops", async () => {
  using t = setup();
  await using screen = await render(t.picker());
  await click("Linear issue");
  await click("Create issue");
  await screen.rerender(t.picker(true));
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(button("Use this issue").disabled).toBe(true);
  await screen.rerender(t.picker(false));
  expect(button("Use this issue").disabled).toBe(false);
  expect(t.select).not.toHaveBeenCalled();
  await click("Use this issue");
  expect(t.select).toHaveBeenCalledExactlyOnceWith(issue, []);
});
it("retains the result for its originating chat after leaving it", async () => {
  using t = setup();
  await using screen = await render(t.picker());
  await click("Linear issue");
  await click("Create issue");
  await screen.unmount();
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(t.select).not.toHaveBeenCalled();
  await using _remounted = await render(t.picker());
  expect(document.body.textContent).toContain("Use the new Linear issue?");
  expect(t.select).not.toHaveBeenCalled();
});
it("cancelling creation never sets up an issue", async () => {
  using t = setup();
  await using _screen = await render(t.picker());
  await click("Linear issue");
  await click("Create issue");
  await act(async () => {
    state.creationResult!({ status: "cancelled" });
  });
  expect(t.select).not.toHaveBeenCalled();
  expect(Object.values(useLinearCreations.getState().entries)).toHaveLength(0);
});

it("sets up the origin in the background without switching the displayed chat", async () => {
  using t = setup();
  await using screen = await render(t.picker(false, null, true));
  await click("Linear issue");
  await click("Create issue");
  await screen.unmount();
  await act(async () => {
    state.creationResult!(createdResult);
  });
  expect(t.background).toHaveBeenCalledExactlyOnceWith(issue);
  expect(t.select).not.toHaveBeenCalled();
  expect(Object.values(useLinearCreations.getState().entries)).toHaveLength(0);
});

it("browses all three views without switching the linked issue, retaining the tab when reopened", async () => {
  using t = setup();
  await using _screen = await render(t.picker());
  await click("Linear issue");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ view: "assigned", query: "" });
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Assigned to me", "Triage", "All issues"]);
  await click("Triage");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ view: "triage", query: "" });
  await click("All issues");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ view: "all", query: "" });
  await click("Linear issue");
  await click("Linear issue");
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    "All issues",
  );
  expect(t.select).not.toHaveBeenCalled();
});
it("keeps the create action visible and disabled while running", async () => {
  using t = setup();
  await using _screen = await render(t.picker(true));
  await click("Linear issue");
  expect(button("Create issue")).toBeDefined();
  expect(button("Create issue").disabled).toBe(true);
  await click("Triage");
  expect(button("Create issue").disabled).toBe(true);
  expect(t.select).not.toHaveBeenCalled();
});
it("discards a previous view's pending response and resets its cursor", async () => {
  using t = setup();
  let resolveAssigned!: (value: LinearDesktopResult) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveAssigned = resolve;
      }),
  );
  await using _screen = await render(t.picker());
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
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ view: "triage" });
  expect(t.request.mock.calls.at(-1)?.[0]).not.toHaveProperty("cursor");
});

/** Types into search under the current timers; the query debounces for 350ms. */
const typeSearch = (text: string) =>
  act(async () => {
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search Linear issues"]',
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
/** Types and settles the debounce on fake timers, then returns to real timers. */
const search = async (text: string) => {
  using _timers = fakeTimers();
  await typeSearch(text);
  await act(async () => vi.advanceTimersByTimeAsync(350));
};
it("retains search across tabs, pages only the current view, and retains that view across a remount", async () => {
  using t = setup();
  await using screen = await render(t.picker());
  await click("Linear issue");
  await search("login");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ query: "login", view: "assigned" });
  t.request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [issue],
    nextCursor: "triage-next",
  });
  await click("Triage");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ query: "login", view: "triage" });
  expect(button("Load more")).toBeUndefined();
  await t.reachEnd();
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({
    query: "login",
    view: "triage",
    cursor: "triage-next",
  });
  await click("All issues");
  expect(t.request.mock.calls.at(-1)?.[0]).not.toHaveProperty("cursor");
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Search Linear issues"]')?.value,
  ).toBe("login");
  await screen.unmount();
  await using _remounted = await render(t.picker());
  await click("Linear issue");
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    "All issues",
  );
});
it("keeps creation available through loading, empty and failed searches, and explains unavailable creation", async () => {
  using t = setup();
  let resolve!: (value: LinearDesktopResult) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await using screen = await render(t.picker());
  await click("Linear issue");
  expect(document.body.textContent).toContain("Loading issues");
  expect(button("Create issue").disabled).toBe(false);
  await act(async () => resolve({ configured: true, connection: null, issues: [] }));
  expect(document.body.textContent).toContain("No issues found");
  expect(button("Create issue").disabled).toBe(false);
  t.request.mockRejectedValueOnce(new Error("Temporary query failure"));
  await click("Triage");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Temporary query failure");
  expect(button("Create issue").disabled).toBe(false);
  await screen.rerender(t.picker(false, null, false, false));
  expect(button("Create issue").disabled).toBe(true);
  expect(document.body.textContent).toContain("Issue creation is unavailable for this chat");
});
it("discards a pending search after the query changes", async () => {
  using t = setup();
  await using _screen = await render(t.picker());
  await click("Linear issue");
  let resolve!: (value: LinearDesktopResult) => void;
  t.request.mockImplementationOnce(
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
  using t = setup();
  t.select.mockResolvedValueOnce({ status: "linked", worktreePath: "/worktree", conflicts: [] });
  t.openIssue.mockRejectedValueOnce(new Error("Panel offline"));
  await using _screen = await render(t.picker());
  await click("Linear issue");
  await click("Create issue");
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
  using t = setup();
  await using _screen = await render(t.picker());
  await click("Linear issue");
  expect(document.querySelector('[aria-label="Filter Linear teams"]')).not.toBeNull();
  expect(document.activeElement).toBe(
    document.querySelector('input[aria-label="Search Linear issues"]'),
  );
});

it("shows assignees in triage and all issues but omits them from assigned to me", async () => {
  using t = setup();
  t.request.mockImplementationOnce(async () => ({
    configured: true,
    connection: null,
    issues: [{ ...issue, assignee: { name: "Ada", avatarUrl: "https://example.com/ada.png" } }],
  }));
  await using _screen = await render(t.picker());
  await click("Linear issue");
  expect(document.querySelector('[alt="Assignee: Ada"]')).toBeNull();
  t.request.mockImplementationOnce(async () => ({
    configured: true,
    connection: null,
    issues: [{ ...issue, assignee: { name: "Ada", avatarUrl: "https://example.com/ada.png" } }],
  }));
  await click("Triage");
  const avatar = document.querySelector('[alt="Assignee: Ada"]');
  expect(avatar).not.toBeNull();
  await act(async () => avatar!.dispatchEvent(new Event("error")));
  expect(document.querySelector('[aria-label="Assignee: Ada"]')).not.toBeNull();
  t.request.mockImplementationOnce(async () => ({
    configured: true,
    connection: null,
    issues: [{ ...issue, assignee: null }],
  }));
  await click("All issues");
  expect(document.querySelector('[aria-label="Assignee: Unassigned"]')).not.toBeNull();
  await click("Assigned to me");
  expect(document.querySelector('[aria-label^="Assignee:"]')).toBeNull();
});

it("refreshes priority and status icons from Linear, muting urgent issues when completed", async () => {
  using t = setup();
  const urgentIssue = {
    ...issue,
    priority: 1 as const,
    state: { name: "Testing", color: "#4cb782", type: "started", progress: 0.75 },
  };
  t.request.mockResolvedValueOnce({ configured: true, connection: null, issues: [urgentIssue] });
  await using _screen = await render(t.picker());
  await click("Linear issue");
  const icon = (label: string) =>
    button("Fix login").querySelector<SVGElement>(`[aria-label="${label}"]`)!;
  expect(icon("Priority: Urgent").style.color).toBe("rgb(255, 107, 38)");
  expect(icon("Status: Testing").style.color).toBe("rgb(76, 183, 130)");

  const completedIssue = {
    ...urgentIssue,
    state: { name: "Done", color: "#6568d8", type: "completed", progress: 0 },
  };
  t.request.mockResolvedValueOnce({ configured: true, connection: null, issues: [completedIssue] });
  await click("All issues");
  expect(icon("Priority: Urgent").style.color).toBe("rgb(153, 154, 156)");
  expect(icon("Status: Done").style.color).toBe("rgb(101, 104, 216)");
  expect(icon("Status: Testing")).toBeNull();
  await click("Fix login");
  expect(t.select.mock.calls.at(-1)?.[0]).toEqual(completedIssue);
});

const pressArrow = (key: "ArrowDown" | "ArrowUp") =>
  act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

it("navigates issues and appended pages with arrows, returning from the first issue to search", async () => {
  using t = setup();
  t.request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [issue, { ...issue, id: "second", title: "Second issue" }],
    nextCursor: "next",
  });
  await using _screen = await render(t.picker());
  await click("Linear issue");
  const input = document.querySelector('input[aria-label="Search Linear issues"]');
  await pressArrow("ArrowUp");
  expect(document.activeElement).toBe(input);
  await pressArrow("ArrowDown");
  expect(document.activeElement).toBe(button("Fix login"));
  await pressArrow("ArrowDown");
  expect(document.activeElement).toBe(button("Second issue"));
  await pressArrow("ArrowDown");
  expect(document.activeElement).toBe(button("Second issue"));
  t.request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [{ ...issue, id: "third", title: "Third issue" }],
    nextCursor: null,
  });
  await t.reachEnd();
  await pressArrow("ArrowDown");
  expect(document.activeElement).toBe(button("Third issue"));
  await pressArrow("ArrowUp");
  expect(document.activeElement).toBe(button("Second issue"));
  await pressArrow("ArrowUp");
  expect(document.activeElement).toBe(button("Fix login"));
  await pressArrow("ArrowUp");
  expect(document.activeElement).toBe(input);
  expect(t.select).not.toHaveBeenCalled();
});

it.each(["empty", "disabled"])("keeps focus in search when the issue list is %s", async (state) => {
  using t = setup();
  if (state === "empty") {
    t.request.mockResolvedValueOnce({ configured: true, connection: null, issues: [] });
  }
  await using _screen = await render(t.picker(state === "disabled"));
  await click("Linear issue");
  const input = document.querySelector('input[aria-label="Search Linear issues"]');
  await pressArrow("ArrowDown");
  expect(document.activeElement).toBe(input);
  expect(t.select).not.toHaveBeenCalled();
});

it("remembers the team filter across reopening and stored-state rehydration, and clears it with All teams", async () => {
  using t = setup();
  await using screen = await render(t.picker());
  await click("Linear issue");
  await click("All teams");
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((el) => el.textContent?.includes("Engineering"))!
      .click();
  });
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1", view: "assigned" });
  await search("login");
  await click("Triage");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({
    teamId: "team-1",
    query: "login",
    view: "triage",
  });
  const saved = localStorage.getItem("t3code:linear-team-filters:v1")!;
  await screen.unmount();
  useLinearTeamFilters.setState({ byProject: {} });
  localStorage.setItem("t3code:linear-team-filters:v1", saved);
  await useLinearTeamFilters.persist.rehydrate();
  await using _remounted = await render(t.picker());
  await click("Linear issue");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1" });
  expect(document.activeElement).toBe(
    document.querySelector('input[aria-label="Search Linear issues"]'),
  );
  await click("ENG");
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((el) => el.textContent === "All teams")!
      .click();
  });
  expect(t.request.mock.calls.at(-1)?.[0]).not.toHaveProperty("teamId");
});
it("loads one next page at a time, keeps results on failure, and retries the same cursor", async () => {
  using t = setup();
  t.request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [issue],
    nextCursor: "next",
  });
  await using _screen = await render(t.picker());
  await click("Linear issue");
  let reject!: (cause: Error) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    const notify = t.intersect!;
    notify();
    notify();
  });
  expect(t.request.mock.calls.filter(([input]) => input.cursor === "next")).toHaveLength(1);
  await act(async () => reject(new Error("Next page offline")));
  expect(document.body.textContent).toContain("Fix login");
  expect(document.body.textContent).toContain("Next page offline");
  expect(t.intersect).toBeUndefined();
  t.request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [{ ...issue, id: "issue-2", title: "Next issue" }],
    nextCursor: null,
  });
  await click("Retry");
  expect(t.request.mock.calls.at(-1)?.[0].cursor).toBe("next");
  expect(document.body.textContent).toContain("Fix login");
  expect(document.body.textContent).toContain("Next issue");
  expect(button("Load more")).toBeUndefined();
});

it("does not let a pending page or its old observer override a changed team filter", async () => {
  using t = setup();
  t.request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [issue],
    nextCursor: "old-next",
  });
  await using _screen = await render(t.picker());
  await click("Linear issue");
  const oldObserver = t.intersect!;
  let resolve!: (value: LinearDesktopResult) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await t.reachEnd();
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
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1" });
  expect(t.request.mock.calls.at(-1)?.[0]).not.toHaveProperty("cursor");
});
it("retains a saved filter on team-load failure and retries the team list", async () => {
  using t = setup();
  useLinearTeamFilters.getState().select(JSON.stringify(["env", "project", "acme"]), "team-1");
  t.teamRequest.mockRejectedValueOnce(new Error("Teams offline"));
  await using _screen = await render(t.picker());
  await click("Linear issue");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1" });
  await click("Saved team");
  expect(document.body.textContent).toContain("Could not load teams");
  await click("Retry teams");
  expect(document.body.textContent).toContain("Engineering");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ teamId: "team-1" });
});

it("includes teams beyond the first API page in the selector", async () => {
  using t = setup();
  t.teamRequest.mockResolvedValueOnce({
    configured: true,
    connection: null,
    teams: [{ id: "team-1", key: "ENG", name: "Engineering" }],
    nextCursor: "teams-next",
  });
  t.teamRequest.mockResolvedValueOnce({
    configured: true,
    connection: null,
    teams: [{ id: "team-2", key: "DES", name: "Design" }],
    nextCursor: null,
  });
  await using _screen = await render(t.picker());
  await click("Linear issue");
  expect(t.teamRequest.mock.calls.at(-1)?.[0].cursor).toBe("teams-next");
  await click("All teams");
  expect(document.body.textContent).toContain("DES · Design");
  expect(document.body.textContent).toContain("ENG · Engineering");
});

it("completes the pending initial load after typing and clearing before debounce", async () => {
  using t = setup();
  let resolve!: (value: LinearDesktopResult) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await using _screen = await render(t.picker());
  await click("Linear issue");
  using _timers = fakeTimers();
  await typeSearch("x");
  await typeSearch("");
  await act(async () => vi.advanceTimersByTimeAsync(350));
  await act(async () => resolve({ configured: true, connection: null, issues: [issue] }));
  expect(button("Fix login")).toBeDefined();
  expect(document.body.textContent).not.toContain("Loading issues");
  expect(t.request).toHaveBeenCalledTimes(1);
});

it("keeps a pending page valid when search returns to its original value before debounce", async () => {
  using t = setup();
  t.request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [issue],
    nextCursor: "page-2",
  });
  await using _screen = await render(t.picker());
  await click("Linear issue");
  let resolve!: (value: LinearDesktopResult) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await t.reachEnd();
  using _timers = fakeTimers();
  await typeSearch("x");
  await typeSearch("");
  await act(async () => vi.advanceTimersByTimeAsync(350));
  await act(async () =>
    resolve({
      configured: true,
      connection: null,
      issues: [{ ...issue, id: "second", title: "Second page issue" }],
    }),
  );
  expect(button("Fix login")).toBeDefined();
  expect(button("Second page issue")).toBeDefined();
  expect(document.body.textContent).not.toContain("Loading issues");
  expect(t.request).toHaveBeenCalledTimes(2);
});

const clickMenu = (role: string, text: string) =>
  act(async () => {
    const node = [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find((el) =>
      el.textContent?.includes(text),
    );
    expect(node).toBeDefined();
    node!.click();
  });
const clickControl = (label: string) =>
  act(async () => {
    const node = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(node).not.toBeNull();
    node!.click();
  });
const escapeMenu = () =>
  act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

it("persists sort and grouped multiselect filters, restores them on reopening, and can reset them", async () => {
  using t = setup();
  await using screen = await render(t.picker());
  await click("Linear issue");
  await clickControl("Filter issues");
  await clickMenu("menuitemcheckbox", "Testing");
  await clickMenu("menuitemcheckbox", "Grooming");
  await clickMenu("menuitemcheckbox", "Urgent");
  await clickMenu("menuitemcheckbox", "High");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({
    stateIds: ["testing", "grooming"],
    priorities: [1, 2],
  });
  await escapeMenu();
  await clickControl("Sort issues");
  await clickMenu("menuitemradio", "Priority");
  expect(t.request.mock.calls.at(-1)?.[0].sort).toBe("priority");
  const saved = localStorage.getItem("t3code:linear-issue-preferences:v1")!;
  await screen.unmount();
  useLinearIssuePreferences.setState({ byProject: {} });
  localStorage.setItem("t3code:linear-issue-preferences:v1", saved);
  await useLinearIssuePreferences.persist.rehydrate();
  await using _remounted = await render(t.picker());
  await click("Linear issue");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({
    sort: "priority",
    stateIds: ["testing", "grooming"],
    priorities: [1, 2],
  });
  await clickControl("Filter issues");
  await clickMenu("menuitem", "Clear filters");
  expect(t.request.mock.calls.at(-1)?.[0]).not.toHaveProperty("stateIds");
  expect(t.request.mock.calls.at(-1)?.[0]).not.toHaveProperty("priorities");
  await clickControl("Sort issues");
  await clickMenu("menuitemradio", "Latest updated");
  expect(t.request.mock.calls.at(-1)?.[0].sort).toBe("updatedAt");
});

it("ignores a pending old page after changing sort", async () => {
  using t = setup();
  t.request.mockResolvedValueOnce({
    configured: true,
    connection: null,
    issues: [issue],
    nextCursor: "old-page",
  });
  await using _screen = await render(t.picker());
  await click("Linear issue");
  let resolve!: (value: LinearDesktopResult) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await t.reachEnd();
  await clickControl("Sort issues");
  await clickMenu("menuitemradio", "Priority");
  await act(async () =>
    resolve({
      configured: true,
      connection: null,
      issues: [{ ...issue, title: "Stale ordering" }],
      nextCursor: "stale",
    }),
  );
  expect(document.body.textContent).not.toContain("Stale ordering");
  expect(t.request.mock.calls.at(-1)?.[0]).toMatchObject({ sort: "priority" });
  expect(t.request.mock.calls.at(-1)?.[0]).not.toHaveProperty("cursor");
});

it("loads status pages and lets a saved unavailable status be removed after a load failure", async () => {
  using t = setup();
  useLinearIssuePreferences.getState().select(JSON.stringify(["env", "project", "acme"]), {
    sort: "updatedAt",
    stateIds: ["old-status"],
    priorities: [],
  });
  t.stateRequest.mockRejectedValueOnce(new Error("Offline"));
  await using _screen = await render(t.picker());
  await click("Linear issue");
  await clickControl("Filter issues");
  expect(document.body.textContent).toContain("Retry statuses");
  await clickMenu("menuitemcheckbox", "Saved status");
  expect(t.request.mock.calls.at(-1)?.[0]).not.toHaveProperty("stateIds");
  t.stateRequest.mockResolvedValueOnce({
    configured: true,
    connection: null,
    states: [],
    nextCursor: "next-status-page",
  });
  await clickMenu("menuitem", "Retry statuses");
  expect(t.stateRequest.mock.calls.at(-1)?.[0].cursor).toBe("next-status-page");
  expect(document.body.textContent).toContain("Testing");
});
