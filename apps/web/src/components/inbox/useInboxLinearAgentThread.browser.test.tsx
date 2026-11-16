import type { ReactNode } from "react";
import { useRef } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render, stubGlobal } from "../../../test/render";
import { EnvironmentId, ProjectId, type InboxLinearAgentThread } from "@t3tools/contracts";
import { useInboxLinearAgentThread } from "./useInboxLinearAgentThread";

const state = vi.hoisted(() => ({
  data: null as InboxLinearAgentThread | null,
  dataUpdatedAt: 0,
  isSuccess: true,
  isPending: false,
  refresh: vi.fn(),
}));
vi.mock("~/state/inbox", () => ({
  inboxEnvironment: { linearAgentThread: (input: unknown) => input },
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (atom: unknown) =>
    atom
      ? { ...state }
      : {
          data: null,
          dataUpdatedAt: 0,
          isSuccess: false,
          isPending: false,
          refresh: state.refresh,
        },
}));
const container = document.createElement("div");
const mount = (ui: ReactNode) => render(ui, { container, router: false });
function Harness({
  commentId = "root",
  preview = false,
}: {
  commentId?: string;
  preview?: boolean;
}) {
  const element = useRef<HTMLElement>(null);
  const { thread, working } = useInboxLinearAgentThread({
    environmentId: EnvironmentId.make("env"),
    projectId: ProjectId.make("project"),
    notificationId: "notification",
    commentId,
    initialIdentity: preview
      ? { rootCommentId: commentId, sessionId: "session", agentId: "agent", agentName: "Tars" }
      : undefined,
    element,
  });
  return (
    <section ref={element}>
      <output>{working ? "Working" : thread ? "Idle" : "Ordinary"}</output>
    </section>
  );
}
const now = () => vi.getMockedSystemTime()!.getTime();
function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}
function setup() {
  const stack = new DisposableStack();
  stack.use(fakeTimers());
  vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
  stack.use(stubGlobal("IntersectionObserver", undefined));
  setVisibility("visible");
  stack.defer(() => Reflect.deleteProperty(document, "visibilityState"));
  stack.defer(() => vi.clearAllMocks());
  state.data = {
    commentId: "root",
    rootCommentId: "root",
    sessionId: "session",
    agentId: "agent",
    agentName: "Tars",
    status: "active",
  };
  state.dataUpdatedAt = now();
  state.isSuccess = true;
  state.isPending = false;
  return stack;
}

it("expires active observations during a hanging read, stops on failure and recovers with fresh status", async () => {
  using _setup = setup();
  await using screen = await mount(<Harness />);
  expect(container.textContent).toBe("Working");
  state.isPending = true;
  await screen.rerender(<Harness />);
  await act(async () => vi.advanceTimersByTime(25_000));
  expect(container.textContent).toBe("Idle");
  state.isPending = false;
  state.isSuccess = false;
  await screen.rerender(<Harness />);
  expect(container.textContent).toBe("Idle");
  state.isSuccess = true;
  state.dataUpdatedAt = now();
  await screen.rerender(<Harness />);
  expect(container.textContent).toBe("Working");
});

it.each(["pending", "awaitingInput", "complete", "error", "stale", "stopping", "future-status"])(
  "does not claim work for %s",
  async (status) => {
    using _setup = setup();
    state.data = { ...state.data!, status };
    await using _screen = await mount(<Harness />);
    expect(container.textContent).toBe("Idle");
  },
);

it("stops refreshing when hidden and does not reuse an old thread's identity", async () => {
  using _setup = setup();
  await using screen = await mount(<Harness />);
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(state.refresh).toHaveBeenCalledTimes(1);
  setVisibility("hidden");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(container.textContent).toBe("Ordinary");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(state.refresh).toHaveBeenCalledTimes(1);
  setVisibility("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(container.textContent).not.toBe("Working");
  await screen.rerender(<Harness commentId="different-thread" />);
  expect(container.textContent).toBe("Ordinary");
});

it("does not refresh or claim work while the headline is offscreen", async () => {
  using _setup = setup();
  let intersect: IntersectionObserverCallback | undefined;
  using _observer = stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  await using screen = await mount(<Harness />);
  expect(container.textContent).toBe("Ordinary");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(state.refresh).not.toHaveBeenCalled();
  await act(async () =>
    intersect!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
  );
  expect(container.textContent).not.toBe("Working");
  state.dataUpdatedAt = now();
  await screen.rerender(<Harness />);
  expect(container.textContent).toBe("Working");
  await act(async () =>
    intersect!(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(container.textContent).toBe("Ordinary");
});

it("uses preview identity during a pending or failed lookup without implying work, and accepts a fresh no-session result", async () => {
  using _setup = setup();
  state.data = null;
  state.dataUpdatedAt = 0;
  state.isPending = true;
  state.isSuccess = false;
  await using screen = await mount(<Harness preview />);
  expect(container.textContent).toBe("Idle");
  state.isPending = false;
  await screen.rerender(<Harness preview />);
  expect(container.textContent).toBe("Idle");
  state.isSuccess = true;
  state.dataUpdatedAt = now();
  await screen.rerender(<Harness preview />);
  expect(container.textContent).toBe("Ordinary");
  state.data = {
    commentId: "root",
    rootCommentId: "root",
    sessionId: "session",
    agentId: "agent",
    agentName: "Tars",
    status: "active",
  };
  await screen.rerender(<Harness preview />);
  expect(container.textContent).toBe("Working");
});

it("preserves preview identity when reopening with a cached no-session result", async () => {
  using _setup = setup();
  state.data = null;
  await using screen = await mount(<Harness preview />);
  expect(container.textContent).toBe("Ordinary");
  await screen.rerender(null);
  await act(async () => vi.advanceTimersByTime(1_000));
  state.isPending = true;
  await screen.rerender(<Harness preview />);
  expect(container.textContent).toBe("Idle");
  state.isPending = false;
  state.dataUpdatedAt = now();
  await screen.rerender(<Harness preview />);
  expect(container.textContent).toBe("Ordinary");
});

it.each(["agent", "no-session"])(
  "uses the new target's preview while the previous target has a cached %s result",
  async (result) => {
    using _setup = setup();
    if (result === "no-session") state.data = null;
    await using screen = await mount(<Harness preview />);
    await act(async () => vi.advanceTimersByTime(1_000));
    state.isPending = true;
    await screen.rerender(<Harness commentId="new-root" preview />);
    expect(container.textContent).toBe("Idle");
    state.isPending = false;
    state.data = null;
    state.dataUpdatedAt = now();
    await screen.rerender(<Harness commentId="new-root" preview />);
    expect(container.textContent).toBe("Ordinary");
  },
);
