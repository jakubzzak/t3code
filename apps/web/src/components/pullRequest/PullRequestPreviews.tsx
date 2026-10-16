import type { EnvironmentId, PullRequestComment, ScopedThreadRef } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useMemo } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { openUrlInPreview } from "~/browser/openFileInPreview";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { pullRequestPreviews } from "./pullRequestPreviews.logic";

/** The same destinations and actions in the thread panel and standalone PR summary. */
export function PullRequestPreviews({
  environmentId,
  threadRef,
  comments,
  pending,
  error,
  truncated,
  onRetry,
  onOpenStandalone,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  comments: ReadonlyArray<PullRequestComment>;
  pending: boolean;
  error: string | null;
  truncated: boolean;
  onRetry: () => void;
  onOpenStandalone: (url: string) => void;
}) {
  const previews = useMemo(() => pullRequestPreviews(comments), [comments]);
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });

  const open = async (url: string) => {
    if (!isPreviewSupportedInRuntime()) {
      toastManager.add({
        type: "error",
        title: "Preview is only available in the T3 Code desktop app.",
      });
      return;
    }
    if (!threadRef || threadRef.environmentId !== environmentId) {
      onOpenStandalone(url);
      return;
    }
    try {
      const result = await openUrlInPreview({ threadRef, url, openPreview });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        throw squashAtomCommandFailure(result);
      }
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Unable to open preview",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  const copy = async (url: string) => {
    try {
      if (await writeTextToClipboard(url, "preview URL")) {
        toastManager.add({ type: "success", title: "Preview URL copied" });
      }
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not copy preview URL",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  if (pending)
    return (
      <span className="text-muted-foreground" role="status">
        Loading previews...
      </span>
    );
  if (error)
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Could not load previews</span>
        <Button size="xs" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </span>
    );
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {previews.length === 0 ? (
        <span className="text-muted-foreground">No previews available</span>
      ) : (
        previews.map((preview) => {
          const pill = (
            <Badge
              variant="info"
              className="min-w-0 max-w-full"
              render={<button type="button" />}
              aria-label={`Open preview ${preview.url}`}
              onClick={() => void open(preview.url)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void copy(preview.url);
              }}
            >
              <span className="truncate">{preview.label}</span>
              <ExternalLinkIcon aria-hidden />
            </Badge>
          );
          return preview.ambiguous ? (
            <Tooltip key={preview.url}>
              <TooltipTrigger render={pill} />
              <TooltipPopup>{preview.url}</TooltipPopup>
            </Tooltip>
          ) : (
            <span key={preview.url} className="min-w-0 max-w-full">
              {pill}
            </span>
          );
        })
      )}
      {truncated ? (
        <span className="text-muted-foreground">Some comments are not loaded.</span>
      ) : null}
    </span>
  );
}
