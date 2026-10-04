import { useAtomValue } from "@effect/atom-react";
import {
  getCleanupRequest,
  subscribeCleanupRequests,
  type CleanupRequest,
} from "@t3tools/client-runtime/state/thread-cleanup";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { THREAD_CLEANUP_OWNERSHIP_NOTICE, type ThreadCleanupSnapshot } from "@t3tools/contracts";
import { CheckIcon, LoaderCircleIcon, CircleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useRightPanelStore } from "../rightPanelStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { usePreviewMiniPlayerStore } from "../previewMiniPlayerStore";
import { readLocalApi } from "../localApi";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

export function ThreadCleanupDialog() {
  const request = useSyncExternalStore(subscribeCleanupRequests, getCleanupRequest);
  return request ? (
    <CleanupProgress
      key={`${request.target.environmentId}:${request.target.threadId}`}
      request={request}
    />
  ) : null;
}

function CleanupProgress({ request }: { request: CleanupRequest }) {
  const { target } = request;
  const stream = useAtomValue(
    threadEnvironment.cleanupState({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    }),
  );
  const start = useAtomCommand(threadEnvironment.cleanupStart, { reportFailure: false });
  const [initial, setInitial] = useState<ThreadCleanupSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [open, setOpen] = useState(true);
  const started = useRef(false);
  const retry = useCallback(async () => {
    let interruptAgent = request.interruptAgent;
    if (confirmationRequired) {
      interruptAgent =
        (await readLocalApi()?.dialogs.confirm("Stop the working agent and resolve this chat?")) ??
        false;
      if (!interruptAgent) {
        request.done(false);
        return;
      }
    }
    setError(null);
    setInitial(null);
    const result = await start({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, interruptAgent },
    });
    if (result._tag === "Success") setInitial(result.value);
    else {
      const failure = squashAtomCommandFailure(result);
      setConfirmationRequired(
        typeof failure === "object" &&
          failure !== null &&
          "confirmationRequired" in failure &&
          failure.confirmationRequired === true,
      );
      setError(failure instanceof Error ? failure.message : "Could not connect. Retry cleanup.");
    }
  }, [confirmationRequired, request, start, target]);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void retry();
    }
  }, [retry]);
  const progress =
    stream._tag === "Success" && stream.value?.operationId === initial?.operationId
      ? stream.value
      : initial;
  const complete = progress?.status === "complete";
  useEffect(() => {
    if (!complete) return;
    useRightPanelStore.getState().closeAllSurfaces(target);
    useTerminalUiStateStore.getState().clearTerminalUiState(target);
    usePreviewMiniPlayerStore.getState().close(target);
    const timer = setTimeout(() => setOpen(false), 350);
    return () => clearTimeout(timer);
  }, [complete, target]);
  const failed = error !== null || progress?.status === "failed" || stream._tag === "Failure";
  return (
    <Dialog
      open={open}
      onOpenChange={(visible, details) => {
        if (!visible && failed && details.reason !== "outside-press") setOpen(false);
      }}
      onOpenChangeComplete={(visible) => {
        if (!visible) request.done(complete);
      }}
    >
      <DialogPopup showCloseButton={failed} bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>{complete ? "Chat resolved" : "Resolving chat"}</DialogTitle>
          <DialogDescription>
            {failed
              ? "Some tools could not be closed. Retry to finish resolving."
              : "Closing this chat’s tools. Your conversation and code changes are kept."}
          </DialogDescription>
        </DialogHeader>
        <p className="px-6 pb-4 text-xs text-muted-foreground">{THREAD_CLEANUP_OWNERSHIP_NOTICE}</p>
        <div
          className="max-h-80 overflow-y-auto px-6 pb-6"
          aria-live="polite"
          aria-relevant="text additions"
        >
          <ul className="space-y-3">
            {(
              progress?.resources ?? [
                { id: "inventory", label: "Find chat resources", status: "closing" },
              ]
            ).map((row) => (
              <li key={row.id} className="flex items-start gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="block truncate">{row.label}</span>
                  {"error" in row && row.error && (
                    <p className="mt-1 text-xs text-destructive">{row.error}</p>
                  )}
                </div>
                <span
                  role="img"
                  aria-label={
                    row.status === "closed"
                      ? "Closed"
                      : row.status === "failed"
                        ? "Failed"
                        : "Closing"
                  }
                >
                  {row.status === "closed" ? (
                    <CheckIcon className="thread-cleanup-check size-4 text-foreground" />
                  ) : row.status === "failed" ? (
                    <CircleAlertIcon className="size-4 text-destructive" />
                  ) : (
                    <LoaderCircleIcon className="size-4 motion-safe:animate-spin" />
                  )}
                </span>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {stream._tag === "Failure" && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Connection interrupted. Cleanup continues on the server. Reconnect and retry to check
              its progress.
            </p>
          )}
        </div>
        {failed && (
          <DialogFooter>
            <Button onClick={() => void retry()}>Retry</Button>
          </DialogFooter>
        )}
      </DialogPopup>
    </Dialog>
  );
}
