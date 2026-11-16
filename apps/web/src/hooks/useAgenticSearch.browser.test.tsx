import { expect, it, vi } from "vite-plus/test";
import { useEffect } from "react";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { act, render } from "../../test/render";
import { useAgenticSearch } from "./useAgenticSearch";

const state = vi.hoisted(() => ({
  settings: {
    agenticSearchEnabled: true,
    agenticSearchChatsPrompt: "Chat template",
    agenticSearchEverywherePrompt: "Everywhere template",
  },
  supported: true,
  openScratch: vi.fn(),
  newThread: vi.fn(),
  toast: vi.fn(),
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: () => null,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => EnvironmentId.make("host"),
  useEnvironments: (() => ({
    environments: [{ environmentId: "host", serverConfig: { agenticSearch: state.supported } }],
  })) as never,
}));
vi.mock(import("./useScratchProject"), async (original) => ({
  ...(await original()),
  useScratchProject: (() => ({
    scratchEnvironmentId: () => "host",
    openScratchProject: state.openScratch,
  })) as never,
}));
vi.mock(import("./useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => state.newThread) as never,
}));
vi.mock(import("./useSettings"), async (original) => ({
  ...(await original()),
  useClientSettings: (() => state.settings) as never,
}));
vi.mock(import("~/components/ui/toast"), async (original) => ({
  ...(await original()),
  toastManager: { add: state.toast } as never,
}));

const draftId = DraftId.make("search-launch");
const project = scopeProjectRef(EnvironmentId.make("host"), ProjectId.make("scratch"));
let search: ReturnType<typeof useAgenticSearch>;
function Probe() {
  const current = useAgenticSearch();
  useEffect(() => {
    search = current;
  });
  return null;
}

function resetState() {
  state.settings.agenticSearchEnabled = true;
  state.supported = true;
  state.toast.mockReset();
  state.openScratch.mockReset().mockResolvedValue({ id: project.projectId });
  state.newThread.mockReset().mockImplementation(async () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(project, draftId, { threadId: ThreadId.make("search-thread") });
    return { draftId };
  });
}

it("prepares an explicit projectless draft without submitting and keeps the template snapshot", async () => {
  resetState();
  await using _screen = await render(<Probe />);
  await act(() => search.launch("chats", "explicit"));
  const store = useComposerDraftStore.getState();
  expect(store.getComposerDraft(draftId)?.prompt).toBe("Chat template\n\nQuestion:\n");
  expect(store.getDraftSession(draftId)).toMatchObject({
    projectId: "scratch",
    environmentId: "host",
    environmentSelection: "manual",
    search: { template: "Chat template", presentation: "explicit", autoSubmit: false },
  });
  expect(state.newThread).toHaveBeenCalledWith(project, { forceNew: true, envMode: "local" });
});

it("keeps a palette question separate from its instructions and requests one submission", async () => {
  resetState();
  await using _screen = await render(<Probe />);
  await act(() => search.launch("everywhere", "implicit", "Where did we agree on July 9?"));
  const store = useComposerDraftStore.getState();
  expect(store.getComposerDraft(draftId)?.prompt).toBe("Where did we agree on July 9?");
  expect(store.getDraftSession(draftId)?.search).toEqual({
    scope: "everywhere",
    template: "Everywhere template",
    presentation: "implicit",
    autoSubmit: true,
  });
  await act(() => search.launch("chats", "implicit"));
  expect(store.getComposerDraft(draftId)?.prompt ?? "").toBe("");
  expect(store.getDraftSession(draftId)?.search?.autoSubmit).toBe(false);
});

it("does not launch on disabled or older servers, and allows retry after preparation fails", async () => {
  resetState();
  state.settings.agenticSearchEnabled = false;
  await using screen = await render(<Probe />);
  await act(() => search.launch("chats", "explicit"));
  expect(state.openScratch).not.toHaveBeenCalled();
  state.settings.agenticSearchEnabled = true;
  state.supported = false;
  await screen.rerender(<Probe />);
  await act(() => search.launch("chats", "explicit"));
  expect(state.openScratch).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalled();
  state.supported = true;
  state.openScratch.mockRejectedValueOnce(new Error("Unavailable"));
  await screen.rerender(<Probe />);
  await act(() => search.launch("chats", "explicit"));
  expect(state.newThread).not.toHaveBeenCalled();
  await act(() => search.launch("chats", "explicit"));
  expect(state.newThread).toHaveBeenCalledTimes(1);
});

it("deduplicates overlapping launches until scratch preparation finishes", async () => {
  resetState();
  let finish!: (value: { id: ProjectId }) => void;
  state.openScratch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await using _screen = await render(<Probe />);
  const first = search.launch("chats", "explicit");
  await search.launch("chats", "explicit");
  expect(state.openScratch).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ id: project.projectId });
    await first;
  });
  expect(state.newThread).toHaveBeenCalledTimes(1);
});
