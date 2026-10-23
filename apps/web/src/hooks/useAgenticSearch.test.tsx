import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
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
vi.mock("@tanstack/react-router", () => ({ useParams: () => null }));
vi.mock("~/state/entities", () => ({ useThreadShell: () => null }));
vi.mock("~/state/environments", () => ({
  usePrimaryEnvironmentId: () => "host",
  useEnvironments: () => ({
    environments: [{ environmentId: "host", serverConfig: { agenticSearch: state.supported } }],
  }),
}));
vi.mock("./useScratchProject", () => ({
  useScratchProject: () => ({
    scratchEnvironmentId: () => "host",
    openScratchProject: state.openScratch,
  }),
}));
vi.mock("./useHandleNewThread", () => ({ useNewThreadHandler: () => state.newThread }));
vi.mock("./useSettings", () => ({ useClientSettings: () => state.settings }));
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: state.toast } }));

const draftId = DraftId.make("search-launch");
const project = scopeProjectRef(EnvironmentId.make("host"), ProjectId.make("scratch"));
let renderer: ReactTestRenderer | undefined;
let search: ReturnType<typeof useAgenticSearch>;
function Probe() {
  search = useAgenticSearch();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.settings.agenticSearchEnabled = true;
  state.supported = true;
  state.toast.mockReset();
  state.openScratch.mockReset().mockResolvedValue({ id: project.projectId });
  state.newThread.mockReset().mockImplementation(async () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(project, draftId, { threadId: ThreadId.make("search-thread") });
    return { draftId };
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("prepares an explicit projectless draft without submitting and keeps the template snapshot", async () => {
  act(() => {
    renderer = create(<Probe />);
  });
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
  act(() => {
    renderer = create(<Probe />);
  });
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
  state.settings.agenticSearchEnabled = false;
  act(() => {
    renderer = create(<Probe />);
  });
  await act(() => search.launch("chats", "explicit"));
  expect(state.openScratch).not.toHaveBeenCalled();
  state.settings.agenticSearchEnabled = true;
  state.supported = false;
  act(() => renderer?.update(<Probe />));
  await act(() => search.launch("chats", "explicit"));
  expect(state.openScratch).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalled();
  state.supported = true;
  state.openScratch.mockRejectedValueOnce(new Error("Unavailable"));
  act(() => renderer?.update(<Probe />));
  await act(() => search.launch("chats", "explicit"));
  expect(state.newThread).not.toHaveBeenCalled();
  await act(() => search.launch("chats", "explicit"));
  expect(state.newThread).toHaveBeenCalledTimes(1);
});

it("deduplicates overlapping launches until scratch preparation finishes", async () => {
  let finish!: (value: { id: ProjectId }) => void;
  state.openScratch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    renderer = create(<Probe />);
  });
  const first = search.launch("chats", "explicit");
  await search.launch("chats", "explicit");
  expect(state.openScratch).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ id: project.projectId });
    await first;
  });
  expect(state.newThread).toHaveBeenCalledTimes(1);
});
