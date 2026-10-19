import type { EnvironmentId, ProjectId, ProjectLibraryEntry } from "@t3tools/contracts";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { runAttachmentUploadCycle } from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { projectHomeEnvironment } from "../state/projectHome";
import { attachmentEnvironment } from "../state/attachments";
import { readPreparedConnection } from "../state/session";
import {
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerThreadTarget,
} from "../composerDraftStore";

/** Reuse the existing file chip and provider attachment path; identity is the library entry, never its title. */
export async function prepareLibraryAttachment(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  entry: ProjectLibraryEntry,
): Promise<ComposerFileAttachment> {
  const result = await runAtomCommand(appAtomRegistry, projectHomeEnvironment.attach, {
    environmentId,
    input: { projectId, id: entry.id },
  });
  if (result._tag !== "Success") throw squashAtomCommandFailure(result);
  return {
    type: "file",
    libraryProjectId: projectId,
    id: entry.id,
    name: result.value.name,
    mimeType: result.value.mimeType,
    sizeBytes: result.value.sizeBytes,
    file: null,
    uploadEnvironmentId: environmentId,
    uploadedAttachmentId: result.value.attachmentId,
  };
}

export async function addLibraryToComposer(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  entry: ProjectLibraryEntry,
  target: ComposerThreadTarget,
) {
  if (
    useComposerDraftStore
      .getState()
      .getComposerDraft(target)
      ?.files.some((file) => file.id === entry.id)
  )
    return;
  const file = await prepareLibraryAttachment(environmentId, projectId, entry);
  const accepted = useComposerDraftStore
    .getState()
    .addFiles(target, [file], { allowDuplicates: true, appendReference: true });
  if (!accepted.includes(file.id)) throw new Error("This chat has reached its attachment limit.");
}

export async function uploadLibraryFile(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  file: File,
  signal: AbortSignal,
) {
  const result = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    environmentId,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    upload: {
      projectId,
      type: "file",
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    },
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) => ({
      done: fetch(url, { method: "POST", body: file, signal }).then((response) => {
        if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      }),
      abort: () => {},
    }),
  });
  if (result.status !== "uploaded")
    throw new Error("The file could not be saved. Retry the upload.");
}
