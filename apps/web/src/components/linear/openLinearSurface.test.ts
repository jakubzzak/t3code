import {
  DEFAULT_CLIENT_SETTINGS,
  type PreviewOpenInput,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { readThreadPreviewState, resetPreviewStateForTests } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { openLinearSurface } from "./openLinearSurface";

vi.mock("~/env", () => ({ isElectron: true }));
const bridge = vi.hoisted(() => ({ navigate: vi.fn(async (_tabId: string, _url: string) => {}) }));
vi.mock("../preview/previewBridge", () => ({ previewBridge: bridge }));
const projectGate = vi.hoisted(() => ({ enabled: true }));
vi.mock("./linearViewEnabled", () => ({
  readLinearViewEnabled: () => projectGate.enabled,
}));
const threadRef = { environmentId: "local", threadId: "thread" } as ScopedThreadRef;
const snapshot = (input: PreviewOpenInput): PreviewSessionSnapshot => ({
  threadId: input.threadId,
  tabId: "linear-1",
  surface: input.surface,
  navStatus: input.url
    ? { _tag: "Success", url: input.url, title: "Sign in - Google Accounts" }
    : { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-05T00:00:00Z",
});
beforeEach(() => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  projectGate.enabled = true;
  bridge.navigate.mockClear();
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {} });
});
function fixture() {
  const openPreview = vi.fn(async ({ input }: { input: PreviewOpenInput }) =>
    AsyncResult.success(snapshot(input)),
  );
  const closePreview = vi.fn(async () => {});
  return {
    threadRef,
    workspace: "team",
    branch: "ENG-123",
    openPreview,
    closePreview,
  };
}
describe("opening Linear", () => {
  it("opens the branch issue once and preserves navigation when the branch changes", async () => {
    const input = fixture();
    const tabId = await openLinearSurface(input);
    expect(readThreadPreviewState(threadRef).sessions[tabId]?.navStatus).toMatchObject({
      url: "https://linear.app/team/issue/ENG-123",
    });
    await openLinearSurface({ ...input, branch: "ENG-456" });
    expect(input.openPreview).toHaveBeenCalledTimes(1);
  });
  it("opens a selected issue in the same chat and retargets its existing Linear tab", async () => {
    const input = fixture();
    const tabId = await openLinearSurface(input);
    useRightPanelStore.setState({ byThreadKey: {} });
    const url = "https://linear.app/team/issue/ENG-456/selected-issue";
    expect(await openLinearSurface({ ...input, url })).toBe(tabId);
    expect(input.openPreview).toHaveBeenCalledTimes(1);
    expect(bridge.navigate).toHaveBeenCalledWith(
      previewRuntimeTabId(threadRef, readThreadPreviewState(threadRef).serverEpoch, tabId),
      url,
    );
    expect(Object.values(readThreadPreviewState(threadRef).sessions)).toHaveLength(1);
    expect(Object.values(useRightPanelStore.getState().byThreadKey)).toEqual([
      expect.objectContaining({ isOpen: true, activeSurfaceId: `browser:${tabId}` }),
    ]);
  });
  it("opens the exact selected issue URL when this chat has no Linear tab", async () => {
    const input = fixture();
    const url = "https://linear.app/team/issue/ENG-456/selected-issue";
    const tabId = await openLinearSurface({ ...input, url });
    expect(readThreadPreviewState(threadRef).sessions[tabId]).toMatchObject({
      threadId: threadRef.threadId,
      surface: "linear",
      navStatus: { url },
    });
    expect(bridge.navigate).not.toHaveBeenCalled();
  });
  it("does not create a session when disabled", async () => {
    projectGate.enabled = false;
    const input = fixture();
    await expect(openLinearSurface(input)).rejects.toThrow("Enable Linear view");
    expect(input.openPreview).not.toHaveBeenCalled();
  });
  it("cleans up if the flag changes while opening", async () => {
    const input = fixture();
    input.openPreview.mockImplementation(async ({ input }) => {
      projectGate.enabled = false;
      return AsyncResult.success(snapshot(input));
    });
    await expect(openLinearSurface(input)).rejects.toThrow("disabled");
    expect(input.closePreview).toHaveBeenCalledTimes(1);
    expect(Object.values(readThreadPreviewState(threadRef).sessions)).toEqual([]);
  });
  it("fails gracefully on an old server that drops the surface identity", async () => {
    const input = fixture();
    input.openPreview.mockImplementation(async ({ input }) =>
      AsyncResult.success(snapshot({ ...input, surface: undefined })),
    );
    await expect(openLinearSurface(input)).rejects.toThrow("Update");
    expect(input.closePreview).toHaveBeenCalledTimes(1);
    expect(Object.values(readThreadPreviewState(threadRef).sessions)).toEqual([]);
  });
  it("rejects an agent's explicit URL outside the configured workspace", async () => {
    const input = fixture();
    await expect(
      openLinearSurface({ ...input, url: "https://linear.app/other/issue/ENG-123" }),
    ).rejects.toThrow("configured Linear workspace");
    expect(input.openPreview).not.toHaveBeenCalled();
  });
});
