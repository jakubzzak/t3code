// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
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
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
  vi.stubGlobal("IntersectionObserver", undefined);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  state.data = {
    commentId: "root",
    rootCommentId: "root",
    sessionId: "session",
    agentId: "agent",
    agentName: "Tars",
    status: "active",
  };
  state.dataUpdatedAt = Date.now();
  state.isSuccess = true;
  state.isPending = false;
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("expires active observations during a hanging read, stops on failure and recovers with fresh status", async () => {
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toBe("Working");
  state.isPending = true;
  await act(async () => root.render(<Harness />));
  await act(async () => vi.advanceTimersByTime(25_000));
  expect(container.textContent).toBe("Idle");
  state.isPending = false;
  state.isSuccess = false;
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toBe("Idle");
  state.isSuccess = true;
  state.dataUpdatedAt = Date.now();
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toBe("Working");
});

it.each(["pending", "awaitingInput", "complete", "error", "stale", "stopping", "future-status"])(
  "does not claim work for %s",
  async (status) => {
    state.data = { ...state.data!, status };
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toBe("Idle");
  },
);

it("stops refreshing when hidden and does not reuse an old thread's identity", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(state.refresh).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(container.textContent).toBe("Ordinary");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(state.refresh).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(container.textContent).not.toBe("Working");
  await act(async () => root.render(<Harness commentId="different-thread" />));
  expect(container.textContent).toBe("Ordinary");
});

it("does not refresh or claim work while the headline is offscreen", async () => {
  let intersect: IntersectionObserverCallback | undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  await act(async () => root.render(<Harness />));
  expect(container.textContent).toBe("Ordinary");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(state.refresh).not.toHaveBeenCalled();
  await act(async () =>
    intersect!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
  );
  expect(container.textContent).not.toBe("Working");
  state.dataUpdatedAt = Date.now();
  await act(async () => root.render(<Harness />));
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
  state.data = null;
  state.dataUpdatedAt = 0;
  state.isPending = true;
  state.isSuccess = false;
  await act(async () => root.render(<Harness preview />));
  expect(container.textContent).toBe("Idle");
  state.isPending = false;
  await act(async () => root.render(<Harness preview />));
  expect(container.textContent).toBe("Idle");
  state.isSuccess = true;
  state.dataUpdatedAt = Date.now();
  await act(async () => root.render(<Harness preview />));
  expect(container.textContent).toBe("Ordinary");
  state.data = {
    commentId: "root",
    rootCommentId: "root",
    sessionId: "session",
    agentId: "agent",
    agentName: "Tars",
    status: "active",
  };
  await act(async () => root.render(<Harness preview />));
  expect(container.textContent).toBe("Working");
});

it("preserves preview identity when reopening with a cached no-session result", async () => {
  state.data = null;
  await act(async () => root.render(<Harness preview />));
  expect(container.textContent).toBe("Ordinary");
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTime(1_000));
  state.isPending = true;
  await act(async () => root.render(<Harness preview />));
  expect(container.textContent).toBe("Idle");
  state.isPending = false;
  state.dataUpdatedAt = Date.now();
  await act(async () => root.render(<Harness preview />));
  expect(container.textContent).toBe("Ordinary");
});

it.each(["agent", "no-session"])(
  "uses the new target's preview while the previous target has a cached %s result",
  async (result) => {
    if (result === "no-session") state.data = null;
    await act(async () => root.render(<Harness preview />));
    await act(async () => vi.advanceTimersByTime(1_000));
    state.isPending = true;
    await act(async () => root.render(<Harness commentId="new-root" preview />));
    expect(container.textContent).toBe("Idle");
    state.isPending = false;
    state.data = null;
    state.dataUpdatedAt = Date.now();
    await act(async () => root.render(<Harness commentId="new-root" preview />));
    expect(container.textContent).toBe("Ordinary");
  },
);
