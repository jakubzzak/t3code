import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId, type InboxLinearAgentThread } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { useRef } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render, stubGlobal } from "../../../test/render";
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
  using _observer = stubGlobal("IntersectionObserver", undefined);
  using _timers = fakeTimers();
  vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  using stack = new DisposableStack();
  stack.defer(() => Reflect.deleteProperty(document, "visibilityState"));
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  const requests: Array<(value: InboxLinearAgentThread | null) => void> = [];
  state.query = Atom.make(
    Effect.promise(
      () => new Promise<InboxLinearAgentThread | null>((resolve) => requests.push(resolve)),
    ),
  ).pipe(Atom.keepAlive);
  const view = (commentId: string | null) => (
    <RegistryContext.Provider value={registry}>
      {commentId && <Preview commentId={commentId} />}
    </RegistryContext.Provider>
  );
  await using screen = await render(view("root"), { router: false });
  const { container } = screen;
  expect(container.textContent).toBe("Tars: idle");
  expect(requests).toHaveLength(1);
  await act(async () => requests[0]!(null));
  expect(container.textContent).toBe("Ordinary");

  await screen.rerender(view(null));
  await act(async () => vi.advanceTimersByTime(1_000));
  await screen.rerender(view("root"));
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
  await screen.rerender(view("other-root"));
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
});
