// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId, type InboxLinearAgentThread } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { useInboxLinearAgentThread } from "./useInboxLinearAgentThread";

const state = vi.hoisted(() => ({
  query: undefined as Atom.Atom<AsyncResult.AsyncResult<InboxLinearAgentThread | null>> | undefined,
}));
vi.mock("~/state/inbox", () => ({
  inboxEnvironment: { linearAgentThread: () => state.query! },
}));

function Preview({ commentId }: { commentId: string }) {
  const element = useRef<HTMLElement>(null);
  const { thread, working } = useInboxLinearAgentThread({
    environmentId: EnvironmentId.make("env"),
    projectId: ProjectId.make("project"),
    notificationId: "notification",
    commentId,
    initialIdentity: {
      rootCommentId: commentId,
      sessionId: `session-${commentId}`,
      agentId: `agent-${commentId}`,
      agentName: commentId === "root" ? "Tars" : "Nova",
    },
    element,
  });
  return (
    <section ref={element}>
      {thread ? `${thread.agentName}: ${working ? "working" : "idle"}` : "Ordinary"}
    </section>
  );
}

it("keeps verified preview identity through real query-cache refreshes and accepts fresh no-session results", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const registry = AtomRegistry.make();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const requests: Array<(value: InboxLinearAgentThread | null) => void> = [];
  state.query = Atom.make(
    Effect.promise(
      () => new Promise<InboxLinearAgentThread | null>((resolve) => requests.push(resolve)),
    ),
  ).pipe(Atom.keepAlive);
  const render = (commentId: string | null) =>
    act(async () => {
      root.render(
        <RegistryContext.Provider value={registry}>
          {commentId && <Preview commentId={commentId} />}
        </RegistryContext.Provider>,
      );
    });
  try {
    await render("root");
    expect(container.textContent).toBe("Tars: idle");
    expect(requests).toHaveLength(1);
    await act(async () => requests[0]!(null));
    expect(container.textContent).toBe("Ordinary");

    await render(null);
    await act(async () => vi.advanceTimersByTime(1_000));
    await render("root");
    expect(requests).toHaveLength(2);
    expect(registry.get(state.query)).toMatchObject({
      _tag: "Success",
      value: null,
      waiting: true,
    });
    expect(container.textContent).toBe("Tars: idle");
    await act(async () => requests[1]!(null));
    expect(container.textContent).toBe("Ordinary");

    await act(async () => vi.advanceTimersByTime(1_000));
    await render("other-root");
    expect(requests).toHaveLength(3);
    expect(container.textContent).toBe("Nova: idle");
    await act(async () =>
      requests[2]!({
        commentId: "other-root",
        rootCommentId: "other-root",
        sessionId: "nova-session",
        agentId: "nova",
        agentName: "Nova",
        status: "active",
      }),
    );
    expect(container.textContent).toBe("Nova: working");
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
