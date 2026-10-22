import type { InboxNotification } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";

/** Background revalidation must keep the loaded empty state and its height. */
export function isInboxInitialLoad(result: AsyncResult.AsyncResult<unknown, unknown>) {
  return result.waiting && Option.isNone(AsyncResult.value(result));
}

type ContentVersion = Pick<
  InboxNotification,
  "id" | "projectId" | "analysisVersion" | "updatedAt"
> & {
  analysis: { readonly generatedAt: string } | null;
};

/** Read/triage revisions do not invalidate full source context or a full-length summary. */
export function isInboxDetailCurrent(preview: ContentVersion, detail: ContentVersion | null) {
  return (
    detail !== null &&
    detail.id === preview.id &&
    detail.projectId === preview.projectId &&
    detail.analysisVersion === preview.analysisVersion &&
    detail.updatedAt === preview.updatedAt &&
    detail.analysis?.generatedAt === preview.analysis?.generatedAt
  );
}
