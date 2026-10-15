import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ThreadId, type EnvironmentId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { randomUUID } from "~/lib/utils";
import { readThreadPreviewState } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { PreviewPanel } from "../preview/PreviewPanel";
import { openPreviewSession } from "../preview/openPreviewSession";
import { closePreviewSession } from "../preview/closePreviewSession";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

/** Standalone PRs own an ephemeral browser session, never another chat's browser. */
export default function PullRequestPreviewBrowser({
  environmentId,
  url,
  onClose,
}: {
  environmentId: EnvironmentId;
  url: string;
  onClose: () => void;
}) {
  const [threadRef] = useState(() =>
    scopeThreadRef(environmentId, ThreadId.make(`pr-preview-${randomUUID()}`)),
  );
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "close PR preview");
  const [tabId, setTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const close = (snapshot: PreviewSessionSnapshot) =>
      closePreviewSession({ threadRef, tabId: snapshot.tabId, snapshot, closePreview });
    void openPreviewSession({ threadRef, url, openPreview })
      .then(async (result) => {
        if (result._tag === "Failure") {
          if (!cancelled && !isAtomCommandInterrupted(result))
            setError(String(squashAtomCommandFailure(result)));
          return;
        }
        if (cancelled) {
          await close(result.value);
          return;
        }
        setTabId(result.value.tabId);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
      for (const snapshot of Object.values(readThreadPreviewState(threadRef).sessions))
        void close(snapshot);
    };
  }, [threadRef, url, openPreview, closePreview]);

  useEffect(() => {
    if (error)
      toastManager.add({ type: "error", title: "Unable to open preview", description: error });
  }, [error]);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="PR preview browser">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          <ArrowLeftIcon aria-hidden /> Back to PR
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {error ? (
          <p className="p-6 text-sm text-muted-foreground">{error}</p>
        ) : tabId ? (
          <PreviewPanel mode="embedded" threadRef={threadRef} tabId={tabId} visible />
        ) : (
          <p className="p-6 text-sm text-muted-foreground" role="status">
            Opening preview...
          </p>
        )}
      </div>
    </section>
  );
}
