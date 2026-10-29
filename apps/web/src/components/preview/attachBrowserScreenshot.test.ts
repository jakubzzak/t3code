import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type DesktopPreviewScreenshotArtifact,
  EnvironmentId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type ComposerImageAttachment,
  DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { attachBrowserScreenshotToChat } from "./attachBrowserScreenshot";

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
});

const environmentId = EnvironmentId.make("screenshot-environment");
const projectRef = scopeProjectRef(environmentId, ProjectId.make("screenshot-project"));
const draftId = DraftId.make("screenshot-draft");
const threadRef = scopeThreadRef(environmentId, ThreadId.make("screenshot-thread"));
const artifact: DesktopPreviewScreenshotArtifact = {
  id: "browser-screenshot-localhost-abc-12345678",
  tabId: "tab-1",
  path: "/tmp/t3/browser-artifacts/browser-screenshot-localhost-abc-12345678.png",
  mimeType: "image/png",
  sizeBytes: 3,
  createdAt: "2026-10-29T00:00:00.000Z",
};
const readArtifactImage = vi.fn(async () => "data:image/png;base64,AQID");

function draftImage(id: string): ComposerImageAttachment {
  return {
    type: "image",
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 1,
    previewUrl: `data:image/png;base64,${id}`,
    file: new File([new Uint8Array([1])], `${id}.png`, { type: "image/png" }),
  };
}

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
  readArtifactImage.mockClear();
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
  useComposerDraftStore.getState().setProjectDraftThreadId(projectRef, draftId, {
    threadId: threadRef.threadId,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attachBrowserScreenshotToChat", () => {
  it("adds the saved screenshot once and keeps the existing draft", async () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadRef, "Look at this");
    store.addImage(threadRef, draftImage("existing"));

    await expect(
      attachBrowserScreenshotToChat(readArtifactImage, artifact, threadRef),
    ).resolves.toEqual({ kind: "draft", draftId });
    await attachBrowserScreenshotToChat(readArtifactImage, artifact, threadRef);

    const draft = useComposerDraftStore.getState().getComposerDraft(threadRef);
    expect(readArtifactImage).toHaveBeenCalledWith(artifact.path);
    expect(draft?.prompt).toBe("Look at this");
    expect(draft?.images.map(({ id }) => id)).toEqual(["existing", artifact.id]);
    expect(draft?.persistedAttachments.map(({ id }) => id)).toContain(artifact.id);
  });

  it("fails without redirecting when the capture's chat is gone", async () => {
    const otherChat = scopeThreadRef(environmentId, ThreadId.make("removed-thread"));

    await expect(
      attachBrowserScreenshotToChat(readArtifactImage, artifact, otherChat),
    ).rejects.toThrow("no longer available");

    expect(readArtifactImage).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getComposerDraft(threadRef)?.images ?? []).toEqual([]);
  });

  it("reports an unreadable screenshot and leaves the draft untouched", async () => {
    useComposerDraftStore.getState().setPrompt(threadRef, "Keep me");
    readArtifactImage.mockRejectedValueOnce(new Error("Image could not be decoded."));

    await expect(
      attachBrowserScreenshotToChat(readArtifactImage, artifact, threadRef),
    ).rejects.toThrow("could not be decoded");

    const draft = useComposerDraftStore.getState().getComposerDraft(threadRef);
    expect(draft?.prompt).toBe("Keep me");
    expect(draft?.images).toEqual([]);
  });

  it("reports a full attachment list instead of claiming success", async () => {
    const existing = Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS }, (_, index) =>
      draftImage(`existing-${index}`),
    );
    useComposerDraftStore.getState().addImages(threadRef, existing);

    await expect(
      attachBrowserScreenshotToChat(readArtifactImage, artifact, threadRef),
    ).rejects.toThrow("Remove an attachment");

    const draft = useComposerDraftStore.getState().getComposerDraft(threadRef);
    expect(draft?.images).toHaveLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS);
    expect(draft?.images.some(({ id }) => id === artifact.id)).toBe(false);
  });
});
