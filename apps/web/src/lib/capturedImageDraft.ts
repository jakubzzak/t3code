import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";

import {
  type ComposerImageAttachment,
  type ComposerThreadTarget,
  type PersistedComposerImageAttachment,
  useComposerDraftStore,
} from "../composerDraftStore";
import { compressImageToByteLimit, dataUrlToFile, readFileAsDataUrl } from "./imageCompression";

/** A captured image shrunk to the provider image limit, ready for `addCapturedImageToDraft`. */
export interface FittedCapturedImage {
  readonly file: File;
  readonly dataUrl: string;
  readonly imageSize: { readonly width: number; readonly height: number } | undefined;
}

/** Shrinks a captured data URL to the provider image limit. `null` means it cannot fit. */
export async function fitCapturedImage(capture: {
  readonly name: string;
  readonly mimeType: string;
  readonly dataUrl: string;
}): Promise<FittedCapturedImage | null> {
  const original = dataUrlToFile(capture.dataUrl, capture.name, capture.mimeType);
  const compressed = await compressImageToByteLimit(original, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
  if (!compressed.ok) return null;
  return {
    file: compressed.file,
    dataUrl: compressed.recompressed ? await readFileAsDataUrl(compressed.file) : capture.dataUrl,
    imageSize: compressed.imageSize,
  };
}

/**
 * Adds a captured image to a draft and saves it with the draft. Repeating the call with the
 * same `id` keeps one attachment. Throws when the draft rejects or cannot save the image.
 */
export async function addCapturedImageToDraft(
  target: ComposerThreadTarget,
  image: {
    readonly id: string;
    readonly file: File;
    readonly dataUrl: string;
    readonly source?: ComposerImageAttachment["source"];
  },
): Promise<void> {
  const store = useComposerDraftStore.getState();
  const { id, file, dataUrl, source } = image;
  const alreadyAttached =
    store.getComposerDraft(target)?.images.some((existing) => existing.id === id) ?? false;
  if (
    !alreadyAttached &&
    !store.addImage(target, {
      type: "image",
      id,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: dataUrl,
      file,
      ...(source ? { source } : {}),
    })
  ) {
    throw new Error("Remove an attachment, then try again.");
  }
  const persisted: PersistedComposerImageAttachment = {
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    dataUrl,
    ...(source ? { source } : {}),
  };
  const persistedAttachments =
    store
      .getComposerDraft(target)
      ?.persistedAttachments.filter((attachment) => attachment.id !== id) ?? [];
  await store.syncPersistedAttachments(target, [...persistedAttachments, persisted]);
  if (!store.getComposerDraft(target)?.persistedAttachments.some((saved) => saved.id === id)) {
    throw new Error("The image could not be saved to the draft.");
  }
}
