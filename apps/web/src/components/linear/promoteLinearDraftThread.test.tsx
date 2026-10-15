// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { ThreadRouteView } from "../ThreadRouteView";
import { promoteLinearDraftThread } from "./promoteLinearDraftThread";

const environmentId = EnvironmentId.make("promotion-environment");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("origin"));
const draftId = DraftId.make("origin-draft");
const otherRef = scopeThreadRef(environmentId, ThreadId.make("other"));
const thread = {
  ...threadRef,
  id: threadRef.threadId,
  messages: [],
  latestTurn: null,
  session: null,
};
const refs = [threadRef, otherRef];

vi.mock("~/state/entities", () => ({
  useThreadRefs: () => refs,
  useEnvironmentThreadRefs: () => refs,
  useThread: () => thread,
  useThreadShell: () => thread,
  useThreadDetail: () => thread,
  useThreadStatus: () => "ready",
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({ data: { snapshot: { _tag: "Some" } } }),
}));
vi.mock("../ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../ChatView", () => ({
  default: (props: { draftId?: DraftId; environmentId: EnvironmentId; threadId: ThreadId }) => {
    const prompt = useComposerDraftStore(
      (store) =>
        store.getComposerDraft(props.draftId ?? scopeThreadRef(props.environmentId, props.threadId))
          ?.prompt,
    );
    return <div data-thread={props.threadId}>{prompt}</div>;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);

beforeEach(() => {
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
  const store = useComposerDraftStore.getState();
  store.setProjectDraftThreadId(
    scopeProjectRef(environmentId, ProjectId.make("project")),
    draftId,
    { threadId: threadRef.threadId },
  );
  store.setPrompt(draftId, "Keep my unsent prompt");
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
});

async function mountRouter(loadOrigin: () => Promise<void> = async () => {}) {
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
  await act(async () => {
    await router.load();
    root.render(<RouterProvider router={router} />);
  });
  return router;
}

it("keeps the returning draft mounted until its saved thread route is ready", async () => {
  let release!: () => void;
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  const router = await mountRouter(() => loading);
  await act(async () => {
    await router.navigate({ to: "/$environmentId/$threadId", params: otherRef });
  });
  await act(async () => {
    await router.navigate({ to: "/draft/$draftId", params: { draftId } });
  });
  let completion!: Promise<void>;
  await act(async () => {
    completion = promoteLinearDraftThread(router, threadRef);
  });
  expect(useComposerDraftStore.getState().getDraftSession(draftId)).not.toBeNull();
  expect(container.textContent).toContain("Keep my unsent prompt");
  await act(async () => {
    release();
    await completion;
  });
  expect(router.state.location.pathname).toBe("/promotion-environment/origin");
  expect(container.querySelector('[data-thread="origin"]')?.textContent).toBe(
    "Keep my unsent prompt",
  );
  expect(container.textContent).not.toContain("New chat");
  expect(useComposerDraftStore.getState().getDraftSession(draftId)).toBeNull();
  expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toBe(
    "Keep my unsent prompt",
  );
});

it("finalizes in the background without navigating away from another chat", async () => {
  const router = await mountRouter();
  await act(async () => {
    await router.navigate({ to: "/$environmentId/$threadId", params: otherRef });
  });
  await act(async () => {
    await promoteLinearDraftThread(router, threadRef);
  });
  expect(router.state.location.pathname).toBe("/promotion-environment/other");
  expect(container.querySelector('[data-thread="other"]')).not.toBeNull();
  expect(useComposerDraftStore.getState().getDraftSession(draftId)).toBeNull();
  expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt).toBe(
    "Keep my unsent prompt",
  );
});
