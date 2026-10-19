import type { EnvironmentId, ProjectId, ProjectLibraryEntry } from "@t3tools/contracts";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../state/atom-registry";
import { projectHomeEnvironment } from "../state/projectHome";
import {
  appendComposerDraftAttachments,
  captureComposerDraftInsertion,
} from "../state/use-composer-drafts";

/** Library originals stay on the environment; only a fresh pending reference enters a draft. */
export async function addLibraryToComposer(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  entry: ProjectLibraryEntry,
  draftKey: string,
  insertion = captureComposerDraftInsertion(draftKey),
) {
  const result = await runAtomCommand(appAtomRegistry, projectHomeEnvironment.attach, {
    environmentId,
    input: { projectId, id: entry.id },
  });
  if (result._tag !== "Success") throw squashAtomCommandFailure(result);
  const rejected = appendComposerDraftAttachments(
    draftKey,
    [
      {
        type: "file",
        id: entry.id,
        name: result.value.name,
        mimeType: result.value.mimeType,
        sizeBytes: result.value.sizeBytes,
        fileUri: "",
        uploadedAttachmentId: result.value.attachmentId,
        uploadEnvironmentId: environmentId,
        libraryProjectId: projectId,
      },
    ],
    { appendReference: true, insertion },
  );
  if (rejected)
    throw new Error("The draft changed or its attachment limit was reached. Try again.");
}
