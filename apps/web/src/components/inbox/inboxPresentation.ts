import type { InboxNotification } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";

/** Continue below a triaged row, falling back above it at the end of the list. */
export function nextInboxFocusKey(order: ReadonlyArray<string>, current: string) {
  const index = order.indexOf(current);
  if (index === -1) return null;
  return order[index + 1] ?? order[index - 1] ?? null;
}

/** Background revalidation must keep the loaded empty state and its height. */
export function isInboxInitialLoad(result: AsyncResult.AsyncResult<unknown, unknown>) {
  return result.waiting && Option.isNone(AsyncResult.value(result));
}

type ContentVersion = Pick<
  InboxNotification,
  "id" | "projectId" | "analysisVersion" | "updatedAt"
> & {
  analysis: { readonly generatedAt: string } | null;
  suggestionResearch?: InboxNotification["suggestionResearch"];
};

/** Read/triage revisions do not invalidate full source context or a full-length summary. */
export function isInboxDetailCurrent(preview: ContentVersion, detail: ContentVersion | null) {
  return (
    detail !== null &&
    detail.id === preview.id &&
    detail.projectId === preview.projectId &&
    detail.analysisVersion === preview.analysisVersion &&
    detail.updatedAt === preview.updatedAt &&
    detail.suggestionResearch?.status === preview.suggestionResearch?.status &&
    detail.suggestionResearch?.version === preview.suggestionResearch?.version &&
    detail.analysis?.generatedAt === preview.analysis?.generatedAt
  );
}
