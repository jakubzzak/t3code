import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import { environmentCatalog } from "~/connection/catalog";
import { beginPreviewSessionClose } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import type { closePreviewSession } from "../preview/closePreviewSession";
import { toastManager } from "../ui/toast";

type CloseInput = Omit<Parameters<typeof closePreviewSession>[0], "snapshot">;
const pendingCloses = new Map<string, { retry: () => Promise<void> }>();

/** Keep cleanup alive after the PR unmounts; an abandoned owner cannot restore a failed close. */
export function closePullRequestPreviewSession(input: CloseInput): Promise<void> {
  const key = JSON.stringify([scopedThreadKey(input.threadRef), input.tabId]);
  const existing = pendingCloses.get(key);
  if (existing) return existing.retry();

  beginPreviewSessionClose(input.threadRef, input.tabId);
  const connectionAtom = environmentCatalog.stateAtom(input.threadRef.environmentId);
  const isConnected = () =>
    Option.exists(
      AsyncResult.value(appAtomRegistry.get(connectionAtom)),
      (state) => state.phase === "connected",
    );
  let wasConnected = isConnected();
  let running: Promise<void> | undefined;
  let retryAfterSettled = false;
  let toastId: string | undefined;

  const retry = (): Promise<void> => {
    if (running) return running;
    if (pendingCloses.get(key) !== job) return Promise.resolve();
    running = Promise.resolve()
      .then(async () => {
        const result = await input.closePreview({
          environmentId: input.threadRef.environmentId,
          input: { threadId: input.threadRef.threadId, tabId: input.tabId },
        });
        if (result._tag === "Failure") throw new Error("Preview close was not acknowledged");
        pendingCloses.delete(key);
        stopWatchingConnection();
        if (toastId !== undefined) toastManager.close(toastId);
      })
      .catch(() => {
        if (toastId !== undefined) toastManager.close(toastId);
        toastId = toastManager.add({
          type: "error",
          title: "Preview cleanup pending",
          description: "The preview is hidden. Closing will retry when the environment reconnects.",
          timeout: 0,
          actionProps: { children: "Retry", onClick: () => void retry() },
        });
      })
      .finally(() => {
        running = undefined;
        if (retryAfterSettled) {
          retryAfterSettled = false;
          if (isConnected()) return retry();
        }
      });
    return running;
  };
  const job = { retry };
  pendingCloses.set(key, job);
  const stopWatchingConnection = appAtomRegistry.subscribe(connectionAtom, () => {
    const connected = isConnected();
    const reconnected = connected && !wasConnected;
    wasConnected = connected;
    if (!reconnected) return;
    if (running) retryAfterSettled = true;
    else void retry();
  });
  return retry();
}
