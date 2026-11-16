import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { ThreadRouteView } from "../ThreadRouteView";
import { promoteLinearDraftThread } from "./promoteLinearDraftThread";

const environmentId = EnvironmentId.make("promotion-environment");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("origin"));
const draftId = DraftId.make("origin-draft");
const otherRef = scopeThreadRef(environmentId, ThreadId.make("other"));

// Both threads are listed, live and visible, so routing alone decides what mounts.
vi.mock(import("~/state/entities"), async (original) => {
  const { scopeThreadRef: scope } = await import("@t3tools/client-runtime/environment");
  const { EnvironmentId: Environment, ThreadId: Thread } = await import("@t3tools/contracts");
  const environment = Environment.make("promotion-environment");
  const origin = scope(environment, Thread.make("origin"));
  const refs = [origin, scope(environment, Thread.make("other"))];
  const thread = { ...origin, id: origin.threadId, messages: [], latestTurn: null, session: null };
  return {
    ...(await original()),
    useThreadRefs: () => refs,
    useEnvironmentThreadRefs: () => refs,
    useAnyEnvironmentHiding: () => false,
    useQuietThreadShell: (ref) => (ref === null ? null : (thread as never)),
    useThreadShell: () => thread as never,
    useThread: () => thread as never,
    useThreadDetail: () => thread as never,
    useThreadStatus: () => "ready" as never,
  };
});
vi.mock(import("~/state/shell"), async (original) => ({
  ...(await original()),
  useEnvironmentShellStatus: () => "live",
}));
vi.mock("../ui/sidebar", async (original) => ({
  ...(await original<object>()),
  SidebarInset: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock(import("../ChatView"), () => ({
  default: (props: { draftId?: DraftId; environmentId: EnvironmentId; threadId: ThreadId }) => {
    const prompt = useComposerDraftStore(
      (store) =>
        store.getComposerDraft(props.draftId ?? scopeThreadRef(props.environmentId, props.threadId))
          ?.prompt,
    );
    return <div data-thread={props.threadId}>{prompt}</div>;
  },
}));

function setup() {
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
  const store = useComposerDraftStore.getState();
  store.setProjectDraftThreadId(
    scopeProjectRef(environmentId, ProjectId.make("project")),
    draftId,
    { threadId: threadRef.threadId },
  );
  store.setPrompt(draftId, "Keep my unsent prompt");
}

async function renderRoutes(loadOrigin: () => Promise<void> = async () => {}) {
  const base = createRootRoute({ component: Outlet });
  const landing = createRoute({
    getParentRoute: () => base,
    path: "/",
    component: () => <div>New chat</div>,
  });
  const draft = createRoute({
    getParentRoute: () => base,
    path: "/draft/$draftId",
    component: () => {
      const params = useParams({ strict: false });
      return <ThreadRouteView target={{ kind: "draft", draftId: DraftId.make(params.draftId!) }} />;
    },
  });
  const server = createRoute({
    getParentRoute: () => base,
    path: "/$environmentId/$threadId",
    loader: ({ params }) => (params.threadId === "origin" ? loadOrigin() : undefined),
    component: () => {
      const params = useParams({ strict: false });
      return (
        <ThreadRouteView
          target={{
            kind: "server",
            threadRef: scopeThreadRef(
              EnvironmentId.make(params.environmentId!),
              ThreadId.make(params.threadId!),
            ),
          }}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: base.addChildren([landing, draft, server]),
    history: createMemoryHistory({ initialEntries: ["/draft/origin-draft"] }),
  });
  await router.load();
  // The test drives its own route tree, with a loader that holds the saved thread's route.
  const screen = await render(<RouterProvider router={router} />, { router: false });
  return Object.assign(screen, { appRouter: router });
}

it("keeps the returning draft mounted until its saved thread route is ready", async () => {
  setup();
  let release!: () => void;
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  await using screen = await renderRoutes(() => loading);
  const router = screen.appRouter;
  await act(() => router.navigate({ to: "/$environmentId/$threadId", params: otherRef }));
  await act(() => router.navigate({ to: "/draft/$draftId", params: { draftId } }));
  const completion = await act(() => ({ done: promoteLinearDraftThread(router, threadRef) }));
  expect(useComposerDraftStore.getState().getDraftSession(draftId)).not.toBeNull();
  expect(screen.container.textContent).toContain("Keep my unsent prompt");
  await act(async () => {
    release();
    await completion.done;
  });
  expect(router.state.location.pathname).toBe("/promotion-environment/origin");
  expect(screen.container.querySelector('[data-thread="origin"]')?.textContent).toBe(
    "Keep my unsent prompt",
  );
  expect(screen.container.textContent).not.toContain("New chat");
  expect(useComposerDraftStore.getState().getDraftSession(draftId)).toBeNull();
  expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toBe(
    "Keep my unsent prompt",
  );
});

it("finalizes in the background without navigating away from another chat", async () => {
  setup();
  await using screen = await renderRoutes();
  const router = screen.appRouter;
  await act(() => router.navigate({ to: "/$environmentId/$threadId", params: otherRef }));
  await act(() => promoteLinearDraftThread(router, threadRef));
  expect(router.state.location.pathname).toBe("/promotion-environment/other");
  expect(screen.container.querySelector('[data-thread="other"]')).not.toBeNull();
  expect(useComposerDraftStore.getState().getDraftSession(draftId)).toBeNull();
  expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toBe(
    "Keep my unsent prompt",
  );
});
