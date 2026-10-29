import type { DesktopPreviewScreenshotArtifact, ScopedThreadRef } from "@t3tools/contracts";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { addCapturedImageToDraft, fitCapturedImage } from "~/lib/capturedImageDraft";
import { readThreadShell } from "~/state/entities";

/** The chat a pasted screenshot landed in, so the caller can open it. */
export type BrowserScreenshotChat =
  | { readonly kind: "thread"; readonly threadRef: ScopedThreadRef }
  | { readonly kind: "draft"; readonly draftId: DraftId };

function resolveBrowserScreenshotChat(threadRef: ScopedThreadRef): BrowserScreenshotChat | null {
  if (readThreadShell(threadRef)) return { kind: "thread", threadRef };
  const draftId = useComposerDraftStore.getState().getDraftIdByRef(threadRef);
  return draftId ? { kind: "draft", draftId } : null;
}

/**
 * Adds a saved browser screenshot to the draft of the chat it was captured from. The chat is
 * fixed at capture time and never falls back to the chat that is open now. Throws when that chat
 * is gone, the image cannot be read, or the draft rejects it.
 */
export async function attachBrowserScreenshotToChat(
  readArtifactImage: (path: string) => Promise<string>,
  artifact: DesktopPreviewScreenshotArtifact,
  threadRef: ScopedThreadRef,
): Promise<BrowserScreenshotChat> {
  if (!resolveBrowserScreenshotChat(threadRef)) {
    throw new Error("The chat for this screenshot is no longer available.");
  }
  const fitted = await fitCapturedImage({
    name: `${artifact.id}.png`,
    mimeType: artifact.mimeType,
    dataUrl: await readArtifactImage(artifact.path),
  });
  if (!fitted) throw new Error("The screenshot is too large to attach.");
  // Reading the image is async, so confirm the chat still exists before touching its draft.
  const chat = resolveBrowserScreenshotChat(threadRef);
  if (!chat) throw new Error("The chat for this screenshot is no longer available.");
  await addCapturedImageToDraft(threadRef, {
    id: artifact.id,
    file: fitted.file,
    dataUrl: fitted.dataUrl,
  });
  return chat;
}
