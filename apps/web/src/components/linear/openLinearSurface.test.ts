import {
  DEFAULT_CLIENT_SETTINGS,
  type PreviewOpenInput,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { readThreadPreviewState, resetPreviewStateForTests } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { openLinearSurface } from "./openLinearSurface";

vi.mock("~/env", () => ({ isElectron: true }));
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
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, linearViewEnabled: true });
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {} });
});
function fixture() {
  const openPreview = vi.fn(async ({ input }: { input: PreviewOpenInput }) =>
    AsyncResult.success(snapshot(input)),
  );
  const closePreview = vi.fn(async () => {});
  return { threadRef, workspace: "team", branch: "ENG-123", openPreview, closePreview };
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
  it("does not create a session when disabled", async () => {
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    const input = fixture();
    await expect(openLinearSurface(input)).rejects.toThrow("Enable Linear view");
    expect(input.openPreview).not.toHaveBeenCalled();
  });
  it("cleans up if the flag changes while opening", async () => {
    const input = fixture();
    input.openPreview.mockImplementation(async ({ input }) => {
      __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
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
